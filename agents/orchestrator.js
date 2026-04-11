/**
 * System Orchestrator — SMT Agent Lifecycle Manager
 *
 * Replaces all cron-based GitHub Actions with a single entry point.
 * Runs every 15 minutes: checks schedules, spawns agents, handles
 * retries, applies directives, and enforces cost budgets.
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Env validation ──────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Orchestrator] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Agent script mapping ────────────────────────────────────

const AGENT_SCRIPTS = {
  'data-fetcher':     { cmd: 'node', args: ['agents/data-fetcher.js'] },
  'research-agent':   { cmd: 'node', args: ['agents/research.js'] },
  'content-text-gen': { cmd: 'node', args: ['agents/content.js'] },
  'content-renderer': { cmd: 'node', args: ['agents/render-orchestrator.js'] },
  'strategist-daily': { cmd: 'node', args: ['agents/strategist-daily.js'] },
  'strategist-weekly': { cmd: 'node', args: ['agents/strategist-weekly.js'] },
};

const SPAWN_TIMEOUT_MS = 600_000; // 10 minutes

// ── Cron matching ───────────────────────────────────────────

// The orchestrator runs every 15 minutes via GitHub Actions, but GH Actions
// adds 1-5 min of delay to cron triggers. Exact-minute matching will NEVER
// work reliably. Instead, we use window-based matching: an agent's scheduled
// time is considered "matched" if it falls within the current 15-minute window.

const ORCHESTRATOR_INTERVAL_MIN = 15;

/**
 * Checks whether a cron field matches a value.
 * Supports: *, specific numbers, star-slash-N step values, and comma-separated lists.
 */
function matchesField(field, value) {
  if (field === '*') return true;

  // Step: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }

  // Comma-separated list: 1,3,5
  if (field.includes(',')) {
    return field.split(',').some(v => parseInt(v.trim(), 10) === value);
  }

  // Range: 1-5
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(v => parseInt(v.trim(), 10));
    return value >= lo && value <= hi;
  }

  // Exact number
  return parseInt(field, 10) === value;
}

/**
 * Window-based cron matching. Returns true if the agent's scheduled time
 * falls within [now - ORCHESTRATOR_INTERVAL_MIN, now].
 *
 * For the minute field, we check if the scheduled minute is within
 * the window. For hour/dom/month/dow we still do exact matching.
 */
function shouldRunNow(schedule, now = new Date()) {
  if (!schedule || schedule === 'event_triggered') return false;

  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minuteField, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Hour, day, month, dow must match exactly
  if (!matchesField(hour, now.getHours())) return false;
  if (!matchesField(dayOfMonth, now.getDate())) return false;
  if (!matchesField(month, now.getMonth() + 1)) return false;
  if (!matchesField(dayOfWeek, now.getDay())) return false;

  // Minute: use window matching
  if (minuteField === '*' || minuteField.startsWith('*/')) {
    return matchesField(minuteField, now.getMinutes());
  }

  // For specific minutes (e.g., "30", "0", "15"), check if it falls
  // within the window [now - interval, now]
  const scheduledMinute = parseInt(minuteField, 10);
  const currentMinute = now.getMinutes();

  // Window: [currentMinute - interval, currentMinute]
  // Handle wrap-around at 60
  const windowStart = currentMinute - ORCHESTRATOR_INTERVAL_MIN;

  if (windowStart >= 0) {
    return scheduledMinute > windowStart && scheduledMinute <= currentMinute;
  } else {
    // Wrapped: e.g., current=5, window=[-10,5] → [50,5]
    return scheduledMinute > (60 + windowStart) || scheduledMinute <= currentMinute;
  }
}

// ── Directive application ───────────────────────────────────

async function applyPendingDirectives() {
  const { data, error } = await supabase
    .from('system_directives')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true });

  if (error) {
    console.error('[Orchestrator] Failed to fetch directives:', error.message);
    return;
  }

  for (const d of data || []) {
    console.log(`[Orchestrator] Applying directive: ${d.directive}`);
    await supabase
      .from('system_directives')
      .update({ status: 'active', applied_at: new Date().toISOString() })
      .eq('id', d.id);
  }
}

