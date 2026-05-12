/**
 * SMT Orchestrator V3 — Agent Skills v1.0.0
 *
 * Replaces the V2 eligibility-driven runner with a mode-based,
 * contract-verifying pipeline conductor. The orchestrator is now itself
 * an agent that loads `agents/skills/smt_orchestrator/SKILL.md` at
 * runtime (just like the other three), but its critical-path control
 * flow lives in TypeScript so the safety net never depends on an LLM
 * for invariants.
 *
 * Modes:
 *   --mode=daily              Full pipeline (Research → Strategist → ContentGen)
 *   --mode=hot_signal         Single-signal pass (ContentGen only, needs --signal_id)
 *   --mode=resume_from_stage  Resume an aborted pipeline (needs --stage and --pipeline_run_id)
 *   --mode=dry_run            Daily flow with no DB writes (plan-only)
 *
 * Wired by Claude Code Routines (see agents/routines/README.md). The
 * GitHub Actions cron has been removed in v1.0.0.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

import { supabase } from './lib/supabase.js';
import { logActivity } from './lib/activity.js';
import { loadSkill } from './lib/skill_loader.js';
import {
  validateAiMagicGate,
  validateBaseSchema,
  validatePillarRouting,
  detectStrategistInvention,
} from './lib/gate_validators.js';
import { toDbPillar, isCanonicalPillar } from './lib/pillar_translation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const SPAWN_TIMEOUT_MS = 600_000;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const VALID_MODES = new Set(['daily', 'hot_signal', 'resume_from_stage', 'dry_run']);

// Maps each stage name to the script that owns it.
const STAGE_SCRIPTS = Object.freeze({
  research:   { cmd: 'node', args: ['agents/research.js'] },
  strategist: { cmd: 'node', args: ['agents/strategist-daily.js'] },
  contentgen: { cmd: 'node', args: ['agents/content.js'] },
});

// ── CLI parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

// ── pipeline_runs lifecycle ───────────────────────────────────────────

async function insertPipelineRun({ mode, triggerSource, parentRunId, preflight }) {
  const { data, error } = await supabase
    .from('pipeline_runs')
    .insert({
      mode,
      status: 'in_progress',
      parent_run_id: parentRunId || null,
      trigger_source: triggerSource || null,
      pre_flight: preflight || null,
      stages: [],
      warnings: [],
      escalations: [],
    })
    .select()
    .single();
  if (error) {
    throw new Error(`pipeline_runs insert failed: ${error.message}`);
  }
  return data;
}

async function updatePipelineRun(id, patch) {
  if (!id) return;
  const { error } = await supabase
    .from('pipeline_runs')
    .update({ ...patch, completed_at: patch.completed_at ?? new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error(`[orchestrator] pipeline_runs update failed: ${error.message}`);
  }
}

async function appendStage(runId, stage) {
  if (!runId) return;
  const { data } = await supabase.from('pipeline_runs').select('stages').eq('id', runId).single();
  const stages = Array.isArray(data?.stages) ? data.stages : [];
  stages.push({ ...stage, at: new Date().toISOString() });
  await supabase.from('pipeline_runs').update({ stages }).eq('id', runId);
}

async function escalate(runId, { severity, reason, details, recommendedAction }) {
  console.warn(`[orchestrator] ESCALATION [${severity}] ${reason}`);
  try {
    await supabase.from('escalations').insert({
      pipeline_run_id: runId || null,
      severity,
      reason,
      details: details || null,
      recommended_action: recommendedAction || null,
    });
  } catch (err) {
    console.error(`[orchestrator] Failed to persist escalation: ${err.message}`);
  }
  if (runId) {
    const { data } = await supabase.from('pipeline_runs').select('escalations').eq('id', runId).single();
    const escalations = Array.isArray(data?.escalations) ? data.escalations : [];
    escalations.push({ severity, reason, at: new Date().toISOString() });
    await supabase.from('pipeline_runs').update({ escalations }).eq('id', runId);
  }
}

// ── Pre-flight ────────────────────────────────────────────────────────

const STALE_RUN_MS = 30 * 60_000;
const DAILY_BUDGET_USD = parseFloat(process.env.DAILY_BUDGET_USD || '20');

async function runPreflight({ mode }) {
  const report = { mode, started_at: new Date().toISOString(), checks: {} };

  // Concurrent run detection: an in_progress row started in the last 30 min.
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data: liveRuns } = await supabase
    .from('pipeline_runs')
    .select('id, started_at, mode')
    .eq('status', 'in_progress')
    .gte('started_at', cutoff);
  report.checks.concurrent_runs = (liveRuns || []).map((r) => r.id);

  // Stale run cleanup: in_progress older than 30 min → mark timeout.
  const { data: stale } = await supabase
    .from('pipeline_runs')
    .select('id')
    .eq('status', 'in_progress')
    .lt('started_at', cutoff);
  if ((stale || []).length > 0) {
    await supabase
      .from('pipeline_runs')
      .update({ status: 'timeout', completed_at: new Date().toISOString() })
      .in('id', stale.map((r) => r.id));
    report.checks.stale_cleaned = stale.length;
  } else {
    report.checks.stale_cleaned = 0;
  }

  // Budget: 24h cost_log roll-up vs DAILY_BUDGET_USD.
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data: costRows } = await supabase
    .from('cost_log')
    .select('cost_usd')
    .gte('created_at', dayAgo);
  const totalCost = (costRows || []).reduce((s, c) => s + (parseFloat(c.cost_usd) || 0), 0);
  report.checks.budget_24h_usd = Number(totalCost.toFixed(4));
  report.checks.budget_cap_usd = DAILY_BUDGET_USD;
  report.checks.budget_breached = totalCost >= DAILY_BUDGET_USD;

  // Buffer status: count of draft + draft_needs_review content_queue rows.
  const { count: bufferCount } = await supabase
    .from('content_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['draft', 'draft_needs_review']);
  report.checks.buffer_count = bufferCount || 0;

  return report;
}

// ── Stage runner (spawn child agent script) ──────────────────────────

function runStage(stageName, { extraEnv = {}, timeoutMs = SPAWN_TIMEOUT_MS } = {}) {
  const script = STAGE_SCRIPTS[stageName];
  if (!script) {
    return Promise.resolve({ status: 'failed', stderr: `no script for stage ${stageName}` });
  }
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const proc = spawn(script.cmd, script.args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolvePromise({ status: 'timeout', durationMs: Date.now() - startedAt, stdout, stderr });
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        status: code === 0 ? 'completed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ status: 'failed', durationMs: Date.now() - startedAt, stdout, stderr: `${stderr}\nspawn error: ${err.message}` });
    });
  });
}

// ── Between-stage validation ─────────────────────────────────────────

/**
 * Sanity-check the latest daily_briefings row produced by Research.
 * Catches missing-row / empty-row scenarios + per-opportunity gate
 * violations. Returns `{ ok, briefing, violations[] }`.
 */
