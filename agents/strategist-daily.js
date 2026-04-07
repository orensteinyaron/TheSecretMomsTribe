/**
 * SMT Strategist Daily Pulse Agent
 *
 * Runs every morning at 8am (after data-fetcher + research + content gen).
 * Analyzes the last 24 hours of operation and produces:
 *   1. Updates to strategy_insights — new observations, confidence adjustments
 *   2. strategy_tasks — 2-5 actionable items for the day, pending admin approval
 *   3. A daily pulse entry in strategy_reports
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/strategist-daily.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logCost, printCostSummary } from '../scripts/utils/cost-logger.js';

// --- Config ---

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const yesterday = new Date(Date.now() - 86400000).toISOString();

// --- Data Fetchers ---

async function fetchRecentContent() {
  try {
    const { data, error } = await supabase
      .from('content_queue')
      .select('status, content_pillar, post_format, content_type, age_range, render_status, render_cost_usd, rejection_reason, created_at')
      .gte('created_at', yesterday);
    if (error) throw error;
    console.log(`[Strategist-Daily] Recent content: ${(data || []).length} items`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch recent content (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchLatestBriefing() {
  try {
    const { data, error } = await supabase
      .from('daily_briefings')
      .select('*')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .single();
    if (error) throw error;
    console.log(`[Strategist-Daily] Latest briefing: ${data?.briefing_date || 'none'}`);
    return data;
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch briefing (non-fatal): ${err.message}`);
    return null;
  }
}

async function fetchExistingInsights() {
  try {
    const { data, error } = await supabase
      .from('strategy_insights')
      .select('*')
      .in('status', ['hypothesis', 'confirmed', 'applied']);
    if (error) throw error;
    console.log(`[Strategist-Daily] Existing insights: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch insights (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchActiveDirectives() {
  try {
    const { data, error } = await supabase
      .from('system_directives')
      .select('*')
      .eq('status', 'active');
    if (error) throw error;
    console.log(`[Strategist-Daily] Active directives: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch directives (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchRecentAgentRuns() {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .select('*, agents(name, slug)')
      .gte('started_at', yesterday)
      .order('started_at', { ascending: false });
    if (error) throw error;
    console.log(`[Strategist-Daily] Recent agent runs: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch agent runs (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchContentFeedback() {
  try {
    const { data, error } = await supabase
      .from('content_feedback')
      .select('feedback_type, category, created_at')
      .gte('created_at', yesterday);
    if (error) throw error;
    console.log(`[Strategist-Daily] Content feedback: ${(data || []).length} items`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch feedback (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchCostData() {
  try {
    const { data, error } = await supabase
      .from('cost_log')
      .select('pipeline_stage, service, cost_usd')
      .gte('created_at', yesterday);
    if (error) throw error;
    console.log(`[Strategist-Daily] Cost entries: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Daily] Failed to fetch costs (non-fatal): ${err.message}`);
    return [];
  }
}

// --- Claude Prompt ---

const SYSTEM_PROMPT = `You are the Strategy Analyst for Secret Moms Tribe (SMT), an AI-powered parenting content operation.

Your job is to analyze the last 24 hours of operation and produce:
1. INSIGHTS — observations about what's working or not (with confidence scores)
2. TASKS — specific actionable recommendations for the admin to approve

## Rules for Insights
- Each insight has a type: format_performance | pillar_performance | timing | trend | audience | competitor | cost_efficiency
- New insights start as "hypothesis" with confidence 0.30
- If an existing insight matches your observation, increase its confidence by 0.10 and bump times_confirmed
- If an existing insight is contradicted by today's data, note it (don't invalidate yet — needs 3+ contradictions)
- Max 5 new insights per day (don't flood)
- Be specific: "TikTok slideshows get 2x more renders than static" not "video performs well"

## Rules for Tasks
- Each task has a type: research_adjustment | content_mix_change | format_priority | competitor_response | profile_development | schedule_optimization | budget_adjustment
- Each task has urgency: low | normal | high | critical
- Each task must have a clear recommended_action
- If the task should create a system_directive when approved, include proposed_directive as JSON
- Max 5 tasks per day
- Don't create tasks that duplicate active directives

## Output Format
Return a JSON object:
{
  "insights": [
    {
      "action": "create" | "update",
      "id": "existing insight ID (for update only)",
      "insight_type": "...",
      "insight": "The specific observation",
      "confidence_delta": 0.10,
      "supporting_data": { ... }
    }
  ],
  "tasks": [
    {
      "task_type": "...",
      "title": "Short title (5-10 words)",
      "description": "What you observed (1-2 sentences)",
      "recommended_action": "What should be done",
      "urgency": "normal",
      "proposed_directive": { "directive": "...", "directive_type": "...", "target_agent": "..." } or null
    }
  ],
  "summary": "2-3 sentence summary of today's analysis"
}

Return ONLY the JSON. No markdown fences.`;

function buildUserPrompt({ recentContent, briefing, existingInsights, directives, agentRuns, feedback, costs }) {
  const sections = [];

  // 1. Recent content
  sections.push('# Last 24h Content Queue');
  if (recentContent.length > 0) {
    const statusCounts = {};
    const pillarCounts = {};
    const formatCounts = {};
    const typeCounts = {};
    const rejections = [];
    for (const c of recentContent) {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      pillarCounts[c.content_pillar] = (pillarCounts[c.content_pillar] || 0) + 1;
      formatCounts[c.post_format] = (formatCounts[c.post_format] || 0) + 1;
      typeCounts[c.content_type] = (typeCounts[c.content_type] || 0) + 1;
      if (c.rejection_reason) rejections.push(c.rejection_reason);
    }
    sections.push(`Total: ${recentContent.length} posts`);
    sections.push(`Status breakdown: ${JSON.stringify(statusCounts)}`);
    sections.push(`Pillar breakdown: ${JSON.stringify(pillarCounts)}`);
    sections.push(`Format breakdown: ${JSON.stringify(formatCounts)}`);
    sections.push(`Content type breakdown: ${JSON.stringify(typeCounts)}`);
    if (rejections.length > 0) {
      sections.push(`Rejection reasons: ${rejections.join('; ')}`);
    }
    const renderStats = recentContent.filter((c) => c.render_status);
    if (renderStats.length > 0) {
      const renderCounts = {};
      for (const c of renderStats) renderCounts[c.render_status] = (renderCounts[c.render_status] || 0) + 1;
      sections.push(`Render status: ${JSON.stringify(renderCounts)}`);
      const totalRenderCost = renderStats.reduce((sum, c) => sum + (parseFloat(c.render_cost_usd) || 0), 0);
      if (totalRenderCost > 0) sections.push(`Total render cost: $${totalRenderCost.toFixed(4)}`);
    }
  } else {
    sections.push('No content generated in the last 24 hours.');
  }
  sections.push('');

  // 2. Briefing
  sections.push('# Today\'s Research Briefing');
  if (briefing) {
    sections.push(`Date: ${briefing.briefing_date}`);
    sections.push(`Opportunities: ${briefing.opportunities?.length || 0}`);
    if (briefing.sources) sections.push(`Source health: ${JSON.stringify(briefing.sources)}`);
    if (briefing.opportunities?.length > 0) {
      const categories = briefing.opportunities.map((o) => o.category || o.pillar);
      sections.push(`Opportunity categories: ${categories.join(', ')}`);
    }
  } else {
    sections.push('No briefing available today.');
  }
  sections.push('');

  // 3. Existing insights
  sections.push('# Current Strategy Insights (your memory)');
  if (existingInsights.length > 0) {
    for (const ins of existingInsights) {
      sections.push(`- [${ins.status}] [${ins.insight_type}] (confidence: ${ins.confidence}, confirmed: ${ins.times_confirmed || 0}x) ID: ${ins.id}`);
      sections.push(`  "${ins.insight}"`);
    }
  } else {
    sections.push('No existing insights yet — this may be the first run.');
  }
  sections.push('');

  // 4. Directives
  sections.push('# Active System Directives');
  if (directives.length > 0) {
    for (const d of directives) {
      sections.push(`- [${d.directive_type}] ${d.directive} (target: ${d.target_agent || 'all'})`);
    }
  } else {
    sections.push('No active directives.');
  }
  sections.push('');

  // 5. Agent runs
  sections.push('# Recent Agent Runs (system health)');
  if (agentRuns.length > 0) {
    for (const run of agentRuns) {
      const agentName = run.agents?.name || run.agents?.slug || 'unknown';
      const duration = run.finished_at && run.started_at
        ? `${((new Date(run.finished_at) - new Date(run.started_at)) / 1000).toFixed(0)}s`
        : 'in-progress';
      sections.push(`- ${agentName}: ${run.status} (${duration}) ${run.error_message ? `ERROR: ${run.error_message}` : ''}`);
    }
  } else {
    sections.push('No agent runs in last 24h.');
  }
  sections.push('');

  // 6. Content feedback
  sections.push('# Content Feedback (last 24h)');
  if (feedback.length > 0) {
    const feedbackCounts = {};
    for (const f of feedback) {
      const key = `${f.feedback_type}/${f.category || 'general'}`;
      feedbackCounts[key] = (feedbackCounts[key] || 0) + 1;
    }
    sections.push(JSON.stringify(feedbackCounts));
  } else {
    sections.push('No feedback received.');
  }
  sections.push('');

  // 7. Cost data
  sections.push('# Cost Data (last 24h)');
  if (costs.length > 0) {
    const costByStage = {};
    let totalCost = 0;
    for (const c of costs) {
      const cost = parseFloat(c.cost_usd) || 0;
      costByStage[c.pipeline_stage] = (costByStage[c.pipeline_stage] || 0) + cost;
      totalCost += cost;
    }
    sections.push(`Total: $${totalCost.toFixed(4)}`);
    sections.push(`By stage: ${JSON.stringify(Object.fromEntries(Object.entries(costByStage).map(([k, v]) => [k, `$${v.toFixed(4)}`])))}`);
  } else {
    sections.push('No cost data for last 24h.');
  }
  sections.push('');

  sections.push('Analyze all data above. Produce insights (max 5 new, update existing where applicable) and tasks (max 5). Return ONLY JSON.');

  return sections.join('\n');
}

// --- Process Results ---

async function processInsights(insights, runId) {
  const newInsightIds = [];

  for (const ins of insights) {
    try {
      if (ins.action === 'create') {
        const { data, error } = await supabase.from('strategy_insights').insert({
          insight_type: ins.insight_type,
          insight: ins.insight,
          confidence: 0.30,
          supporting_data: ins.supporting_data || {},
          status: 'hypothesis',
        }).select('id').single();

        if (error) {
          console.error(`[Strategist-Daily] Failed to create insight: ${error.message}`);
          continue;
        }
        console.log(`[Strategist-Daily] Created insight: ${ins.insight_type} — "${ins.insight.slice(0, 60)}..."`);
        newInsightIds.push(data.id);

      } else if (ins.action === 'update' && ins.id) {
        const { data: existing, error: fetchErr } = await supabase
          .from('strategy_insights')
          .select('confidence, times_confirmed')
          .eq('id', ins.id)
          .single();

        if (fetchErr || !existing) {
          console.warn(`[Strategist-Daily] Insight ${ins.id} not found for update, skipping`);
          continue;
        }

        const newConf = Math.min(1.0, existing.confidence + (ins.confidence_delta || 0.10));
        const newStatus = newConf >= 0.6 ? 'confirmed' : 'hypothesis';

        const { error: updateErr } = await supabase.from('strategy_insights').update({
          confidence: newConf,
          times_confirmed: (existing.times_confirmed || 0) + 1,
          last_confirmed: new Date().toISOString(),
          status: newStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', ins.id);

        if (updateErr) {
          console.error(`[Strategist-Daily] Failed to update insight ${ins.id}: ${updateErr.message}`);
          continue;
        }
        console.log(`[Strategist-Daily] Updated insight ${ins.id}: confidence ${existing.confidence} → ${newConf} (${newStatus})`);
        newInsightIds.push(ins.id);
      }
    } catch (err) {
      console.error(`[Strategist-Daily] Error processing insight: ${err.message}`);
    }
  }

  return newInsightIds;
}

async function processTasks(tasks, runId) {
  const newTaskIds = [];

  for (const task of tasks) {
    try {
      const { data, error } = await supabase.from('strategy_tasks').insert({
        task_type: task.task_type,
        title: task.title,
        description: task.description,
        recommended_action: task.recommended_action,
        urgency: task.urgency || 'normal',
        proposed_directive: task.proposed_directive || null,
        status: 'pending',
        created_by_run_id: runId,
      }).select('id').single();

      if (error) {
        console.error(`[Strategist-Daily] Failed to create task: ${error.message}`);
        continue;
      }
      console.log(`[Strategist-Daily] Created task: [${task.urgency || 'normal'}] ${task.title}`);
      newTaskIds.push(data.id);
    } catch (err) {
      console.error(`[Strategist-Daily] Error processing task: ${err.message}`);
    }
  }

  return newTaskIds;
}

async function writeStrategyReport({ summary, recentContent, tasks, newInsightIds, newTaskIds }) {
  const today = new Date().toISOString().split('T')[0];

  // Build content performance summary
  const contentPerformance = {};
  if (recentContent.length > 0) {
    contentPerformance.total = recentContent.length;
    contentPerformance.by_status = {};
    contentPerformance.by_pillar = {};
    contentPerformance.by_format = {};
    for (const c of recentContent) {
      contentPerformance.by_status[c.status] = (contentPerformance.by_status[c.status] || 0) + 1;
      contentPerformance.by_pillar[c.content_pillar] = (contentPerformance.by_pillar[c.content_pillar] || 0) + 1;
      contentPerformance.by_format[c.post_format] = (contentPerformance.by_format[c.post_format] || 0) + 1;
    }
  }

  const { error } = await supabase.from('strategy_reports').insert({
    report_type: 'daily_pulse',
    period_start: today,
    period_end: today,
    summary,
    content_performance: contentPerformance,
    recommendations: tasks,
    insights_created: newInsightIds,
    tasks_created: newTaskIds,
  });

  if (error) {
    console.error(`[Strategist-Daily] Failed to write strategy report: ${error.message}`);
  } else {
    console.log(`[Strategist-Daily] Strategy report written for ${today}`);
  }
}

// --- Main ---

async function main() {
  console.log('[Strategist-Daily] Starting daily pulse analysis...');
  const startTime = Date.now();

  // Fetch all data in parallel
  const [recentContent, briefing, existingInsights, directives, agentRuns, feedback, costs] = await Promise.all([
    fetchRecentContent(),
    fetchLatestBriefing(),
    fetchExistingInsights(),
    fetchActiveDirectives(),
    fetchRecentAgentRuns(),
    fetchContentFeedback(),
    fetchCostData(),
  ]);

  // Build prompt
  const userPrompt = buildUserPrompt({
    recentContent, briefing, existingInsights, directives, agentRuns, feedback, costs,
  });

  // Call Claude
  console.log(`[Strategist-Daily] Calling Claude (${CLAUDE_MODEL})...`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  await logCost(supabase, {
    pipeline_stage: 'strategy', service: 'anthropic', model: CLAUDE_MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    description: 'Strategist daily pulse analysis',
  });

  // Parse response
  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    console.error('[Strategist-Daily] Failed to parse Claude response as JSON:');
    console.error(text.slice(0, 500));
    throw new Error(`JSON parse failed: ${err.message}`);
  }

  // Validate structure
  if (!result.insights || !Array.isArray(result.insights)) {
    console.warn('[Strategist-Daily] No insights array in response, defaulting to empty');
    result.insights = [];
  }
  if (!result.tasks || !Array.isArray(result.tasks)) {
    console.warn('[Strategist-Daily] No tasks array in response, defaulting to empty');
    result.tasks = [];
  }
  if (!result.summary) {
    result.summary = 'Daily pulse completed but no summary was generated.';
  }

  // Enforce limits
  result.insights = result.insights.slice(0, 5);
  result.tasks = result.tasks.slice(0, 5);

  console.log(`[Strategist-Daily] Claude returned ${result.insights.length} insights, ${result.tasks.length} tasks`);

  // Process insights
  const runId = null; // Will be set by orchestrator when wired up
  const newInsightIds = await processInsights(result.insights, runId);

  // Process tasks
  const newTaskIds = await processTasks(result.tasks, runId);

  // Write strategy report
  await writeStrategyReport({
    summary: result.summary,
    recentContent,
    tasks: result.tasks,
    newInsightIds,
    newTaskIds,
  });

  // Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Strategist-Daily] Done in ${elapsed}s.`);

  console.log('\n=== DAILY PULSE SUMMARY ===');
  console.log(result.summary);

  if (newInsightIds.length > 0) {
    console.log(`\n--- Insights (${newInsightIds.length}) ---`);
    for (const ins of result.insights) {
      console.log(`  [${ins.action}] [${ins.insight_type}] ${ins.insight.slice(0, 80)}`);
    }
  }

  if (newTaskIds.length > 0) {
    console.log(`\n--- Tasks (${newTaskIds.length}) ---`);
    for (const task of result.tasks) {
      console.log(`  [${task.urgency || 'normal'}] ${task.title}`);
      console.log(`    Action: ${task.recommended_action.slice(0, 100)}`);
    }
  }

  await printCostSummary(supabase);
}

main().catch((err) => {
  console.error('[Strategist-Daily] Fatal error:', err);
  process.exit(1);
});