// ── Daily budget reset ──────────────────────────────────────

async function resetDailyBudgets(agents) {
  const today = new Date().toISOString().split('T')[0];

  for (const agent of agents) {
    // Skip if cost already zero or last run was today (no stale cost to reset)
    if (parseFloat(agent.cost_spent_today_usd || 0) === 0) continue;

    // Check if last run was before today — if so, reset the counter
    const lastRunDate = agent.last_run_at ? agent.last_run_at.split('T')[0] : null;
    if (lastRunDate === today) continue;

    await supabase
      .from('agents')
      .update({ cost_spent_today_usd: 0 })
      .eq('id', agent.id);

    console.log(`[Orchestrator] Reset daily budget for ${agent.slug}`);
  }
}

// ── Dependency check ────────────────────────────────────────

async function dependenciesCompleted(agent) {
  if (!agent.depends_on || agent.depends_on.length === 0) return true;

  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('agent_runs')
    .select('agent_id, status')
    .in('agent_id', agent.depends_on)
    .eq('status', 'completed')
    .gte('started_at', today);

  const completedIds = new Set((data || []).map((r) => r.agent_id));
  return agent.depends_on.every((id) => completedIds.has(id));
}

// ── Already-ran-today check ─────────────────────────────────

async function alreadyRanToday(agentId) {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'completed')
    .gte('started_at', today);

  return (count || 0) > 0;
}

// ── Agent spawning ──────────────────────────────────────────

function spawnAgent(agent) {
  const script = AGENT_SCRIPTS[agent.slug];
  if (!script) {
    console.error(`[Orchestrator] No script mapping for slug: ${agent.slug}`);
    return Promise.resolve({ status: 'failed', exit_code: -1, stdout: '', stderr: 'No script mapping' });
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

// ── Run an agent end-to-end ─────────────────────────────────

async function runAgent(agent, trigger = 'scheduled') {
  const startMs = Date.now();

  // Create run record
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
    console.error(`[Orchestrator] Failed to create run for ${agent.slug}:`, insertErr?.message);
    return;
  }

  // Mark agent as running
  await supabase
    .from('agents')
    .update({ status: 'running', last_run_at: new Date().toISOString() })
    .eq('id', agent.id);

  console.log(`[Orchestrator] Spawning ${agent.slug} (run ${run.id}, trigger: ${trigger})`);

  // Spawn and wait
  const result = await spawnAgent(agent);

  const durationMs = Date.now() - startMs;

  // Update run record
  await supabase
    .from('agent_runs')
    .update({
      status: result.status,
      completed_at: new Date().toISOString(),
      output_data: {
        stdout: result.stdout.slice(-2000),
        stderr: result.stderr.slice(-1000),
      },
      error: result.status !== 'completed' ? result.stderr.slice(-500) : null,
    })
    .eq('id', run.id);

  // Update agent status
  await supabase
    .from('agents')
    .update({
      status: result.status === 'completed' ? 'idle' : 'failed',
      last_run_status: result.status,
      last_run_duration_ms: durationMs,
    })
    .eq('id', agent.id);

  const icon = result.status === 'completed' ? 'OK' : 'FAIL';
  console.log(`[Orchestrator] ${icon} ${agent.slug} — ${result.status} in ${(durationMs / 1000).toFixed(1)}s`);

  if (result.status !== 'completed' && result.stderr) {
    console.error(`[Orchestrator] stderr (${agent.slug}): ${result.stderr.slice(-300)}`);
  }
}

// ── Timeout detection ───────────────────────────────────────

async function checkTimedOutRuns() {
  const tenMinAgo = new Date(Date.now() - SPAWN_TIMEOUT_MS).toISOString();

  const { data: staleRuns } = await supabase
    .from('agent_runs')
    .select('id, agent_id')
    .eq('status', 'running')
    .lt('started_at', tenMinAgo);

  for (const run of staleRuns || []) {
    console.log(`[Orchestrator] Marking timed-out run ${run.id}`);

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
  }
}

// ── Retry logic ─────────────────────────────────────────────

async function processRetries() {
  const { data: failedAgents } = await supabase
    .from('agents')
    .select('*')
    .eq('status', 'failed')
    .neq('agent_type', 'orchestrator');

  for (const agent of failedAgents || []) {
    if (!AGENT_SCRIPTS[agent.slug]) continue;

    const retryPolicy = agent.retry_policy || { max_retries: 3, backoff_ms: 5000 };
    const today = new Date().toISOString().split('T')[0];

    const { count } = await supabase
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agent.id)
      .eq('status', 'failed')
      .gte('started_at', today);

    if ((count || 0) < retryPolicy.max_retries) {
      console.log(
        `[Orchestrator] Retrying ${agent.slug} (attempt ${(count || 0) + 1}/${retryPolicy.max_retries})`
      );
      await runAgent(agent, 'retry');
    }
  }
}