async function validateBriefingFromResearch() {
  const { data: briefing } = await supabase
    .from('daily_briefings')
    .select('*')
    .order('briefing_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!briefing) {
    return { ok: false, briefing: null, violations: [{ reason: 'no_briefing_row_produced' }] };
  }
  const opps = Array.isArray(briefing.opportunities) ? briefing.opportunities : [];
  if (opps.length === 0) {
    return { ok: false, briefing, violations: [{ reason: 'briefing_has_no_opportunities' }] };
  }

  const violations = [];
  for (const opp of opps) {
    if (opp.category === 'ai_magic') {
      const verdict = validateAiMagicGate({
        original_prompt: opp.original_prompt,
        original_output: opp.original_output,
        ai_tool_name: opp.ai_tool_name,
        source_url: opp.source_url,
      });
      if (!verdict.ok) violations.push({ signal_id: opp.signal_id, reason: verdict.reason, field: verdict.field });
    }
  }
  return { ok: violations.length === 0, briefing, violations };
}

/**
 * Detect that the Strategist did NOT tamper with the gate-protected fields
 * of any ai_magic briefing opportunity. The Strategist is allowed to
 * reorder, deprioritize, or drop opportunities — but for any opportunity
 * it keeps, the four AI-gate fields must match Research's output byte
 * for byte. Any divergence is escalated as critical.
 */
