/**
 * SMT Research Agent
 *
 * Runs daily at 7am Israel time via GitHub Actions.
 * Scans parenting-niche signals and writes top 5 content
 * opportunities to Supabase daily_briefings table.
 *
 * See: agents/research.instructions.md for full runtime spec.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APIFY_TOKEN=... node agents/research.js
 */

import { createClient } from '@supabase/supabase-js';

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function scanReddit() {
  console.log('[Research] Scanning Reddit...');
  // TODO: Implement Apify Reddit scraper
  // Subreddits: r/Parenting, r/Mommit, r/teenagers, r/Toddlers
  // Filter: 100+ upvotes, last 24 hours
  return [];
}

async function scanTikTokTrends() {
  console.log('[Research] Scanning TikTok trends...');
  // TODO: Implement Apify TikTok trend scanner
  // Hashtags: #momtok, #parentingtips, #momlife
  // Filter: 100K+ views, last 48 hours
  return [];
}

async function scanInstagramTrends() {
  console.log('[Research] Scanning Instagram trends...');
  // TODO: Implement Apify Instagram trend scanner
  // Focus: parenting reels, high engagement
  return [];
}

async function scanGoogleTrends() {
  console.log('[Research] Scanning Google Trends...');
  // TODO: Implement Google Trends API or scraper
  // Keywords: parenting, kids, toddler, teenager, mom hack
  return [];
}

async function generateBriefing(signals) {
  console.log('[Research] Generating briefing from signals...');
  // TODO: Use Anthropic API (model: CLAUDE_MODEL) to analyze signals
  // and produce top 5 content opportunities in the specified JSON format.
  // See research.instructions.md for output schema.
  return [];
}

async function writeBriefing(opportunities, sources) {
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('daily_briefings')
    .upsert(
      {
        briefing_date: today,
        opportunities,
        sources,
      },
      { onConflict: 'briefing_date' }
    );

  if (error) {
    console.error('[Research] Failed to write briefing:', error);
    process.exit(1);
  }

  console.log(`[Research] Briefing written for ${today}`);
}

async function main() {
  console.log('[Research Agent] Starting daily scan...');
  const startTime = Date.now();

  // Scan all sources in parallel
  const [reddit, tiktok, instagram, googleTrends] = await Promise.allSettled([
    scanReddit(),
    scanTikTokTrends(),
    scanInstagramTrends(),
    scanGoogleTrends(),
  ]);

  const sources = {
    reddit: reddit.status === 'fulfilled' ? reddit.value : [],
    tiktok: tiktok.status === 'fulfilled' ? tiktok.value : [],
    instagram: instagram.status === 'fulfilled' ? instagram.value : [],
    google_trends: googleTrends.status === 'fulfilled' ? googleTrends.value : [],
  };

  const allSignals = [
    ...sources.reddit,
    ...sources.tiktok,
    ...sources.instagram,
    ...sources.google_trends,
  ];

  const opportunities = await generateBriefing(allSignals);
  await writeBriefing(opportunities, sources);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Research Agent] Done in ${elapsed}s. ${opportunities.length} opportunities found.`);
}

main().catch((err) => {
  console.error('[Research Agent] Fatal error:', err);
  process.exit(1);
});