// ── Main orchestration cycle ────────────────────────────────

async function orchestrate() {
  const startMs = Date.now();
  const now = new Date();

  console.log(`[Orchestrator] Cycle start — ${now.toISOString()}`);

  // 1. Apply pending directives
  await applyPendingDirectives();

  // 2. Fetch all agents ordered by schedule priority
  const { data: agents, error } = await supabase
    .from('agents')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Orchestrator] Failed to fetch agents:', error.message);
    process.exit(1);
  }

  if (!agents || agents.length === 0) {
    console.log('[Orchestrator] No agents found in database');
    process.exit(0);
  }

  // 3. Reset daily budgets
  await resetDailyBudgets(agents);

  // 4. Evaluate each agent
  let spawned = 0;

  console.log(`[Orchestrator] Evaluating ${agents.length} agent(s) at ${now.toISOString()} (H:${now.getHours()} M:${now.getMinutes()})`);

  for (const agent of agents) {
    // Skip orchestrator itself
    if (agent.agent_type === 'orchestrator') continue;

    // Skip event-triggered agents
    if (agent.schedule === 'event_triggered') continue;

    // Skip if no script mapping
    if (!AGENT_SCRIPTS[agent.slug]) {
      console.log(`[Orchestrator]   ${agent.slug}: no script mapping — skip`);
      continue;
    }

    // Skip disabled or currently running agents
    if (agent.status === 'disabled') {
      console.log(`[Orchestrator]   ${agent.slug}: disabled — skip`);
      continue;
    }
    if (agent.status === 'running') {
      console.log(`[Orchestrator]   ${agent.slug}: still running — skip`);
      continue;
    }

    // Skip if schedule doesn't match current time window
    const scheduleMatch = shouldRunNow(agent.schedule, now);
    if (!scheduleMatch) {
      console.log(`[Orchestrator]   ${agent.slug}: schedule "${agent.schedule}" not in window — skip`);
      continue;
    }

    // Skip if dependencies haven't completed today
    const depsOk = await dependenciesCompleted(agent);
    if (!depsOk) {
      console.log(`[Orchestrator]   ${agent.slug}: deps ${JSON.stringify(agent.depends_on)} not met — skip`);
      continue;
    }

    // Skip if over daily cost budget
    const budget = agent.cost_budget_daily_usd || Infinity;
    const spent = agent.cost_spent_today_usd || 0;
    if (spent >= budget) {
      console.log(`[Orchestrator]   ${agent.slug}: budget exhausted ($${spent.toFixed(2)}/$${budget.toFixed(2)}) — skip`);
      continue;
    }

    // Skip if already ran successfully today (avoid double runs)
    if (await alreadyRanToday(agent.id)) {
      console.log(`[Orchestrator]   ${agent.slug}: already completed today — skip`);
      continue;
    }

    // All checks passed — spawn
    console.log(`[Orchestrator]   ${agent.slug}: ALL CHECKS PASSED — spawning`);
    await runAgent(agent, 'scheduled');
    spawned++;
  }

  // 5. Check for timed-out runs
  await checkTimedOutRuns();

  // 6. Process retries for failed agents
  await processRetries();

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[Orchestrator] Cycle complete — ${spawned} agent(s) spawned in ${elapsed}s`);
}

// ── Entry point ─────────────────────────────────────────────

orchestrate().catch((err) => {
  console.error('[Orchestrator] Fatal error:', err);
  process.exit(1);
});