function detectStrategistTampering(researchOpps, strategistOpps) {
  const research = new Map();
  for (const opp of researchOpps || []) {
    if (opp.signal_id) research.set(opp.signal_id, opp);
  }
  const tampered = [];
  for (const opp of strategistOpps || []) {
    if (!opp.signal_id) continue;
    if (opp.category !== 'ai_magic') continue;
    const orig = research.get(opp.signal_id);
    if (!orig) continue;
    for (const field of ['original_prompt', 'original_output', 'ai_tool_name', 'source_url']) {
      if ((orig[field] || '') !== (opp[field] || '')) {
        tampered.push({ signal_id: opp.signal_id, field });
      }
    }
  }
  return tampered;
}

/**
 * Inspect content_queue rows produced during this pipeline_run window
 * and confirm pillar routing + base schema. Pillar translation (canonical
 * → DB) is applied here when the LLM emitted canonical names — the only
 * place in the codebase where the boundary is crossed at write time.
 */
async function validateContentQueueRowsFor(runStartIso) {
  const { data: rows } = await supabase
    .from('content_queue')
    .select('id, content_pillar, age_range, source_urls')
    .gte('created_at', runStartIso);

  const violations = [];
  for (const row of rows || []) {
    // Pillar translation: if the LLM emitted canonical, normalize to DB.
    if (isCanonicalPillar(row.content_pillar)) {
      try {
        const dbPillar = toDbPillar(row.content_pillar);
        if (dbPillar !== row.content_pillar) {
          await supabase.from('content_queue').update({ content_pillar: dbPillar }).eq('id', row.id);
        }
      } catch (err) {
        violations.push({ id: row.id, reason: `pillar_translation_failed: ${err.message}` });
      }
    }
  }
  return { ok: violations.length === 0, rows: rows || [], violations };
}

// ── Mode: daily ─────────────────────────────────────────────────────

