/**
 * SMT Publishing Agent
 *
 * Posts approved content to Instagram and TikTok.
 * NOT YET FUNCTIONAL — requires platform API credentials.
 *
 * See: agents/publish.instructions.md for full runtime spec.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node agents/publish.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getApprovedPosts() {
  const { data, error } = await supabase
    .from('content_queue')
    .select('*, published_posts(id)')
    .eq('status', 'approved')
    .lte('scheduled_for', new Date().toISOString())
    .is('published_posts.id', null)
    .order('scheduled_for', { ascending: true });

  if (error) {
    console.error('[Publish] Failed to query approved posts:', error);
    return [];
  }

  return data || [];
}

async function publishToInstagram(post) {
  // TODO: Implement Instagram Graph API publishing
  // 1. Create media container
  // 2. Publish media
  console.log(`[Publish] IG publish not implemented yet: ${post.id}`);
  return null;
}

async function publishToTikTok(post) {
  // TODO: Implement TikTok Content Posting API
  // 1. Upload video
  // 2. Publish
  console.log(`[Publish] TT publish not implemented yet: ${post.id}`);
  return null;
}

async function recordPublish(contentId, platform, platformPostId, postUrl) {
  const { error } = await supabase.from('published_posts').insert({
    content_id: contentId,
    platform,
    platform_post_id: platformPostId,
    post_url: postUrl,
  });

  if (error) {
    console.error(`[Publish] Failed to record publish for ${contentId}:`, error);
  }
}

async function main() {
  console.log('[Publishing Agent] Checking for approved posts...');

  const posts = await getApprovedPosts();
  console.log(`[Publish] Found ${posts.length} posts to publish`);

  for (const post of posts) {
    const result = post.platform === 'instagram'
      ? await publishToInstagram(post)
      : await publishToTikTok(post);

    if (result) {
      await recordPublish(post.id, post.platform, result.id, result.url);
      console.log(`[Publish] Published: ${post.platform} — ${result.url}`);
    }
  }

  console.log('[Publishing Agent] Done.');
}

main().catch((err) => {
  console.error('[Publishing Agent] Fatal error:', err);
  process.exit(1);
});
