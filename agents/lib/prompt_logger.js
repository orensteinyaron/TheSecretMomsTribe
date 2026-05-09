/**
 * Shared prompt_execution logger for SMT agents.
 *
 * Every LLM call in a content-producing chain writes one row here.
 * This is the single entry point — all agents route through it so the
 * piece page can reconstruct the full prompt chain for any content_id.
 *
 * The function never throws. If Supabase insert fails, we log to stderr
 * and return { id: null } so the agent's flow is not disrupted by
 * observability plumbing.
 *
 * --- Status enum and the 'reconstructed' asymmetry (intentional) ---
 *
 * The DB CHECK constraint on prompt_executions.status accepts FIVE values:
 *   'ok' | 'error' | 'retry' | 'skipped' | 'reconstructed'
 *
 * VALID_STATUS below deliberately accepts only the FIRST FOUR. Real-time
 * logged executions must NEVER claim 'reconstructed' status — that value is
 * reserved for backfilled rows that synthesize a prompt chain from indirect
 * sources (e.g. a piece predating prompt_logger that has surviving
 * content_assets but no original LLM-call records).
 *
 * Backfills bypass this logger by design: they direct-INSERT rows with
 * status='reconstructed'. See docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md for
 * the canonical example. If you find yourself wanting to widen VALID_STATUS
 * to include 'reconstructed', stop — you're about to mark real-time data as
 * synthetic, which silently poisons whatever analytics later differentiate.
 *
 * --- Cost-data conventions: omit-and-surface, never synthesize ---
 *
 * When a real-time logged chain has missing or unrecoverable cost data
 * (e.g. an upstream agent didn't return msg.usage, or a step ran but its
 * billing wasn't captured), prefer omitting cost_usd on the row (NULL with
 * a `_cost_omitted_note` key in output_json) and surfacing the estimate
 * via `content_queue.generation_context._estimated_cost_breakdown` rather
 * than synthesizing a chain row cost. The chain shows what we have
 * evidence for; the breakdown shows what the full pipeline would have cost
 * if every phase had been logged. They are two different things.
 *
 * Conversely, when a row's cost IS derivable from real artifacts (TTS
 * character counts, Whisper audio duration, Seedance job IDs, etc.), keep
 * the cost on the row and add a `_cost_derived_from` key in output_json
 * documenting the derivation basis.
 *
 * Established by the 3bcafc78 showcase backfill (PR #21). The principle is
 * "synthesized numbers are commentary, not data — keep them out of numeric
 * columns on the chain."
 */

import { supabase } from './supabase.js';

// 'reconstructed' is intentionally excluded — see file header for why.
const VALID_STATUS = new Set(['ok', 'error', 'retry', 'skipped']);

/**
 * @param {object} params
 * @param {string} params.contentId            - content_queue.id this execution belongs to
 * @param {string} params.agentName            - e.g. 'content_gen', 'slide_parser', 'media_query_gen'
 * @param {string} params.stepName             - human-readable step name
 * @param {number} params.stepOrder            - 1..N position in the chain for this contentId
 * @param {string} params.model                - e.g. 'claude-sonnet-4-6', 'claude-haiku-4-5', 'none'
 * @param {string} [params.systemPrompt]
 * @param {string} params.userPrompt           - the rendered user prompt
 * @param {string} [params.renderedOutput]     - text output (first-class for text-producing steps)
 * @param {object} [params.outputJson]         - structured output, when the step produces JSON
 * @param {number} [params.tokensIn]
 * @param {number} [params.tokensOut]
 * @param {number} [params.costUsd]
 * @param {'ok'|'error'|'retry'|'skipped'} params.status
 * @param {string} [params.errorMessage]
 * @param {number} [params.latencyMs]
 * @param {string} [params.agentRunId]         - FK to agent_runs.id
 * @param {string} [params.supersedesId]       - FK to prior prompt_executions.id for regenerate-from-step
 * @returns {Promise<{id: string|null}>}
 */
export async function logPromptExecution(params) {
  const {
    contentId, agentName, stepName, stepOrder, model,
    systemPrompt, userPrompt, renderedOutput, outputJson,
    tokensIn, tokensOut, costUsd, status,
    errorMessage, latencyMs, agentRunId, supersedesId,
  } = params;

  if (!contentId || !agentName || !stepName || typeof stepOrder !== 'number' || !model || !userPrompt || !status) {
    console.error('[prompt_logger] missing required field', {
      contentId: !!contentId, agentName: !!agentName, stepName: !!stepName,
      stepOrder: typeof stepOrder === 'number', model: !!model, userPrompt: !!userPrompt, status: !!status,
    });
    return { id: null };
  }
  if (!VALID_STATUS.has(status)) {
    console.error('[prompt_logger] invalid status:', status);
    return { id: null };
  }

  const row = {
    content_id: contentId,
    agent_name: agentName,
    step_name: stepName,
    step_order: stepOrder,
    model,
    system_prompt: systemPrompt ?? null,
    user_prompt: userPrompt,
    rendered_output: renderedOutput ?? null,
    output_json: outputJson ?? null,
    tokens_in: tokensIn ?? null,
    tokens_out: tokensOut ?? null,
    cost_usd: costUsd ?? null,
    status,
    error_message: errorMessage ?? null,
    latency_ms: latencyMs ?? null,
    agent_run_id: agentRunId ?? null,
    supersedes_id: supersedesId ?? null,
  };

  const { data, error } = await supabase
    .from('prompt_executions')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('[prompt_logger] insert failed:', error.message);
    return { id: null };
  }
  return { id: data.id };
}

/**
 * Convenience wrapper: execute an async LLM-producing function and
 * persist a prompt_executions row from the result, capturing latency
 * automatically. On thrown error, persists status='error' with the
 * error message and re-throws so the caller still sees the failure.
 *
 * The inner fn must return { renderedOutput?, outputJson?, tokensIn?, tokensOut?, costUsd? }.
 *
 * @param {object} meta - same fields as logPromptExecution minus status/latencyMs/errorMessage
 * @param {() => Promise<object>} fn
 * @returns {Promise<{result: object, logId: string|null}>}
 */
export async function withPromptLogging(meta, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const { id } = await logPromptExecution({
      ...meta,
      renderedOutput: result?.renderedOutput,
      outputJson: result?.outputJson,
      tokensIn: result?.tokensIn,
      tokensOut: result?.tokensOut,
      costUsd: result?.costUsd,
      status: 'ok',
      latencyMs: Date.now() - start,
    });
    return { result, logId: id };
  } catch (err) {
    await logPromptExecution({
      ...meta,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    });
    throw err;
  }
}

/**
 * Mark a deterministic (non-LLM) step with status='skipped' so the UI
 * still shows it in the chain. Use this for pure-code transformations
 * that contribute to the pipeline order (e.g. tts_script_prep).
 */
export async function logDeterministicStep({ contentId, agentName, stepName, stepOrder, userPrompt, agentRunId }) {
  return logPromptExecution({
    contentId,
    agentName,
    stepName,
    stepOrder,
    model: 'none',
    userPrompt: userPrompt || `(deterministic step: ${stepName})`,
    status: 'skipped',
    agentRunId,
  });
}