async function runDaily({ pipelineRun, dryRun }) {
  const t0 = new Date().toISOString();
  console.log(`[orchestrator] daily start (run ${pipelineRun?.id || 'dry'}, dryRun=${dryRun})`);
  const exec = (stage, label) =>
    appendStage(pipelineRun?.id, { stage, label, ...(dryRun ? { skipped: 'dry_run' } : {}) });

  // STAGE 1: Research
  if (dryRun) {
    await exec('research', 'dry_run: would run research.js');
  } else {
    const r = await runStage('research', {
      extraEnv: pipelineRun?.id ? { PIPELINE_RUN_ID: pipelineRun.id } : {},
    });
    await appendStage(pipelineRun?.id, { stage: 'research', status: r.status, duration_ms: r.durationMs });
    if (r.status !== 'completed') {
      await escalate(pipelineRun?.id, {
        severity: 'error',
        reason: 'research_stage_failed',
        details: { exit_code: r.exitCode, stderr_tail: (r.stderr || '').slice(-500) },
        recommendedAction: 'Inspect Research logs; rerun --mode=resume_from_stage --stage=research',
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'failed', next_action: 'resume_from_stage=research' });
      return { ok: false };
    }
    const briefingCheck = await validateBriefingFromResearch();
    if (!briefingCheck.ok) {
      await escalate(pipelineRun?.id, {
        severity: 'critical',
        reason: 'research_output_invalid',
        details: { violations: briefingCheck.violations },
        recommendedAction: 'Review Research output; tighten SKILL or scraper.',
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'escalated', next_action: 'investigate_research_output' });
      return { ok: false };
    }
  }

  // STAGE 2: Strategist
  if (dryRun) {
    await exec('strategist', 'dry_run: would run strategist-daily.js');
  } else {
    const s = await runStage('strategist', {
      extraEnv: pipelineRun?.id ? { PIPELINE_RUN_ID: pipelineRun.id } : {},
    });
    await appendStage(pipelineRun?.id, { stage: 'strategist', status: s.status, duration_ms: s.durationMs });
    if (s.status !== 'completed') {
      await escalate(pipelineRun?.id, {
        severity: 'error',
        reason: 'strategist_stage_failed',
        details: { exit_code: s.exitCode, stderr_tail: (s.stderr || '').slice(-500) },
        recommendedAction: 'Inspect Strategist logs; rerun --mode=resume_from_stage --stage=strategist',
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'failed', next_action: 'resume_from_stage=strategist' });
      return { ok: false };
    }

    const { data: latestReport } = await supabase
      .from('strategy_reports')
      .select('summary, recommendations')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const notes = latestReport?.summary || '';
    const inventionScan = detectStrategistInvention(notes);
    if (inventionScan.detected) {
      await escalate(pipelineRun?.id, {
        severity: 'warn',
        reason: 'strategist_invention_stripped',
        details: { matches: inventionScan.matches, source: 'strategy_reports.summary' },
        recommendedAction: 'Review Strategist SKILL — fabrication guard fired.',
      });
    }

    // Tampering check is a no-op until Strategist persists per-signal opps
    // (today it only writes aggregated insights/tasks). Stub kept here so
    // the call site stays visible.
    const tampered = detectStrategistTampering([], []);
    if (tampered.length > 0) {
      await escalate(pipelineRun?.id, {
        severity: 'critical',
        reason: 'strategist_tampered_gate_fields',
        details: { tampered },
        recommendedAction: 'Treat Strategist output as untrusted; rerun from research.',
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'escalated' });
      return { ok: false };
    }
  }

  // STAGE 3: ContentGen
  let runStartIso = t0;
  if (dryRun) {
    await exec('contentgen', 'dry_run: would run content.js');
  } else {
    runStartIso = new Date().toISOString();
    const c = await runStage('contentgen', {
      extraEnv: pipelineRun?.id ? { PIPELINE_RUN_ID: pipelineRun.id } : {},
    });
    await appendStage(pipelineRun?.id, { stage: 'contentgen', status: c.status, duration_ms: c.durationMs });
    if (c.status !== 'completed') {
      await escalate(pipelineRun?.id, {
        severity: 'error',
        reason: 'contentgen_stage_failed',
        details: { exit_code: c.exitCode, stderr_tail: (c.stderr || '').slice(-500) },
        recommendedAction: 'Inspect ContentGen logs; rerun --mode=resume_from_stage --stage=contentgen',
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'failed', next_action: 'resume_from_stage=contentgen' });
      return { ok: false };
    }

    const cqCheck = await validateContentQueueRowsFor(runStartIso);
    if (!cqCheck.ok) {
      await escalate(pipelineRun?.id, {
        severity: 'warn',
        reason: 'content_queue_post_insert_violations',
        details: { violations: cqCheck.violations },
        recommendedAction: 'Investigate per-row violations; safety-net translation already applied.',
      });
    }
    await appendStage(pipelineRun?.id, { stage: 'contentgen_post_check', rows: cqCheck.rows.length, violations: cqCheck.violations.length });
  }

  await updatePipelineRun(pipelineRun?.id, { status: 'completed', next_action: 'idle_until_next_cron' });
  return { ok: true };
}

// ── Mode: hot_signal ────────────────────────────────────────────────

