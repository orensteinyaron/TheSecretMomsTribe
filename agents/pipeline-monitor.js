/**
 * Pipeline Monitor Agent
 *
 * Runs hourly. For each daily SLA agent defined in its own `config.sla_definitions`:
 *   - If "now" is past the SLA deadline AND that agent has not completed today,
 *     insert a critical notification and trigger the send-email-alert edge function.
 * Also checks orchestrator liveness (no tick within `orchestrator_max_silence_hours`)
 * and emits a quiet `pipeline healthy` heartbeat when everything is green.
 *
 * Idempotent within a UTC day via notifications' (category, subject_id, UTC-date)
 * unique index — re-runs won't duplicate alerts.
 */

import { supabase } from './lib/supabase.js';
import { logActivity } from './lib/activity.js';
import { getTodayStartUTC } from './lib/schedule.js';

const SELF_SLUG = 'pipeline-monitor';

function fmtUtc(d) {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function getSelfConfig() {
  const { data } = await supabase
    .from('agents')
    .select('id, config')
    .eq('slug', SELF_SLUG)
    .single();
  if (!data) throw new Error(`agents row for ${SELF_SLUG} is missing`);
  return data;
}

async function getAgentsBySlug(slugs) {
  const { data } = await supabase
    .from('agents')
    .select('id, slug, depends_on')
    .in('slug', slugs);
  return new Map((data || []).map((a) => [a.slug, a]));
}

async function hasCompletedToday(agentId, todayStart) {
  const { count } = await supabase
    .from('agent_runs')
    .select('id', { head: true, count: 'exact' })
    .eq('agent_id', agentId)
    .eq('status', 'completed')
    .gte('started_at', todayStart.toISOString());
  return (count || 0) > 0;
}

async function getLastOrchestratorTick() {
  const { data } = await supabase
    .from('agent_runs')
    .select('started_at, agents!inner(slug)')
    .eq('agents.slug', 'system-orchestrator')
    .order('started_at', { ascending: false })
    .limit(1);
  return data?.[0]?.started_at ? new Date(data[0].started_at) : null;
}

/**
 * Insert a critical notification (idempotent via unique index on
 * category+subject_id+UTC-date). Returns true if a new row was inserted,
 * false if it was a duplicate-day conflict.
 */
async function upsertCriticalNotification({ subjectId, title, description, metadata }) {
  const row = {
    category:    'pipeline_health',
    subject_id:  subjectId,
    severity:    'critical',
    type:        'system_alert',
    urgency:     'critical',
    status:      'unread',
    title,
    description,
    metadata,
  };
  const { data, error } = await supabase
    .from('notifications')
    .insert(row)
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 = unique violation — already alerted today
    if (error.code === '23505') return { inserted: false, id: null };
    throw error;
  }
  return { inserted: true, id: data?.id ?? null };
}

