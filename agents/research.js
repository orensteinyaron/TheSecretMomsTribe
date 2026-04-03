/**
 * SMT Research Agent
 *
 * Runs daily at 7am Israel time via GitHub Actions.
 * Scans parenting-niche signals from Reddit, TikTok, and Google Trends.
 * Uses Claude Haiku to synthesize top 5 content opportunities.
 * Writes results to Supabase daily_briefings table.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APIFY_TOKEN=... ANTHROPIC_API_KEY=... node agents/research.js
 */

import { createClient } from '@supabase/supabase-js';
import { ApifyClient } from 'apify-client';
import Anthropic from '@anthropic-ai/sdk';

// --- Config ---

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !APIFY_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const apify = new ApifyClient({ token: APIFY_TOKEN });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const REDDIT_SUBREDDITS = [
  // Parenting
  'https://www.reddit.com/r/Parenting/',
  'https://www.reddit.com/r/Mommit/',
  'https://www.reddit.com/r/teenagers/',
  'https://www.reddit.com/r/Toddlers/',
  'https://www.reddit.com/r/NewParents/',
  'https://www.reddit.com/r/breakingmom/',
  // Tech & AI (for ai_magic + tech_for_moms)
  'https://www.reddit.com/r/ChatGPT/',
  'https://www.reddit.com/r/LifeProTips/',
  'https://www.reddit.com/r/apps/',
];

const TIKTOK_HASHTAGS = [
  // Parenting
  'momtok', 'parentingtips', 'momlife', 'toddlermom',
  // AI & Tech
  'aitips', 'aihacks', 'techformoms',
  // Health & Wellness
  'momhealth', 'mentalload',
];

const GOOGLE_TRENDS_QUERIES = [
  'parenting tips', 'AI for parents', 'best apps for moms',
  'mom burnout', 'mom hacks',
];

// --- Scrapers ---