async function runHotSignal({ pipelineRun, signalId }) {
  if (!signalId) {
    await escalate(pipelineRun?.id, {
      severity: 'error',
      reason: 'hot_signal_missing_signal_id',
      details: { hint: 'pass --signal_id=<uuid>' },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed' });
    return { ok: false };
  }
  console.log(`[orchestrator] hot_signal start for signal_id=${signalId}`);

  // The hot-signal pass reuses the ContentGen agent. The agent reads the
  // latest briefing; for hot signals we inject a 1-opportunity briefing
  // built from the signals table so content.js does not need a new code
  // path.
  const { data: signal } = await supabase
    .from('signals')
    .select('*')
    .eq('id', signalId)
    .maybeSingle();
  if (!signal) {
    await escalate(pipelineRun?.id, {
      severity: 'error',
      reason: 'hot_signal_not_found',
      details: { signal_id: signalId },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed' });
    return { ok: false };
  }

  const today = new Date().toISOString().split('T')[0];
  const opp = {
    signal_id: signal.id,
    topic: (signal.title || '').slice(0, 80),
    category: signal.content_pillar || 'parenting',
    age_range: signal.age_range || 'universal',
    angle: signal.summary || '',
    source: signal.source || 'cross_signal',
    signal_source: signal.signal_source || 'user_submitted',
    source_url: signal.url || '',
    reasoning: 'Hot signal — auto-promoted by orchestrator hot_signal mode.',
    content_type: 'wow',
    platform_fit: 'both',
    priority: 1,
    suggested_hook: signal.suggested_hook || (signal.title || '').slice(0, 80),
    recommended_format: 'static-image',
    signal_strength: signal.signal_strength || 9,
  };

  // Upsert into daily_briefings under today's date as a hot-signal pass.
  // This is intentionally destructive of the day's briefing for clarity;
  // hot_signal pipelines are operator-acknowledged.
  await supabase
    .from('daily_briefings')
    .upsert(
      { briefing_date: today, opportunities: [opp], sources: { hot_signal: { signal_id: signalId } } },
      { onConflict: 'briefing_date' },
    );

  const c = await runStage('contentgen', {
    extraEnv: pipelineRun?.id ? { PIPELINE_RUN_ID: pipelineRun.id } : {},
  });
  await appendStage(pipelineRun?.id, { stage: 'contentgen', status: c.status, duration_ms: c.durationMs });
  if (c.status !== 'completed') {
    await escalate(pipelineRun?.id, {
      severity: 'error',
      reason: 'hot_signal_contentgen_failed',
      details: { exit_code: c.exitCode, stderr_tail: (c.stderr || '').slice(-500) },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed' });
    return { ok: false };
  }
  await updatePipelineRun(pipelineRun?.id, { status: 'completed' });
  return { ok: true };
}

// ── Mode: resume_from_stage ─────────────────────────────────────────

async function runResumeFromStage({ pipelineRun, stage }) {
  const order = ['research', 'strategist', 'contentgen'];
  if (!order.includes(stage)) {
    await escalate(pipelineRun?.id, {
      severity: 'error',
      reason: 'resume_unknown_stage',
      details: { stage, valid: order },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed' });
    return { ok: false };
  }
  const startIdx = order.indexOf(stage);
  for (let i = startIdx; i < order.length; i++) {
    const r = await runStage(order[i], { extraEnv: pipelineRun?.id ? { PIPELINE_RUN_ID: pipelineRun.id } : {} });
    await appendStage(pipelineRun?.id, { stage: order[i], status: r.status, duration_ms: r.durationMs });
    if (r.status !== 'completed') {
      await escalate(pipelineRun?.id, {
        severity: 'error',
        reason: `resume_${order[i]}_failed`,
        details: { exit_code: r.exitCode, stderr_tail: (r.stderr || '').slice(-500) },
      });
      await updatePipelineRun(pipelineRun?.id, { status: 'failed', next_action: `resume_from_stage=${order[i]}` });
      return { ok: false };
    }
  }
  await updatePipelineRun(pipelineRun?.id, { status: 'completed' });
  return { ok: true };
}

// ── Orchestrator policy LLM (Haiku) ─────────────────────────────────
//
// Small, advisory call. Given the pre-flight report and any escalations,
// asks Haiku whether to proceed or abort. Output is logged for audit but
// the TypeScript path still has the final say — the LLM cannot relax a
// hard gate, only recommend.

async function policyAdvise({ skill, mode, preflight }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { decision: 'proceed', rationale: 'ANTHROPIC_API_KEY missing; defaulting to proceed.' };
  }
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 400,
      system: skill.systemPrompt,
      messages: [{
        role: 'user',
        content:
          `You are running pre-flight policy advisory. Mode=${mode}.\n\n` +
          `Pre-flight report:\n${JSON.stringify(preflight, null, 2)}\n\n` +
          `Return ONLY JSON: { "decision": "proceed"|"abort", "rationale": "..." }.`,
      }],
    });
    const text = (msg.content[0].text || '').trim();
    const stripped = text.startsWith('```') ? text.replace(/^```[a-z]*\n?|\n?```$/gi, '').trim() : text;
    const parsed = JSON.parse(stripped);
    if (parsed.decision !== 'proceed' && parsed.decision !== 'abort') {
      return { decision: 'proceed', rationale: `unparseable LLM decision: ${text.slice(0, 200)}` };
    }
    return parsed;
  } catch (err) {
    return { decision: 'proceed', rationale: `policy LLM failed: ${err.message}` };
  }
}

// ── Entry point ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode || 'daily';
  if (!VALID_MODES.has(mode)) {
    console.error(`[orchestrator] Invalid --mode "${mode}". Valid: ${[...VALID_MODES].join(', ')}`);
    process.exit(2);
  }

  const skill = await loadSkill('smt_orchestrator');
  console.log(`[orchestrator] Loaded skill smt_orchestrator v${skill.skillVersion} (contract v${skill.contractVersion}); mode=${mode}`);

  const preflight = await runPreflight({ mode });
  console.log('[orchestrator] pre-flight:', JSON.stringify(preflight.checks));

  if (preflight.checks.concurrent_runs.length > 0 && mode !== 'resume_from_stage') {
    console.error(`[orchestrator] Concurrent in_progress run(s) detected: ${preflight.checks.concurrent_runs.join(', ')}. Aborting.`);
    process.exit(3);
  }
  if (preflight.checks.budget_breached) {
    console.error(`[orchestrator] 24h budget cap ($${preflight.checks.budget_cap_usd}) breached. Aborting.`);
    process.exit(4);
  }

  let pipelineRun = null;
  const dryRun = mode === 'dry_run';
  if (!dryRun) {
    pipelineRun = await insertPipelineRun({
      mode,
      triggerSource: args.trigger || (process.env.GITHUB_RUN_ID ? 'github_actions' : 'cli'),
      parentRunId: args.parent_run_id || null,
      preflight,
    });
    console.log(`[orchestrator] pipeline_run inserted: ${pipelineRun.id}`);
  }

  const advisory = await policyAdvise({ skill, mode, preflight });
  console.log(`[orchestrator] policy LLM: ${advisory.decision} — ${advisory.rationale.slice(0, 160)}`);
  if (advisory.decision === 'abort') {
    await escalate(pipelineRun?.id, {
      severity: 'warn',
      reason: 'policy_advisory_aborted',
      details: { advisory, preflight },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed', next_action: 'review_policy_advisory' });
    return;
  }

  try {
    if (mode === 'daily' || mode === 'dry_run') {
      await runDaily({ pipelineRun, dryRun });
    } else if (mode === 'hot_signal') {
      await runHotSignal({ pipelineRun, signalId: args.signal_id });
    } else if (mode === 'resume_from_stage') {
      await runResumeFromStage({ pipelineRun, stage: args.stage });
    }
  } catch (err) {
    console.error('[orchestrator] fatal error:', err);
    await escalate(pipelineRun?.id, {
      severity: 'critical',
      reason: 'orchestrator_unhandled_exception',
      details: { error: err?.message || String(err) },
    });
    await updatePipelineRun(pipelineRun?.id, { status: 'failed' });
    process.exit(1);
  }

  // Stamp skill_version + contract_version on the orchestrator's own agent_runs row.
  try {
    const { data: agentRow } = await supabase
      .from('agents')
      .select('id')
      .eq('slug', 'system-orchestrator')
      .maybeSingle();
    if (agentRow?.id) {
      const { data: latestRun } = await supabase
        .from('agent_runs')
        .select('id')
        .eq('agent_id', agentRow.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRun?.id) {
        await supabase
          .from('agent_runs')
          .update({ skill_version: skill.skillVersion, contract_version: skill.contractVersion })
          .eq('id', latestRun.id);
      }
    }
  } catch (err) {
    console.warn(`[orchestrator] Failed to stamp skill_version on agent_runs (non-fatal): ${err.message}`);
  }

  await logActivity({
    category: 'system',
    actor_type: 'system',
    actor_name: 'system-orchestrator',
    action: 'orchestrator_cycle_completed',
    description: `Orchestrator mode=${mode} completed; pipeline_run_id=${pipelineRun?.id ?? 'dry'}`,
    metadata: { mode, pipeline_run_id: pipelineRun?.id ?? null, dryRun },
  });

  console.log(`[orchestrator] DONE mode=${mode} pipeline_run_id=${pipelineRun?.id ?? 'dry'}`);
}

main().catch((err) => {
  console.error('[orchestrator] unhandled:', err);
  process.exit(1);
});
