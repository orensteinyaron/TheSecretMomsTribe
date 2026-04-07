/**
 * SMT Data Fetcher Agent
 *
 * Runs daily to scrape competitor account metrics via Apify.
 * Writes results to social_metrics and competitor_accounts tables in Supabase.
 * Seeds competitor_accounts on first run if empty.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APIFY_TOKEN=... node agents/data-fetcher.js
 */

import { createClient } from '@supabase/supabase-js';
import { ApifyClient } from 'apify-client';
import { logCost, printCostSummary } from '../scripts/utils/cost-logger.js';

// --- Config ---

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !APIFY_TOKEN) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const apify = new ApifyClient({ token: APIFY_TOKEN });

// --- Seed Data ---

const SEED_COMPETITORS = [
  // Direct competitors (mom content creators)
  { platform: 'instagram', handle: 'busytoddler', name: 'Busy Toddler', category: 'aspirational' },
  { platform: 'instagram', handle: 'biglittlefeelings', name: 'Big Little Feelings', category: 'aspirational' },
  { platform: 'instagram', handle: 'momlife', name: 'Mom Life', category: 'direct_competitor' },
  { platform: 'instagram', handle: 'mothercould', name: 'Mother Could', category: 'direct_competitor' },
  { platform: 'tiktok', handle: 'momtokofficial', name: 'MomTok Official', category: 'direct_competitor' },
  { platform: 'tiktok', handle: 'parentinghacks', name: 'Parenting Hacks', category: 'adjacent_niche' },
  // AI/tech adjacent
  { platform: 'instagram', handle: 'aabornefeld', name: 'AI Mom', category: 'adjacent_niche' },
  { platform: 'tiktok', handle: 'aimomhacks', name: 'AI Mom Hacks', category: 'adjacent_niche' },
];

// --- Seed Competitors ---

async function seedCompetitorsIfEmpty() {
  const { data, error } = await supabase
    .from('competitor_accounts')
    .select('id')
    .limit(1);

  if (error) {
    console.error(`[DataFetcher] Failed to check competitor_accounts: ${error.message}`);
    return;
  }

  if (data && data.length > 0) {
    console.log('[DataFetcher] competitor_accounts already seeded, skipping.');
    return;
  }

  console.log(`[DataFetcher] Seeding ${SEED_COMPETITORS.length} competitor accounts...`);

  const rows = SEED_COMPETITORS.map((c) => ({
    platform: c.platform,
    handle: c.handle,
    name: c.name,
    category: c.category,
    track: true,
  }));

  const { error: upsertError } = await supabase
    .from('competitor_accounts')
    .upsert(rows, { onConflict: 'platform,handle' });

  if (upsertError) {
    console.error(`[DataFetcher] Failed to seed competitors: ${upsertError.message}`);
  } else {
    console.log(`[DataFetcher] Seeded ${rows.length} competitor accounts.`);
  }
}

// --- Instagram Scraping ---

async function scrapeInstagramProfile(handle) {
  console.log(`[DataFetcher] Scraping IG profile: @${handle}...`);
  try {
    const run = await apify.actor('apify/instagram-profile-scraper').call({
      usernames: [handle],
      resultsLimit: 1,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    if (!items || items.length === 0) return null;

    const profile = items[0];
    return {
      followers: profile.followersCount || profile.edge_followed_by?.count || 0,
      following: profile.followingCount || profile.edge_follow?.count || 0,
      posts_count: profile.postsCount || profile.edge_owner_to_timeline_media?.count || 0,
      engagement_rate: null,
      raw_data: profile,
    };
  } catch (err) {
    console.warn(`[DataFetcher] IG scrape failed for @${handle}: ${err.message}`);
    return null;
  }
}

// --- TikTok Scraping ---

async function scrapeTikTokProfile(handle) {
  console.log(`[DataFetcher] Scraping TT profile: @${handle}...`);
  try {
    const run = await apify.actor('clockworks/free-tiktok-scraper').call({
      profiles: [handle],
      resultsPerPage: 1,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    if (!items || items.length === 0) return null;

    const profile = items[0];
    return {
      followers: profile.authorMeta?.fans || profile.followerCount || 0,
      following: profile.authorMeta?.following || profile.followingCount || 0,
      likes: profile.authorMeta?.heart || profile.heartCount || 0,
      engagement_rate: null,
      raw_data: profile,
    };
  } catch (err) {
    console.warn(`[DataFetcher] TT scrape failed for @${handle}: ${err.message}`);
    return null;
  }
}

// --- Write Metrics ---

async function writeMetrics(handle, platform, isOwn, metrics) {
  const row = {
    platform,
    metric_type: 'account',
    account_handle: handle,
    is_own_account: isOwn,
    followers: metrics.followers,
    following: metrics.following,
    engagement_rate: metrics.engagement_rate,
    raw_data: metrics.raw_data,
    collected_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('social_metrics').insert(row);
  if (error) {
    console.error(`[DataFetcher] Failed to write metrics for @${handle}: ${error.message}`);
  } else {
    console.log(`[DataFetcher] Metrics saved: @${handle} (${platform}) — ${metrics.followers} followers`);
  }
}

// --- Main ---

async function main() {
  console.log('[Data Fetcher] Starting daily data collection...');
  const startTime = Date.now();

  // 1. Seed competitors if empty
  await seedCompetitorsIfEmpty();

  // 2. Fetch tracked competitors
  const { data: competitors, error } = await supabase
    .from('competitor_accounts')
    .select('*')
    .eq('track', true);

  if (error) {
    console.error(`[DataFetcher] Failed to fetch competitors: ${error.message}`);
    process.exit(1);
  }

  if (!competitors || competitors.length === 0) {
    console.log('[DataFetcher] No competitors to track. Done.');
    return;
  }

  console.log(`[DataFetcher] Tracking ${competitors.length} competitor(s)`);

  // 3. Scrape each by platform
  let successCount = 0;
  let failCount = 0;

  for (const comp of competitors) {
    let metrics;
    if (comp.platform === 'instagram') {
      metrics = await scrapeInstagramProfile(comp.handle);
    } else if (comp.platform === 'tiktok') {
      metrics = await scrapeTikTokProfile(comp.handle);
    } else {
      console.warn(`[DataFetcher] Unknown platform "${comp.platform}" for @${comp.handle}, skipping.`);
      continue;
    }

    if (metrics) {
      await writeMetrics(comp.handle, comp.platform, false, metrics);
      successCount++;
    } else {
      failCount++;
    }

    // Log cost per scrape
    await logCost(supabase, {
      pipeline_stage: 'scraping',
      service: 'apify',
      model: comp.platform === 'instagram' ? 'apify-instagram' : 'apify-tiktok',
      description: `Profile scrape: @${comp.handle} (${comp.platform})`,
      metadata: { handle: comp.handle, platform: comp.platform, success: !!metrics },
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Data Fetcher] Done in ${elapsed}s. Success: ${successCount}, Failed: ${failCount}`);
  await printCostSummary(supabase);
}

main().catch((err) => {
  console.error('[Data Fetcher] Fatal error:', err);
  process.exit(1);
});