async function triggerEmailAlert(notificationId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: 'missing_env' };
  try {
    const res = await fetch(`${url}/functions/v1/send-email-alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${key}`,
      },
      body: JSON.stringify({ notification_id: notificationId }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const todayStart = getTodayStartUTC(now);
  console.log(`[pipeline-monitor] Tick @ ${now.toISOString()}`);

  const self = await getSelfConfig();
  const config = self.config || {};
  const slaDefs = config.sla_definitions || {};
  const maxSilenceHours = config.orchestrator_max_silence_hours ?? 2;

  const slugs = Object.keys(slaDefs);
  const agentsBySlug = await getAgentsBySlug(slugs);

  const alerts = [];
  const healthy = [];

  for (const slug of slugs) {
    const agent = agentsBySlug.get(slug);
    if (!agent) {
      alerts.push({ slug, kind: 'agent_missing', reason: 'not_in_agents_table' });
      continue;
    }

    const sla = slaDefs[slug];
    const [slaH, slaM] = (sla.must_complete_by_utc || '00:00').split(':').map((s) => parseInt(s, 10));
    const deadline = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      slaH, slaM, 0, 0,
    ));

    if (now < deadline) {
      healthy.push({ slug, status: 'not_yet_due' });
      continue;
    }

    const done = await hasCompletedToday(agent.id, todayStart);
    if (done) {
      healthy.push({ slug, status: 'completed' });
      continue;
    }

    alerts.push({ slug, kind: 'sla_missed', deadline, scheduledUtc: sla.must_complete_by_utc });
  }

  // Orchestrator liveness
  const lastTick = await getLastOrchestratorTick();
  const silentForMs = lastTick ? now.getTime() - lastTick.getTime() : Infinity;
  const silentForH  = silentForMs / (3600 * 1000);
  if (!lastTick || silentForH > maxSilenceHours) {
    alerts.push({
      slug: 'system-orchestrator',
      kind: 'orchestrator_silent',
      silent_hours: Math.round(silentForH * 10) / 10,
      last_tick: lastTick?.toISOString() ?? null,
    });
  }

  // Emit alerts
  for (const a of alerts) {
    let title, description, subjectId;
    if (a.kind === 'sla_missed') {
      subjectId  = `sla:${a.slug}`;
      title      = `${a.slug} missed SLA`;
      description = `Scheduled deadline ${a.scheduledUtc} UTC has passed; ${a.slug} has no completed run today.`;
    } else if (a.kind === 'orchestrator_silent') {
      subjectId  = `orchestrator_silent`;
      title      = `Orchestrator silent — last tick ${a.silent_hours}h ago`;
      description = a.last_tick
        ? `Last orchestrator tick at ${a.last_tick}. Exceeds threshold of ${maxSilenceHours}h.`
        : `No orchestrator ticks have ever been recorded.`;
    } else if (a.kind === 'agent_missing') {
      subjectId  = `missing:${a.slug}`;
      title      = `SLA references missing agent: ${a.slug}`;
      description = `Pipeline-monitor SLA config references "${a.slug}" but no agents row found.`;
    } else {
      continue;
    }

    try {
      const { inserted, id } = await upsertCriticalNotification({
        subjectId,
        title,
        description,
        metadata: { ...a, at_utc: fmtUtc(now) },
      });

      if (inserted) {
        await logActivity({
          category:    'alert',
          actor_type:  'system',
          actor_name:  SELF_SLUG,
          action:      a.kind,
          description: title,
          metadata:    a,
          entity_type: 'notification',
          entity_id:   id,
        });

        const emailResult = await triggerEmailAlert(id);
        await logActivity({
          category:    'alert',
          actor_type:  'system',
          actor_name:  SELF_SLUG,
          action:      'alert_sent',
          description: emailResult.ok
            ? `Email alert dispatched for ${title}`
            : `Email alert failed (${emailResult.error || emailResult.status}) for ${title}`,
          metadata:    { notification_id: id, email: emailResult },
          entity_type: 'notification',
          entity_id:   id,
        });
        if (emailResult.ok && id) {
          await supabase
            .from('notifications')
            .update({
              delivered_channels: { email: { sent_at: new Date().toISOString(), response: emailResult.body } },
            })
            .eq('id', id);
        }
      } else {
        // Already alerted today — quiet debug record, no email re-send
        await logActivity({
          category:    'debug',
          actor_type:  'system',
          actor_name:  SELF_SLUG,
          action:      'alert_deduped',
          description: `Alert already sent today: ${title}`,
          metadata:    a,
        });
      }
    } catch (err) {
      console.error(`[pipeline-monitor] alert emit failed (${a.kind}/${a.slug}):`, err.message);
    }
  }

  // Healthy heartbeat (quiet info, no email)
  if (alerts.length === 0 && healthy.length > 0) {
    await logActivity({
      category:    'pipeline',
      actor_type:  'system',
      actor_name:  SELF_SLUG,
      action:      'pipeline_healthy',
      description: `Pipeline healthy — ${healthy.filter((h) => h.status === 'completed').length}/${healthy.length} SLA agents on time, orchestrator ${silentForH.toFixed(1)}h since last tick`,
      metadata:    { healthy, silent_hours: silentForH },
    });
  }

  console.log(`[pipeline-monitor] ${alerts.length} alert(s), ${healthy.length} ok`);
}

main().catch((err) => {
  console.error('[pipeline-monitor] Fatal:', err);
  process.exit(1);
});
