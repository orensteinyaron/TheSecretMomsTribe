/**
 * SMT Learning Agent
 *
 * Runs weekly (Sunday night) via GitHub Actions.
 * Pulls performance data, analyzes what worked,
 * feeds insights back into the system.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node agents/learning.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchWeeklyPerformance() {
  // TODO: Pull metrics from IG Graph API and TikTok API
  // for all posts published in the last 7 days.
  // Write snapshots to performance_data table.
  console.log('[Learning] Fetching weekly performance data...');
  return [];
}

async function analyzePerformance(data) {
  // TODO: Use Anthropic API to analyze:
  // - Which content types performed best (wow vs trust vs cta)
  // - Which pillars got most engagement
  // - Which hooks stopped the scroll
  // - Platform-specific patterns
  console.log('[Learning] Analyzing performance...');
  return {
    topContentType: null,
    topPillar: null,
    topHookPattern: null,
    recommendations: [],
  };
}

async function writeLessons(insights) {
  if (!insights.recommendations?.length) return;

  const rows = insights.recommendations.map((rec) => ({
    lesson: rec,
    source: `weekly-report-${new Date().toISOString().split('T')[0]}`,
    tags: ['auto', 'weekly-learning'],
  }));

  const { error } = await supabase.from('lessons').insert(rows);

  if (error) {
    console.error('[Learning] Failed to write lessons:', error);
  } else {
    console.log(`[Learning] ${rows.length} lessons recorded`);
  }
}

async function main() {
  console.log('[Learning Agent] Starting weekly analysis...');

  const perfData = await fetchWeeklyPerformance();
  const insights = await analyzePerformance(perfData);
  await writeLessons(insights);

  console.log('[Learning Agent] Done.');
  console.log('[Learning] Insights:', JSON.stringify(insights, null, 2));
}

main().catch((err) => {
  console.error('[Learning Agent] Fatal error:', err);
  process.exit(1);
});
