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
 */

import { supabase } from './supabase.js';

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
