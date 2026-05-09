/**
 * agent_run lifecycle helpers
 *
 * Each agent calls startAgentRun(supabase, slug) at the top of main().
 *
 *   - If process.env.AGENT_RUN_ID is set (orchestrator-spawned child),
 *     attach to that existing row. The orchestrator owns the row's
 *     lifecycle, so finishAgentRun is a no-op in that case.
 *   - Otherwise (standalone cron / manual run), insert a new agent_runs
 *     row keyed by `slug`. The agent owns the row and calls
 *     finishAgentRun on success or failure.
 *
 * Returns { runId, owned }. Pass `runId` into logCost(...) as
 * agent_run_id so the trigger rolls per-run cost into agent_runs.cost_usd.
 *
 * If no agents row exists for the slug, run tracking is disabled
 * silently (returns { runId: null, owned: false }) — agent still works,
 * just won't link costs.
 */

export async function startAgentRun(supabase, slug, { trigger = 'scheduled', input = {} } = {}) {
  const envRunId = process.env.AGENT_RUN_ID;
  if (envRunId) {
    return { runId: envRunId, owned: false };
  }

  const { data: agent, error: agentErr } = await supabase
    .from('agents').select('id').eq('slug', slug).maybeSingle();
  if (agentErr || !agent) {
    console.warn(`[agent_run] No agents row for slug="${slug}"; run tracking disabled.`);
    return { runId: null, owned: false };
  }

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: agent.id,
      status: 'running',
      trigger,
      input_data: input,
    })
    .select('id')
    .single();
  if (error) {
    console.warn(`[agent_run] Failed to create agent_runs row for "${slug}": ${error.message}`);
    return { runId: null, owned: false };
  }
  return { runId: data.id, owned: true };
}

export async function finishAgentRun(supabase, run, { status = 'completed', output = {}, error = null } = {}) {
  if (!run || !run.runId || !run.owned) return;
  const { error: updateErr } = await supabase
    .from('agent_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      output_data: output,
      error,
    })
    .eq('id', run.runId);
  if (updateErr) {
    console.warn(`[agent_run] Failed to finish run ${run.runId}: ${updateErr.message}`);
  }
}

export async function getRunCost(supabase, runId) {
  if (!runId) return 0;
  const { data, error } = await supabase
    .from('cost_log').select('cost_usd').eq('agent_run_id', runId);
  if (error) return 0;
  return (data || []).reduce((s, r) => s + parseFloat(r.cost_usd || 0), 0);
}
