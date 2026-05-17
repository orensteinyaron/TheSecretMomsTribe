/**
 * SMT Publishing Agent
 *
 * Posts approved content to Instagram and TikTok.
 * NOT YET FUNCTIONAL — requires platform API credentials.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): the agent iterates over pending rows in
 * `scheduled_posts` (one per channel). The publish operation UPDATEs
 * the existing pending row to `posted` (or `failed`) with the platform
 * post URL + external ID. No new rows are inserted post-publish.
 *
 * See: agents/publish.instructions.md for full runtime spec.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node agents/publish.js
 */

import { createClient } from '@supabase/supabase-js';
import { CHANNEL, SCHEDULED_POST_STATUS, updateScheduledPostStatus } from './lib/channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Find scheduled_posts rows that are due now: status='pending' or
 * status='scheduled' AND scheduled_for ≤ now. The piece itself must
 * be approved.
 */
async function getDueScheduledPosts() {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*, content_queue!inner(id, status, hook, caption, hashtags, content_pillar, render_profile_id)')
    .in('status', [SCHEDULED_POST_STATUS.PENDING, SCHEDULED_POST_STATUS.SCHEDULED])
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[Publish] Failed to query due scheduled_posts:', error);
    return [];
  }

  // The piece must be approved for us to publish it.
  return (data || []).filter((sp) => sp.content_queue?.status === 'approved');
}

async function publishToInstagram(sp) {
  // TODO: Implement Instagram Graph API publishing
  // 1. Create media container
  // 2. Publish media
  console.log(`[Publish] IG publish not implemented yet: content=${sp.content_id}`);
  return null;
}

async function publishToTikTok(sp) {
  // TODO: Implement TikTok Content Posting API
  // 1. Upload video
  // 2. Publish
  console.log(`[Publish] TT publish not implemented yet: content=${sp.content_id}`);
  return null;
}

async function main() {
  console.log('[Publishing Agent] Checking for due scheduled_posts...');

  const due = await getDueScheduledPosts();
  console.log(`[Publish] Found ${due.length} scheduled_posts to publish`);

  for (const sp of due) {
    let result = null;
    try {
      if (sp.channel === CHANNEL.INSTAGRAM) {
        result = await publishToInstagram(sp);
      } else if (sp.channel === CHANNEL.TIKTOK) {
        result = await publishToTikTok(sp);
      } else {
        console.warn(`[Publish] Unknown channel "${sp.channel}" on scheduled_post ${sp.id}`);
        continue;
      }

      if (!result) continue; // not implemented yet — keep status as-is

      await updateScheduledPostStatus(supabase, sp.content_id, sp.channel, SCHEDULED_POST_STATUS.POSTED, {
        post_url: result.url,
        external_post_id: result.id,
        published_at: new Date().toISOString(),
      });
      console.log(`[Publish] Published: ${sp.channel} — ${result.url}`);
    } catch (err) {
      console.error(`[Publish] Failed for content=${sp.content_id} channel=${sp.channel}: ${err.message}`);
      await updateScheduledPostStatus(supabase, sp.content_id, sp.channel, SCHEDULED_POST_STATUS.FAILED, {
        failure_reason: err.message,
      });
    }
  }

  console.log('[Publishing Agent] Done.');
}

main().catch((err) => {
  console.error('[Publishing Agent] Fatal error:', err);
  process.exit(1);
});