async function scanReddit() {
  console.log('[Research] Scanning Reddit (6 subreddits)...');
  try {
    const run = await apify.actor('trudax/reddit-scraper-lite').call({
      startUrls: REDDIT_SUBREDDITS.map((url) => ({ url })),
      sort: 'top',
      time: 'day',
      maxItems: 20,
      maxPostCount: 20,
      maxComments: 0,
      proxy: { useApifyProxy: true },
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    console.log(`[Research] Reddit raw results: ${items.length}`);

    const filtered = items
      .filter((p) => (p.score || p.upVotes || p.ups || 0) >= 30)
      .slice(0, 15)
      .map((p) => ({
        source: 'reddit',
        title: p.title || '',
        content: (p.body || p.selftext || p.text || '').slice(0, 500),
        url: p.url || p.permalink || '',
        subreddit: p.subreddit || p.communityName || '',
        upvotes: p.score || p.upVotes || p.ups || 0,
        comments: p.numberOfComments || p.numComments || p.commentCount || 0,
      }));

    console.log(`[Research] Reddit after filter: ${filtered.length} posts`);
    return filtered;
  } catch (err) {
    console.warn(`[Research] Reddit scraper failed: ${err.message}`);
    return [];
  }
}

async function scanTikTokTrends() {
  console.log('[Research] Scanning TikTok trends (6 hashtags)...');
  try {
    const run = await apify.actor('clockworks/free-tiktok-scraper').call({
      hashtags: TIKTOK_HASHTAGS,
      resultsPerPage: 15,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    console.log(`[Research] TikTok raw results: ${items.length}`);

    const filtered = items
      .filter((v) => (v.playCount || 0) >= 10000)
      .slice(0, 15)
      .map((v) => ({
        source: 'tiktok',
        title: (v.text || '').slice(0, 200),
        url: v.webVideoUrl || '',
        views: v.playCount || 0,
        likes: v.diggCount || 0,
        comments: v.commentCount || 0,
        shares: v.shareCount || 0,
      }));

    console.log(`[Research] TikTok after filter: ${filtered.length} videos`);
    return filtered;
  } catch (err) {
    console.warn(`[Research] TikTok scraper failed: ${err.message}`);
    return [];
  }
}

async function scanGoogleTrends() {
  console.log('[Research] Scanning Google Trends (3 queries)...');
  try {
    const run = await apify.actor('apify/google-trends-scraper').call({
      searchTerms: GOOGLE_TRENDS_QUERIES,
      isMultiple: false,
      timeRange: 'now 7-d',
      geo: 'US',
      maxItems: 10,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    console.log(`[Research] Google Trends raw results: ${items.length}`);

    const signals = items.slice(0, 10).map((t) => ({
      source: 'google_trends',
      title: t.searchTerm || t.term || t.title || '',
      url: t.shareUrl || '',
      relatedQueries: (t.relatedQueries || t.risingQueries || []).slice(0, 5),
      isRising: t.isRising || false,
    }));

    console.log(`[Research] Google Trends signals: ${signals.length}`);
    return signals;
  } catch (err) {
    console.warn(`[Research] Google Trends scraper failed (non-fatal): ${err.message}`);
    return [];
  }
}

async function scanRedditFallback() {
  console.log('[Research] Running Reddit fallback scan (r/Parenting only)...');
  try {
    const run = await apify.actor('trudax/reddit-scraper-lite').call({
      startUrls: [{ url: 'https://www.reddit.com/r/Parenting/' }],
      sort: 'hot',
      time: 'day',
      maxItems: 10,
      maxPostCount: 10,
      maxComments: 0,
      proxy: { useApifyProxy: true },
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    console.log(`[Research] Reddit fallback raw results: ${items.length}`);

    const signals = items.slice(0, 10).map((p) => ({
      source: 'reddit_fallback',
      title: p.title || '',
      content: (p.body || p.selftext || p.text || '').slice(0, 500),
      url: p.url || p.permalink || '',
      subreddit: p.subreddit || p.communityName || 'Parenting',
      upvotes: p.score || p.upVotes || p.ups || 0,
      comments: p.numberOfComments || p.numComments || p.commentCount || 0,
    }));

    console.log(`[Research] Reddit fallback signals: ${signals.length}`);
    return signals;
  } catch (err) {
    console.warn(`[Research] Reddit fallback also failed (non-fatal): ${err.message}`);
    return [];
  }
}

// --- Dedup ---

async function fetchRecentTopics() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_briefings')
      .select('opportunities')
      .gte('briefing_date', dateStr);

    if (error || !data) return [];

    return data
      .flatMap((row) => (row.opportunities || []))
      .map((opp) => (opp.topic || '').toLowerCase())
      .filter(Boolean);
  } catch (err) {
    console.warn(`[Research] Failed to fetch recent topics for dedup: ${err.message}`);
    return [];
  }
}

// --- Claude Synthesis ---

const SYSTEM_PROMPT = `You are the content strategist for Secret Moms Tribe (SMT), a parenting content brand on TikTok and Instagram targeting moms of kids ages 1-16.

## Brand Identity
The mom who always knows things first. Finds the AI hacks, the apps, the science, the tricks — and shares them before anyone else does.

## Brand Voice
Warm, knowing mom friend. Uses "we" and "us." Slight humor, never condescending. She knows things other moms don't — that's the "secret."

## Content Categories (5 categories — scan for ALL)
1. ai_magic (30%) — Shows AI doing something useful for a mom on screen. Always has: the prompt/input + the AI output. Examples: AI writes bedtime story, AI generates school lunches from fridge photo, AI writes the hard email to teacher, AI creates conversation starters for teen.
2. parenting_insights (25%) — Science-backed, behavior-based, emotionally resonant. Always reframes something moms feel guilty about. Examples: why your teen says "fine", toddler meltdowns are nervous system not defiance, the 10 minute rule that changes bedtime.
3. tech_for_moms (20%) — Apps, tools, shortcuts. Specific and actionable. Always leads with the result not the tool. Examples: app that scans fridge and plans dinner, Chrome extension for focus, 3 phone settings every mom should change tonight.
4. mom_health (15%) — Mental load, burnout, sleep, physical health. Never preachy, always practical. Examples: the 90 second reset when you're about to snap, why you're always tired, the thing nobody tells you about mom brain.
5. trending_culture (10%) — News, studies, viral moments reframed for moms. Always timely with a SMT angle. Examples: new screen time study (what it actually means), that viral parenting debate (here's the nuance).

## Content Types
- wow: AI-magic outputs, tech reveals, actionable tools that make viewers say "I need this." Show the OUTPUT, not the process.
- trust: Relatable mom moments, memes, guilt reframes. Builds community. Gets shares.
- cta: Save/share-driven. Only when organic and earned. Never hard-sell.

## KEY LESSONS
- Meme/relatable content outperforms educational 25:1
- ALWAYS lead with emotion, never with information
- Hook MUST grab attention in 0-3 seconds
- Show the OUTPUT not the process (especially AI magic and tech)
- Apps/tools perform best when you show the RESULT first
- Cross-posting fails — each platform needs NATIVE content

## Category Mix Target (across 5 opportunities)
- 1-2x ai_magic
- 1x parenting_insights
- 1x tech_for_moms
- 0-1x mom_health
- 0-1x trending_culture
At least 3 different categories must be represented. Never more than 2 from same category.

## Content Type Distribution
- 2-3x wow
- 1-2x trust
- 0-1x cta

## Quality Requirements
- At least 3 different categories represented
- At least 1 TikTok-native, at least 1 Instagram-native
- Every opportunity has a clear EMOTIONAL angle
- Every suggested_hook works in 0-3 seconds
- Do NOT repeat topics from the "Topics to AVOID" list

## Age Ranges
Tag each opportunity with the most relevant age range:
- toddler (1-3)
- little_kid (4-7)
- school_age (8-12)
- teen (13-16)
- universal (all ages — max 1 per batch of 5)

Ensure at least 2 different age ranges across the 5 opportunities.

## Output Format
Return a JSON array of exactly 5 objects. Each object:
{
  "topic": "Short topic title (5-8 words)",
  "category": "ai_magic | parenting_insights | tech_for_moms | mom_health | trending_culture",
  "age_range": "toddler | little_kid | school_age | teen | universal",
  "angle": "The specific creative angle for SMT (1-2 sentences)",
  "source": "reddit | tiktok | google_trends | cross_signal",
  "source_url": "URL to the primary source signal (empty string if none)",
  "reasoning": "Why this will resonate with our audience (1-2 sentences)",
  "content_type": "wow | trust | cta",
  "platform_fit": "tiktok | instagram | both",
  "priority": 1-5 (integer, 1 = highest),
  "suggested_hook": "The opening line or first 3 seconds (be specific and punchy)"
}

Return ONLY the JSON array. No markdown fences, no explanation.`;

function buildUserPrompt(sources, recentTopics) {
  const sections = [];

  sections.push('# Signals Collected Today\n');

  if (sources.reddit.length > 0) {
    sections.push(`## Reddit (${sources.reddit.length} posts)`);
    sections.push(JSON.stringify(sources.reddit, null, 2));
    sections.push('');
  } else {
    sections.push('## Reddit\nNo results today.\n');
  }

  if (sources.tiktok.length > 0) {
    sections.push(`## TikTok Trending (${sources.tiktok.length} videos)`);
    sections.push(JSON.stringify(sources.tiktok, null, 2));
    sections.push('');
  } else {
    sections.push('## TikTok Trending\nNo results today.\n');
  }

  if (sources.google_trends.length > 0) {
    sections.push(`## Google Trends (${sources.google_trends.length} signals)`);
    sections.push(JSON.stringify(sources.google_trends, null, 2));
    sections.push('');
  } else {
    sections.push('## Google Trends\nNo results today.\n');
  }

  if (recentTopics.length > 0) {
    sections.push(`## Topics to AVOID (used in last 7 days)`);
    sections.push(recentTopics.join(', '));
    sections.push('');
  }

  sections.push('Analyze all signals above. Identify the 5 best content opportunities for today. Return ONLY a JSON array of 5 objects following the schema in your instructions.');

  return sections.join('\n');
}

// --- Validation ---

const VALID_CATEGORIES = ['ai_magic', 'parenting_insights', 'tech_for_moms', 'mom_health', 'trending_culture'];
const VALID_CONTENT_TYPES = ['wow', 'trust', 'cta'];
const VALID_PLATFORM_FIT = ['tiktok', 'instagram', 'both'];

function validateOpportunities(opportunities) {
  if (!Array.isArray(opportunities) || opportunities.length < 3 || opportunities.length > 5) {
    throw new Error(`Expected 3-5 opportunities, got ${Array.isArray(opportunities) ? opportunities.length : typeof opportunities}`);
  }

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const prefix = `Opportunity ${i + 1}`;

    if (!opp.topic) throw new Error(`${prefix}: missing topic`);
    if (!opp.category || !VALID_CATEGORIES.includes(opp.category)) {
      throw new Error(`${prefix}: invalid category "${opp.category}"`);
    }
    if (!opp.angle) throw new Error(`${prefix}: missing angle`);
    if (!opp.content_type || !VALID_CONTENT_TYPES.includes(opp.content_type)) {
      throw new Error(`${prefix}: invalid content_type "${opp.content_type}"`);
    }
    if (!opp.platform_fit || !VALID_PLATFORM_FIT.includes(opp.platform_fit)) {
      throw new Error(`${prefix}: invalid platform_fit "${opp.platform_fit}"`);
    }
    if (!opp.suggested_hook) throw new Error(`${prefix}: missing suggested_hook`);

    // Default optional fields
    opp.source_url = opp.source_url || '';
    opp.source = opp.source || 'cross_signal';
    opp.reasoning = opp.reasoning || '';
    opp.priority = Number(opp.priority) || (i + 1);
  }

  // Soft checks (warn but don't fail)
  const categories = new Set(opportunities.map((o) => o.category));
  if (categories.size < 3) {
    console.warn(`[Research] Soft warning: only ${categories.size} distinct categories (target: 3+)`);
  }

  const wowCount = opportunities.filter((o) => o.content_type === 'wow').length;
  if (wowCount < 2) {
    console.warn(`[Research] Soft warning: only ${wowCount} wow opportunities (target: 2-3)`);
  }

  const platforms = new Set(opportunities.map((o) => o.platform_fit));
  if (!platforms.has('tiktok') && !platforms.has('both')) {
    console.warn('[Research] Soft warning: no TikTok-native opportunities');
  }
  if (!platforms.has('instagram') && !platforms.has('both')) {
    console.warn('[Research] Soft warning: no Instagram-native opportunities');
  }

  const catMix = {};
  for (const opp of opportunities) {
    catMix[opp.category] = (catMix[opp.category] || 0) + 1;
  }
  const typeMix = {};
  for (const opp of opportunities) {
    typeMix[opp.content_type] = (typeMix[opp.content_type] || 0) + 1;
  }
  console.log(`[Research] Categories: ${JSON.stringify(catMix)}`);
  console.log(`[Research] Content types: ${JSON.stringify(typeMix)}`);

  return opportunities;
}

// --- Synthesis ---

async function generateBriefing(sources) {
  console.log('[Research] Fetching recent topics for dedup...');
  const recentTopics = await fetchRecentTopics();
  console.log(`[Research] Topics to avoid: ${recentTopics.length}`);

  const userPrompt = buildUserPrompt(sources, recentTopics);

  console.log(`[Research] Calling Claude (${CLAUDE_MODEL})...`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let text = msg.content[0].text.trim();

  // Strip markdown fences if Claude wraps them
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let opportunities;
  try {
    opportunities = JSON.parse(text);
  } catch (err) {
    console.error('[Research] Failed to parse Claude response as JSON:');
    console.error(text.slice(0, 500));
    throw new Error(`JSON parse failed: ${err.message}`);
  }

  return validateOpportunities(opportunities);
}

// --- Write to Supabase ---

async function writeBriefing(opportunities, sourceSummary) {
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('daily_briefings')
    .upsert(
      {
        briefing_date: today,
        opportunities,
        sources: sourceSummary,
      },
      { onConflict: 'briefing_date' }
    );

  if (error) {
    console.error('[Research] Failed to write briefing:', error);
    process.exit(1);
  }

  console.log(`[Research] Briefing written for ${today}`);
}

// --- Main ---

async function main() {
  console.log('[Research Agent] Starting daily scan...');
  const startTime = Date.now();

  // Run all scrapers in parallel
  const [reddit, tiktok, googleTrends] = await Promise.allSettled([
    scanReddit(),
    scanTikTokTrends(),
    scanGoogleTrends(),
  ]);

  const sources = {
    reddit: reddit.status === 'fulfilled' ? reddit.value : [],
    tiktok: tiktok.status === 'fulfilled' ? tiktok.value : [],
    google_trends: googleTrends.status === 'fulfilled' ? googleTrends.value : [],
  };

  // Fallback: if Google Trends returned < 2 results, supplement with extra Reddit scan
  if (sources.google_trends.length < 2) {
    console.warn(`[Research] Google Trends returned only ${sources.google_trends.length} results — running Reddit fallback`);
    const fallback = await scanRedditFallback();
    sources.reddit = [...sources.reddit, ...fallback];
  }

  // Log results per source
  for (const [name, data] of Object.entries(sources)) {
    console.log(`[Research] ${name}: ${data.length} signals`);
  }

  const totalSignals = sources.reddit.length + sources.tiktok.length + sources.google_trends.length;
  console.log(`[Research] Total signals: ${totalSignals}`);

  if (totalSignals === 0) {
    console.error('[Research] No signals from any source. Aborting.');
    process.exit(1);
  }

  // Synthesize with Claude
  const opportunities = await generateBriefing(sources);

  // Build source summary for Supabase
  const sourceSummary = {
    reddit: {
      count: sources.reddit.length,
      status: reddit.status === 'fulfilled' ? (sources.reddit.length > 0 ? 'ok' : 'empty') : 'failed',
    },
    tiktok: {
      count: sources.tiktok.length,
      status: tiktok.status === 'fulfilled' ? (sources.tiktok.length > 0 ? 'ok' : 'empty') : 'failed',
    },
    google_trends: {
      count: sources.google_trends.length,
      status: googleTrends.status === 'fulfilled' ? (sources.google_trends.length > 0 ? 'ok' : 'empty') : 'failed',
    },
  };

  // Write to Supabase
  await writeBriefing(opportunities, sourceSummary);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Research Agent] Done in ${elapsed}s.`);
  console.log(`[Research Agent] ${opportunities.length} opportunities written to Supabase.`);

  // Print summary
  console.log('\n=== TODAY\'S OPPORTUNITIES ===');
  for (const opp of opportunities) {
    console.log(`\n${opp.priority}. [${opp.content_type.toUpperCase()}] ${opp.topic}`);
    console.log(`   Pillar: ${opp.pillar} | Platform: ${opp.platform_fit}`);
    console.log(`   Hook: "${opp.suggested_hook}"`);
    console.log(`   Angle: ${opp.angle}`);
  }
}

main().catch((err) => {
  console.error('[Research Agent] Fatal error:', err);
  process.exit(1);
});
