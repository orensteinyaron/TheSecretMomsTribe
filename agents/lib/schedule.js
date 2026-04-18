/**
 * Schedule utilities for Orchestrator V2.
 *
 * Core idea (vs. V1's window-matching): an agent is eligible to run when
 * its most-recent scheduled tick is in the past AND no completed run exists
 * since that tick AND all deps have completed since the start of the
 * relevant window (daily-UTC for daily agents, per-hour for hourly ones).
 *
 * This lets a single orchestrator tick cascade the full chain via
 * sequential re-evaluation and catches up from missed cron ticks.
 */

// ── schedule parsing ────────────────────────────────────────────

/**
 * Returns the most recent scheduled tick in the past (<= now) for `schedule`,
 * or null if the schedule is unsupported or has never fired in the past.
 *
 * Supported forms:
 *   - "M H * * *"         daily @ H:M UTC
 *   - "M H * * DOW"       weekly on that DOW (0=Sun..6=Sat), H:M UTC
 *   - "M H * * DOW,DOW"   weekly on multiple DOWs
 *   - "M * * * *"         hourly @ :M of every UTC hour
 *
 * Unsupported: DOM, MON, ranges, comma-lists in M or H, "*\u002fN" step specs.
 */
export function getLastScheduledTime(schedule, now = new Date()) {
  if (!schedule || schedule === 'event_triggered') return null;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [m, h, dom, mon, dow] = parts;

  if (dom !== '*' || mon !== '*') return null;
  if (!/^\d+$/.test(m)) return null;
  const minute = parseInt(m, 10);
  if (minute < 0 || minute > 59) return null;

  // Hourly: minute fixed, hour wildcard
  if (h === '*') {
    if (dow !== '*') return null; // hour-wildcard + DOW not used in this project
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      now.getUTCHours(), minute, 0, 0,
    ));
    if (candidate > now) {
      candidate.setUTCHours(candidate.getUTCHours() - 1);
    }
    return candidate;
  }

  // Daily or weekly: hour must be numeric
  if (!/^\d+$/.test(h)) return null;
  const hour = parseInt(h, 10);
  if (hour < 0 || hour > 23) return null;

  // Candidate = today at H:M UTC
  let candidate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    hour, minute, 0, 0,
  ));
  if (candidate > now) {
    candidate = new Date(candidate.getTime() - 24 * 3600 * 1000);
  }

  // Daily (dow = '*'): return candidate as-is
  if (dow === '*') return candidate;

  // Weekly: walk back until DOW matches
  const dows = dow.split(',').map((s) => s.trim());
  if (!dows.every((s) => /^\d+$/.test(s))) return null;
  const targetDows = new Set(dows.map((s) => parseInt(s, 10)));
  for (let i = 0; i < 7; i += 1) {
    if (targetDows.has(candidate.getUTCDay())) return candidate;
    candidate = new Date(candidate.getTime() - 24 * 3600 * 1000);
  }
  return null;
}

export function getTodayStartUTC(now = new Date()) {
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0,
  ));
}

/**
 * For dependency checks: what window do "today's completed deps" mean for
 * this agent's schedule? Daily agents look back to today's UTC 00:00 start.
 * Hourly agents look back to the most recent scheduled tick.
 */
export function getDependencyWindowStart(schedule, now = new Date()) {
  const parts = (schedule || '').trim().split(/\s+/);
  // Hourly: scope deps to "since the last scheduled tick"
  if (parts.length === 5 && parts[1] === '*') {
    return getLastScheduledTime(schedule, now) ?? getTodayStartUTC(now);
  }
  return getTodayStartUTC(now);
}

// ── eligibility ─────────────────────────────────────────────────

/**
 * Decide whether `agent` should run right now.
 *
 * Returns { eligible, reason, ...context }.
 * Reasons:
 *   disabled | is_orchestrator | event_triggered | unparseable_schedule
 *   | not_yet_due | already_completed | already_running
 *   | dependencies_not_met | budget_exhausted | db_error_* | eligible
 */
export async function isEligibleToRun(agent, now, supabase) {
  if (!agent) return { eligible: false, reason: 'no_agent' };
  if (agent.status === 'disabled') return { eligible: false, reason: 'disabled' };
  if (agent.agent_type === 'orchestrator') return { eligible: false, reason: 'is_orchestrator' };
  if (agent.schedule === 'event_triggered') return { eligible: false, reason: 'event_triggered' };

  const lastScheduled = getLastScheduledTime(agent.schedule, now);
  if (!lastScheduled) return { eligible: false, reason: 'unparseable_schedule' };
  if (lastScheduled > now) return { eligible: false, reason: 'not_yet_due', lastScheduled };

  // Any run since the last scheduled tick?
  const { data: sinceSchedule, error: runsErr } = await supabase
    .from('agent_runs')
    .select('id, status, started_at')
    .eq('agent_id', agent.id)
    .gte('started_at', lastScheduled.toISOString());

  if (runsErr) return { eligible: false, reason: 'db_error_runs', error: runsErr.message };

  if (sinceSchedule?.some((r) => r.status === 'completed')) {
    return { eligible: false, reason: 'already_completed', lastScheduled };
  }
  if (sinceSchedule?.some((r) => r.status === 'running')) {
    return { eligible: false, reason: 'already_running' };
  }

  // Budget
  const budget = parseFloat(agent.cost_budget_daily_usd ?? Infinity);
  const spent  = parseFloat(agent.cost_spent_today_usd ?? 0);
  if (Number.isFinite(budget) && budget > 0 && spent >= budget) {
    return { eligible: false, reason: 'budget_exhausted', spent, budget };
  }

  // Dependencies within the appropriate window
  if (Array.isArray(agent.depends_on) && agent.depends_on.length > 0) {
    const windowStart = getDependencyWindowStart(agent.schedule, now);
    const { data: depRuns, error: depErr } = await supabase
      .from('agent_runs')
      .select('agent_id, status')
      .in('agent_id', agent.depends_on)
      .eq('status', 'completed')
      .gte('started_at', windowStart.toISOString());

    if (depErr) return { eligible: false, reason: 'db_error_deps', error: depErr.message };

    const completed = new Set((depRuns || []).map((r) => r.agent_id));
    const missing   = agent.depends_on.filter((id) => !completed.has(id));
    if (missing.length > 0) {
      return { eligible: false, reason: 'dependencies_not_met', missing };
    }
  }

  return { eligible: true, reason: 'eligible', lastScheduled };
}

// ── topological sort (Kahn's) ───────────────────────────────────

export function topoSortAgents(agents) {
  const byId  = new Map(agents.map((a) => [a.id, a]));
  const indeg = new Map(agents.map((a) => [a.id, 0]));

  for (const a of agents) {
    for (const dep of a.depends_on || []) {
      if (byId.has(dep)) indeg.set(a.id, (indeg.get(a.id) || 0) + 1);
    }
  }

  const queue  = agents.filter((a) => (indeg.get(a.id) || 0) === 0);
  const sorted = [];
  const seen   = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    sorted.push(node);
    for (const other of agents) {
      if ((other.depends_on || []).includes(node.id)) {
        indeg.set(other.id, indeg.get(other.id) - 1);
        if (indeg.get(other.id) === 0) queue.push(other);
      }
    }
  }

  for (const a of agents) {
    if (!seen.has(a.id)) sorted.push(a);
  }
  return sorted;
}
