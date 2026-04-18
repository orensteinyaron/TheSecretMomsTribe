/**
 * System Orchestrator V2 — SMT Agent Lifecycle Manager
 *
 * Replaces V1's window matching (`shouldRunNow`) with catch-up eligibility
 * (`isEligibleToRun`). A single tick after the latest scheduled time can
 * cascade the full daily chain sequentially via re-evaluation.
 *
 * Behavioral guarantees:
 *   - Runs one agent at a time (sequential), awaits completion, then re-evaluates.
 *   - Self-logs to agent_runs + activity_log for observability.
 *   - Tolerant of individual agent failures — continues to the next eligible agent.
 *   - Bounded by MAX_ITERATIONS to avoid infinite loops on misconfigured deps.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { supabase } from './lib/supabase.js';
import { logActivity } from './lib/activity.js';
import { isEligibleToRun, topoSortAgents } from './lib/schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Configuration ──────────────────────────────────────────────

const AGENT_SCRIPTS = {
  'data-fetcher':      { cmd: 'node', args: ['agents/data-fetcher.js'] },
  'research-agent':    { cmd: 'node', args: ['agents/research.js'] },
  'content-text-gen':  { cmd: 'node', args: ['agents/content.js'] },
  'content-renderer':  { cmd: 'node', args: ['agents/render-orchestrator.js'] },
  'strategist-daily':  { cmd: 'node', args: ['agents/strategist-daily.js'] },
  'strategist-weekly': { cmd: 'node', args: ['agents/strategist-weekly.js'] },
  'pipeline-monitor':  { cmd: 'node', args: ['agents/pipeline-monitor.js'] },
};

const SPAWN_TIMEOUT_MS = 600_000;   // 10 min per agent
const MAX_ITERATIONS   = 10;        // safety against cycles

// ── Agent spawning ─────────────────────────────────────────────

function spawnAgent(agent) {
  const script = AGENT_SCRIPTS[agent.slug];
  if (!script) {
    return Promise.resolve({
      status: 'failed',
      exit_code: -1,
      stdout: '',
      stderr: `No script mapping for slug: ${agent.slug}`,
    });
  }

  return new Promise((resolvePromise) => {
    const proc = spawn(script.cmd, script.args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolvePromise({ status: 'timeout', exit_code: null, stdout, stderr });
    }, SPAWN_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        status: code === 0 ? 'completed' : 'failed',
        exit_code: code,
        stdout,
        stderr,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        status: 'failed',
        exit_code: -1,
        stdout,
        stderr: `${stderr}\nSpawn error: ${err.message}`,
      });
    });
  });
}

// ── Run one agent end-to-end, persisting agent_runs + activity_log ──

async function executeAgent(agent, trigger = 'scheduled') {
  const startMs = Date.now();

  const { data: run, error: insertErr } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: agent.id,
      status: 'running',
      trigger,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertErr || !run) {
    console.error(`[orchestrator] Failed to create run for ${agent.slug}:`, insertErr?.message);
    return { status: 'failed', duration_ms: 0 };
  }

  await supabase
    .from('agents')
    .update({ status: 'running', last_run_at: new Date().toISOString() })
    .eq('id', agent.id);

  await logActivity({
    category:     'agent',
    actor_type:   'agent',
    actor_name:   agent.slug,
    action:       'agent_run_started',
    description:  `${agent.slug} started (trigger=${trigger})`,
    agent_run_id: run.id,
  });

  console.log(`[orchestrator] Spawning ${agent.slug} (run ${run.id}, trigger=${trigger})`);

  const result   = await spawnAgent(agent);
  const durMs    = Date.now() - startMs;
  const completed = result.status === 'completed';

  await supabase
    .from('agent_runs')
    .update({
      status: result.status,
      completed_at: new Date().toISOString(),
      output_data: {
        stdout: (result.stdout || '').slice(-2000),
        stderr: (result.stderr || '').slice(-1000),
      },
      error: !completed ? (result.stderr || '').slice(-500) : null,
    })
    .eq('id', run.id);

  await supabase
    .from('agents')
    .update({
      status: completed ? 'idle' : 'failed',
      last_run_status: result.status,
      last_run_duration_ms: durMs,
    })
    .eq('id', agent.id);

  await logActivity({
    category:     'agent',
    actor_type:   'agent',
    actor_name:   agent.slug,
    action:       completed ? 'agent_run_completed' : 'agent_run_failed',
    description:  completed
      ? `${agent.slug} completed in ${(durMs / 1000).toFixed(1)}s`
      : `${agent.slug} ${result.status}: ${(result.stderr || '').slice(-200) || '(no stderr)'}`,
    metadata:     { exit_code: result.exit_code, duration_ms: durMs },
    agent_run_id: run.id,
  });

  console.log(`[orchestrator] ${completed ? 'OK' : 'FAIL'} ${agent.slug} — ${result.status} in ${(durMs / 1000).toFixed(1)}s`);

  return { status: result.status, duration_ms: durMs, agent_run_id: run.id };
}

// ── Directive application (from V1, preserved) ─────────────────

async function applyPendingDirectives() {
  const { data } = await supabase
    .from('system_directives')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true });

  for (const d of data || []) {
    console.log(`[orchestrator] Applying directive: ${d.directive}`);
    await supabase
      .from('system_directives')
      .update({ status: 'active', applied_at: new Date().toISOString() })
      .eq('id', d.id);
  }
}

// ── Daily budget reset (from V1, preserved) ─────────────────────

async function resetDailyBudgets(agents) {
  const today = new Date().toISOString().split('T')[0];

  for (const agent of agents) {
    if (parseFloat(agent.cost_spent_today_usd || 0) === 0) continue;
    const lastRunDate = agent.last_run_at ? agent.last_run_at.split('T')[0] : null;
    if (lastRunDate === today) continue;

    await supabase
      .from('agents')
      .update({ cost_spent_today_usd: 0 })
      .eq('id', agent.id);
  }
}

// ── Timeout cleanup (from V1, preserved) ────────────────────────

async function checkTimedOutRuns() {
  const tenMinAgo = new Date(Date.now() - SPAWN_TIMEOUT_MS).toISOString();
  const { data: stale } = await supabase
    .from('agent_runs')
    .select('id, agent_id')
    .eq('status', 'running')
    .lt('started_at', tenMinAgo);

  for (const run of stale || []) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'timeout',
        completed_at: new Date().toISOString(),
        error: 'Timed out (exceeded 10 min)',
      })
      .eq('id', run.id);

    await supabase
      .from('agents')
      .update({ status: 'failed', last_run_status: 'timeout' })
      .eq('id', run.agent_id);

    await logActivity({
      category:     'agent',
      actor_type:   'system',
      actor_name:   'system-orchestrator',
      action:       'agent_run_timed_out',
      description:  `Run ${run.id} marked timed-out after 10 min`,
      agent_run_id: run.id,
    });
  }
}

// ── Orchestrator self-logging ───────────────────────────────────

async function findOrchestratorAgentId() {
  const { data } = await supabase
    .from('agents')
    .select('id')
    .eq('slug', 'system-orchestrator')
    .maybeSingle();
  return data?.id ?? null;
}

async function logOrchestratorStart(now) {
  const orchId = await findOrchestratorAgentId();
  if (!orchId) return null;

  const { data } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: orchId,
      status: 'running',
      trigger: 'scheduled',
      started_at: now.toISOString(),
    })
    .select()
    .single();

  await logActivity({
    category:     'system',
    actor_type:   'system',
    actor_name:   'system-orchestrator',
    action:       'orchestrator_tick_started',
    description:  'Orchestrator tick started',
    agent_run_id: data?.id,
  });

  return data?.id ?? null;
}

async function logOrchestratorEnd(orchRunId, summary) {
  if (!orchRunId) return;

  const status = summary.error ? 'failed' : 'completed';

  await supabase
    .from('agent_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      output_data: summary,
      error: summary.error ? String(summary.error).slice(-500) : null,
    })
    .eq('id', orchRunId);

  await logActivity({
    category:     'system',
    actor_type:   'system',
    actor_name:   'system-orchestrator',
    action:       'orchestrator_tick_completed',
    description:  `Orchestrator ran ${summary.executions.length} agent(s) across ${summary.iterations} iteration(s)`,
    metadata:     summary,
    agent_run_id: orchRunId,
  });
}

// ── Main orchestration cycle ───────────────────────────────────

async function orchestrate() {
  const now = new Date();
  console.log(`[orchestrator] Cycle start — ${now.toISOString()}`);

  const orchRunId = await logOrchestratorStart(now);
  const summary = {
    start_iso:   now.toISOString(),
    evaluations: [],
    executions:  [],
    iterations:  0,
    error:       null,
  };

  try {
    await applyPendingDirectives();

    // Fetch all agents once, reset budgets (cheap, daily-rolled)
    const { data: rawAgents, error: fetchErr } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: true });

    if (fetchErr) throw fetchErr;

    await resetDailyBudgets(rawAgents || []);

    // Topologically sort so upstreams execute before downstreams
    // within a single iteration.
    const agents = topoSortAgents(rawAgents || []);
    console.log(`[orchestrator] Evaluating ${agents.length} agent(s); order: ${agents.map((a) => a.slug).join(' → ')}`);

    // Iterate: find one eligible agent, run it to completion, then
    // re-fetch and re-evaluate (a newly-completed upstream unblocks
    // downstream within the same tick).
    while (summary.iterations < MAX_ITERATIONS) {
      summary.iterations += 1;

      const { data: refreshed } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true });
      const sorted = topoSortAgents(refreshed || []);

      let toRun = null;
      for (const agent of sorted) {
        // Skip agents without scripts
        if (agent.agent_type !== 'orchestrator' && !AGENT_SCRIPTS[agent.slug]) {
          summary.evaluations.push({
            iteration: summary.iterations,
            slug: agent.slug,
            eligible: false,
            reason: 'no_script_mapping',
          });
          continue;
        }

        const eligibility = await isEligibleToRun(agent, now, supabase);
        summary.evaluations.push({
          iteration: summary.iterations,
          slug: agent.slug,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          ...(eligibility.missing ? { missing: eligibility.missing } : {}),
        });

        if (eligibility.eligible) {
          toRun = agent;
          break;
        }

        const quietReasons = new Set([
          'not_yet_due', 'already_completed', 'already_running',
          'event_triggered', 'is_orchestrator', 'disabled',
        ]);
        if (!eligibility.eligible && !quietReasons.has(eligibility.reason)) {
          await logActivity({
            category:    'debug',
            actor_type:  'system',
            actor_name:  'system-orchestrator',
            action:      'agent_skip',
            description: `Skipped ${agent.slug}: ${eligibility.reason}`,
            metadata:    { iteration: summary.iterations, reason: eligibility.reason },
          });
        }
      }

      if (!toRun) break;  // nothing more eligible this tick

      const result = await executeAgent(toRun, 'scheduled');
      summary.executions.push({
        slug:        toRun.slug,
        status:      result.status,
        duration_ms: result.duration_ms,
      });

      // Loop continues: re-fetch state and evaluate again.
    }

    await checkTimedOutRuns();
  } catch (err) {
    summary.error = err?.message || String(err);
    console.error('[orchestrator] Fatal error:', err);
  } finally {
    await logOrchestratorEnd(orchRunId, summary);
  }

  const elapsed = ((Date.now() - now.getTime()) / 1000).toFixed(1);
  console.log(`[orchestrator] Cycle complete — ${summary.executions.length} agent(s) spawned in ${elapsed}s`);
}

// ── Entry point ────────────────────────────────────────────────

orchestrate().catch((err) => {
  console.error('[orchestrator] Unhandled error:', err);
  process.exit(1);
});
