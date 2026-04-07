/**
 * SMT Strategist Weekly Analysis Agent
 *
 * Runs every Sunday at 9am via Orchestrator.
 * Deep analysis of the full week using Claude Sonnet (better reasoning).
 *
 * Produces:
 *   1. Weekly strategy report (stored in strategy_reports)
 *   2. Updated/new strategy_insights with confidence adjustments
 *   3. Proposed system_directives (as strategy_tasks pending approval)
 *   4. Content mix + format priority recommendations
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/strategist-weekly.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logCost, printCostSummary } from '../scripts/utils/cost-logger.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// ── Env validation ──────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
  console.error('[Strategist-Weekly] Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── Date helpers ────────────────────────────────────────────

const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
const today = new Date().toISOString().split('T')[0];

// ── Data fetchers (all wrapped in try/catch for graceful degradation) ──

async function fetchWeekContent() {
  try {
    const { data, error } = await supabase
      .from('content_queue')
      .select('status, content_pillar, post_format, content_type, age_range, render_status, render_cost_usd, rejection_reason, created_at, updated_at')
      .gte('created_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Content queue: ${(data || []).length} items this week`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch content queue (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchWeekBriefings() {
  try {
    const weekStart = today.replace(/\d{2}$/, '01'); // crude month start
    const { data, error } = await supabase
      .from('daily_briefings')
      .select('*')
      .gte('briefing_date', weekStart)
      .order('briefing_date', { ascending: false })
      .limit(7);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Briefings: ${(data || []).length} this week`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch briefings (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchAllInsights() {
  try {
    const { data, error } = await supabase
      .from('strategy_insights')
      .select('*')
      .order('confidence', { ascending: false });

    if (error) throw error;
    console.log(`[Strategist-Weekly] Strategy insights: ${(data || []).length} total`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch insights (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchWeekTasks() {
  try {
    const { data, error } = await supabase
      .from('strategy_tasks')
      .select('*')
      .gte('created_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Strategy tasks: ${(data || []).length} this week`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch strategy tasks (non-fatal): ${err.message}`);
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
    console.log(`[Strategist-Weekly] Active directives: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch directives (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchWeekRuns() {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .select('*, agents(name, slug)')
      .gte('started_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Agent runs: ${(data || []).length} this week`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch agent runs (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchWeekCosts() {
  try {
    const { data, error } = await supabase
      .from('cost_log')
      .select('pipeline_stage, service, cost_usd, created_at')
      .gte('created_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Cost entries: ${(data || []).length} this week`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch costs (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchCompetitorData() {
  try {
    const { data, error } = await supabase
      .from('social_metrics')
      .select('*')
      .eq('is_own_account', false)
      .gte('collected_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Competitor data points: ${(data || []).length}`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch competitor data (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchWeekFeedback() {
  try {
    const { data, error } = await supabase
      .from('content_feedback')
      .select('*')
      .gte('created_at', weekAgo);

    if (error) throw error;
    console.log(`[Strategist-Weekly] Content feedback: ${(data || []).length} entries`);
    return data || [];
  } catch (err) {
    console.warn(`[Strategist-Weekly] Failed to fetch feedback (non-fatal): ${err.message}`);
    return [];
  }
}

// ── System prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Chief Strategy Officer for Secret Moms Tribe (SMT), performing your weekly deep analysis.

You have access to the full week's operational data. Your analysis covers:
1. Content mix performance (which pillars are over/under-performing)
2. Format performance (which render profiles drive the most output)
3. Content production velocity and quality (approval rates, rejection patterns)
4. Cost efficiency (cost per post, cost trend, budget compliance)
5. System reliability (agent success rates, service uptime)
6. Strategy effectiveness (did last week's insights/tasks lead to improvements?)
7. Recommendations for next week

## Insight Management
- Review ALL existing insights. For each:
  - If this week's data supports it: bump confidence +0.10, increment times_confirmed
  - If this week's data contradicts it: note it (after 3 contradictions, recommend invalidation)
  - If insight confidence >= 0.6 and status is still 'hypothesis': promote to 'confirmed'
- Create new insights from this week's patterns (max 5 new)
- Identify insights that should be 'applied' — injected into research/content agent prompts

## Task Generation
- Propose 3-7 strategic tasks for next week
- Each should be concrete and actionable
- Include proposed_directive where the task can be automated
- Types: content_mix_change, format_priority, schedule_optimization, budget_adjustment, research_adjustment, profile_development, competitor_response

## Output Format
Return a JSON object:
{
  "summary": "3-5 sentence executive summary of the week",
  "content_performance": {
    "total_generated": N,
    "by_status": { "draft": N, "approved": N, "rejected": N },
    "by_pillar": { "ai_magic": N, ... },
    "by_format": { "tiktok_slideshow": N, ... },
    "approval_rate": 0.XX,
    "top_rejection_reasons": ["weak_hook", ...]
  },
  "cost_analysis": {
    "total_week": X.XX,
    "daily_average": X.XX,
    "by_stage": { ... },
    "by_service": { ... },
    "cost_per_post": X.XX
  },
  "system_health": {
    "agent_success_rate": 0.XX,
    "total_runs": N,
    "failed_runs": N,
    "services_healthy": N,
    "services_down": N
  },
  "insights": [
    {
      "action": "create" | "update" | "invalidate",
      "id": "existing insight ID (for update/invalidate)",
      "insight_type": "...",
      "insight": "...",
      "confidence_delta": 0.10,
      "supporting_data": { ... },
      "new_status": "confirmed" | "applied" | "invalidated" (optional)
    }
  ],
  "tasks": [
    {
      "task_type": "...",
      "title": "...",
      "description": "...",
      "recommended_action": "...",
      "urgency": "normal",
      "proposed_directive": { ... } or null
    }
  ],
  "next_week_focus": "1-2 sentences on what to prioritize"
}

Return ONLY the JSON. No markdown fences.`;

// ── Build user prompt from all data ─────────────────────────

function buildUserPrompt(data) {
  const sections = [];

  sections.push(`# Weekly Strategy Analysis — ${today}`);
  sections.push(`Period: ${new Date(weekAgo).toISOString().split('T')[0]} to ${today}\n`);

  // 1. Content queue
  sections.push(`## Content Queue (${data.weekContent.length} items)`);
  if (data.weekContent.length > 0) {
    const byStatus = {};
    const byPillar = {};
    const byFormat = {};
    const rejectionReasons = [];

    for (const c of data.weekContent) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byPillar[c.content_pillar] = (byPillar[c.content_pillar] || 0) + 1;
      byFormat[c.post_format] = (byFormat[c.post_format] || 0) + 1;
      if (c.rejection_reason) rejectionReasons.push(c.rejection_reason);
    }

    sections.push(`By status: ${JSON.stringify(byStatus)}`);
    sections.push(`By pillar: ${JSON.stringify(byPillar)}`);
    sections.push(`By format: ${JSON.stringify(byFormat)}`);
    if (rejectionReasons.length > 0) {
      sections.push(`Rejection reasons: ${JSON.stringify(rejectionReasons)}`);
    }
  } else {
    sections.push('No content generated this week.');
  }
  sections.push('');

  // 2. Briefings
  sections.push(`## Daily Briefings (${data.briefings.length})`);
  if (data.briefings.length > 0) {
    for (const b of data.briefings) {
      const numOpps = b.opportunities?.length || 0;
      sections.push(`- ${b.briefing_date}: ${numOpps} opportunities, sources: ${JSON.stringify(b.sources || {})}`);
    }
  } else {
    sections.push('No briefings this week.');
  }
  sections.push('');

  // 3. All strategy insights (full memory)
  sections.push(`## All Strategy Insights (${data.allInsights.length} total)`);
  if (data.allInsights.length > 0) {
    sections.push(JSON.stringify(data.allInsights, null, 2));
  } else {
    sections.push('No existing insights.');
  }
  sections.push('');

  // 4. Week's strategy tasks
  sections.push(`## This Week's Strategy Tasks (${data.weekTasks.length})`);
  if (data.weekTasks.length > 0) {
    sections.push(JSON.stringify(data.weekTasks, null, 2));
  } else {
    sections.push('No strategy tasks this week.');
  }
  sections.push('');

  // 5. Active directives
  sections.push(`## Active System Directives (${data.directives.length})`);
  if (data.directives.length > 0) {
    for (const d of data.directives) {
      sections.push(`- [${d.directive_type}] ${d.directive} (target: ${d.target_agent || 'all'})`);
    }
  } else {
    sections.push('No active directives.');
  }
  sections.push('');

  // 6. Agent runs (system health)
  sections.push(`## Agent Runs (${data.weekRuns.length} this week)`);
  if (data.weekRuns.length > 0) {
    const byStatus = {};
    const byAgent = {};

    for (const r of data.weekRuns) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const slug = r.agents?.slug || 'unknown';
      if (!byAgent[slug]) byAgent[slug] = { completed: 0, failed: 0, total: 0 };
      byAgent[slug].total++;
      if (r.status === 'completed') byAgent[slug].completed++;
      if (r.status === 'failed' || r.status === 'timeout') byAgent[slug].failed++;
    }

    sections.push(`By status: ${JSON.stringify(byStatus)}`);
    sections.push(`By agent: ${JSON.stringify(byAgent)}`);
  } else {
    sections.push('No agent runs this week.');
  }
  sections.push('');

  // 7. Costs
  sections.push(`## Costs (${data.weekCosts.length} entries)`);
  if (data.weekCosts.length > 0) {
    const totalCost = data.weekCosts.reduce((sum, c) => sum + parseFloat(c.cost_usd || 0), 0);
    const byStage = {};
    const byService = {};

    for (const c of data.weekCosts) {
      byStage[c.pipeline_stage] = (byStage[c.pipeline_stage] || 0) + parseFloat(c.cost_usd || 0);
      byService[c.service] = (byService[c.service] || 0) + parseFloat(c.cost_usd || 0);
    }

    sections.push(`Total: $${totalCost.toFixed(4)}`);
    sections.push(`By stage: ${JSON.stringify(Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, `$${v.toFixed(4)}`])))}`);
    sections.push(`By service: ${JSON.stringify(Object.fromEntries(Object.entries(byService).map(([k, v]) => [k, `$${v.toFixed(4)}`])))}`);
  } else {
    sections.push('No costs recorded this week.');
  }
  sections.push('');

  // 8. Competitor data
  sections.push(`## Competitor Data (${data.competitors.length} data points)`);
  if (data.competitors.length > 0) {
    sections.push(JSON.stringify(data.competitors.slice(0, 20), null, 2));
  } else {
    sections.push('No competitor data available.');
  }
  sections.push('');

  // 9. Content feedback
  sections.push(`## Content Feedback (${data.weekFeedback.length} entries)`);
  if (data.weekFeedback.length > 0) {
    sections.push(JSON.stringify(data.weekFeedback, null, 2));
  } else {
    sections.push('No content feedback this week.');
  }
  sections.push('');

  sections.push('Analyze all data above. Produce your weekly strategy report following the JSON schema in your instructions. Return ONLY the JSON.');

  return sections.join('\n');
}

// ── Process insight actions ─────────────────────────────────

async function processInsights(insights) {
  const created = [];
  const updated = [];
  const invalidated = [];

  for (const ins of insights) {
    try {
      if (ins.action === 'create') {
        const { data, error } = await supabase
          .from('strategy_insights')
          .insert({
            insight_type: ins.insight_type,
            insight: ins.insight,
            confidence: ins.confidence_delta || 0.30,
            status: 'hypothesis',
            supporting_data: ins.supporting_data || {},
            times_confirmed: 0,
          })
          .select('id')
          .single();

        if (error) throw error;
        created.push(data.id);
        console.log(`[Strategist-Weekly] Created insight: ${ins.insight_type} — "${ins.insight.slice(0, 60)}..."`);

      } else if (ins.action === 'update' && ins.id) {
        // Fetch current insight to compute new values
        const { data: current, error: fetchErr } = await supabase
          .from('strategy_insights')
          .select('confidence, times_confirmed, status')
          .eq('id', ins.id)
          .single();

        if (fetchErr || !current) {
          console.warn(`[Strategist-Weekly] Insight ${ins.id} not found for update, skipping`);
          continue;
        }

        const newConfidence = Math.min(1.0, (current.confidence || 0) + (ins.confidence_delta || 0.10));
        const newTimesConfirmed = (current.times_confirmed || 0) + 1;

        // Auto-promote: hypothesis -> confirmed at >= 0.6
        let newStatus = current.status;
        if (ins.new_status) {
          newStatus = ins.new_status;
        } else if (current.status === 'hypothesis' && newConfidence >= 0.6) {
          newStatus = 'confirmed';
          console.log(`[Strategist-Weekly] Auto-promoting insight ${ins.id} to confirmed (confidence: ${newConfidence.toFixed(2)})`);
        }

        const { error: updateErr } = await supabase
          .from('strategy_insights')
          .update({
            confidence: newConfidence,
            times_confirmed: newTimesConfirmed,
            status: newStatus,
            supporting_data: ins.supporting_data || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ins.id);

        if (updateErr) throw updateErr;
        updated.push(ins.id);
        console.log(`[Strategist-Weekly] Updated insight ${ins.id}: confidence ${newConfidence.toFixed(2)}, status ${newStatus}`);

      } else if (ins.action === 'invalidate' && ins.id) {
        const { error: invErr } = await supabase
          .from('strategy_insights')
          .update({
            status: 'invalidated',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ins.id);

        if (invErr) throw invErr;
        invalidated.push(ins.id);
        console.log(`[Strategist-Weekly] Invalidated insight ${ins.id}`);
      }
    } catch (err) {
      console.error(`[Strategist-Weekly] Failed to process insight (action: ${ins.action}): ${err.message}`);
    }
  }

  return { created, updated, invalidated };
}

// ── Process tasks ───────────────────────────────────────────

async function processTasks(tasks) {
  const createdIds = [];

  for (const task of tasks) {
    try {
      const { data, error } = await supabase
        .from('strategy_tasks')
        .insert({
          task_type: task.task_type,
          title: task.title,
          description: task.description,
          recommended_action: task.recommended_action,
          urgency: task.urgency || 'normal',
          proposed_directive: task.proposed_directive || null,
          status: 'pending',
          source: 'strategist-weekly',
        })
        .select('id')
        .single();

      if (error) throw error;
      createdIds.push(data.id);
      console.log(`[Strategist-Weekly] Created task: ${task.title}`);
    } catch (err) {
      console.error(`[Strategist-Weekly] Failed to create task "${task.title}": ${err.message}`);
    }
  }

  return createdIds;
}

// ── Write strategy report ───────────────────────────────────

async function writeReport(result, insightIds, taskIds) {
  const weekStartDate = new Date(weekAgo).toISOString().split('T')[0];

  try {
    const { error } = await supabase
      .from('strategy_reports')
      .insert({
        report_type: 'weekly_strategy',
        period_start: weekStartDate,
        period_end: today,
        summary: result.summary,
        content_performance: result.content_performance,
        competitor_analysis: result.competitor_analysis || null,
        trend_analysis: result.trend_analysis || null,
        recommendations: result.tasks,
        insights_created: insightIds.created,
        insights_updated: insightIds.updated,
        tasks_created: taskIds,
      });

    if (error) throw error;
    console.log(`[Strategist-Weekly] Strategy report written for ${weekStartDate} to ${today}`);
  } catch (err) {
    console.error(`[Strategist-Weekly] Failed to write strategy report: ${err.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('[Strategist-Weekly] Starting weekly strategy analysis...');
  console.log(`[Strategist-Weekly] Period: ${new Date(weekAgo).toISOString().split('T')[0]} to ${today}`);
  const startTime = Date.now();

  // Fetch all data in parallel
  const [
    weekContent,
    briefings,
    allInsights,
    weekTasks,
    directives,
    weekRuns,
    weekCosts,
    competitors,
    weekFeedback,
  ] = await Promise.all([
    fetchWeekContent(),
    fetchWeekBriefings(),
    fetchAllInsights(),
    fetchWeekTasks(),
    fetchActiveDirectives(),
    fetchWeekRuns(),
    fetchWeekCosts(),
    fetchCompetitorData(),
    fetchWeekFeedback(),
  ]);

  const data = {
    weekContent,
    briefings,
    allInsights,
    weekTasks,
    directives,
    weekRuns,
    weekCosts,
    competitors,
    weekFeedback,
  };

  // Build prompt
  const userPrompt = buildUserPrompt(data);

  // Call Claude Sonnet
  console.log(`[Strategist-Weekly] Calling Claude (${CLAUDE_MODEL})...`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Log cost
  await logCost(supabase, {
    pipeline_stage: 'learning',
    service: 'anthropic',
    model: CLAUDE_MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    description: 'Strategist weekly analysis',
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
    console.error('[Strategist-Weekly] JSON parse failed. Raw response:');
    console.error(text.slice(0, 1000));
    throw new Error(`JSON parse failed: ${err.message}`);
  }

  // Process insights
  const insightIds = await processInsights(result.insights || []);
  console.log(`[Strategist-Weekly] Insights — created: ${insightIds.created.length}, updated: ${insightIds.updated.length}, invalidated: ${insightIds.invalidated.length}`);

  // Process tasks
  const taskIds = await processTasks(result.tasks || []);
  console.log(`[Strategist-Weekly] Tasks created: ${taskIds.length}`);

  // Write strategy report
  await writeReport(result, insightIds, taskIds);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Strategist-Weekly] Done in ${elapsed}s.`);

  // Print executive summary
  console.log('\n=== WEEKLY STRATEGY REPORT ===');
  console.log(`\nSummary: ${result.summary}`);

  if (result.content_performance) {
    const cp = result.content_performance;
    console.log(`\nContent: ${cp.total_generated || 0} generated, ${(cp.approval_rate * 100).toFixed(0)}% approval rate`);
    console.log(`By pillar: ${JSON.stringify(cp.by_pillar || {})}`);
    console.log(`By format: ${JSON.stringify(cp.by_format || {})}`);
    if (cp.top_rejection_reasons?.length > 0) {
      console.log(`Top rejection reasons: ${cp.top_rejection_reasons.join(', ')}`);
    }
  }

  if (result.cost_analysis) {
    const ca = result.cost_analysis;
    console.log(`\nCosts: $${ca.total_week?.toFixed(2) || '0.00'} total, $${ca.cost_per_post?.toFixed(2) || '0.00'}/post`);
  }

  if (result.system_health) {
    const sh = result.system_health;
    console.log(`\nSystem: ${((sh.agent_success_rate || 0) * 100).toFixed(0)}% success rate, ${sh.total_runs || 0} runs, ${sh.failed_runs || 0} failures`);
  }

  console.log(`\nInsights: +${insightIds.created.length} new, ${insightIds.updated.length} updated, ${insightIds.invalidated.length} invalidated`);
  console.log(`Tasks: ${taskIds.length} proposed for next week`);

  if (result.next_week_focus) {
    console.log(`\nNext week focus: ${result.next_week_focus}`);
  }

  await printCostSummary(supabase);
}

main().catch((err) => {
  console.error('[Strategist-Weekly] Fatal error:', err);
  process.exit(1);
});
