/**
 * SMT Content Generation Agent
 *
 * Triggered after Research Agent completes.
 * Reads today's briefing → generates 4 ready-to-post content items.
 *
 * See: agents/content.instructions.md for full runtime spec.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/content.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getTodaysBriefing() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('briefing_date', today)
    .single();

  if (error || !data) {
    console.error('[Content] No briefing found for today:', error?.message);
    process.exit(1);
  }

  return data;
}

async function generateContent(briefing) {
  console.log('[Content] Generating content from briefing...');
  // TODO: Use Anthropic API to generate 4 content items:
  // - 3 TikTok posts (native format)
  // - 1 Instagram post (Reel-first)
  // Follow content.instructions.md for voice, format, quality checks.
  return [];
}

async function writeContentQueue(items, briefingId) {
  const rows = items.map((item) => ({
    briefing_id: briefingId,
    platform: item.platform,
    content_type: item.content_type,
    status: 'pending_approval',
    hook: item.hook,
    caption: item.caption,
    hashtags: item.hashtags,
    ai_magic_output: item.ai_magic_output || null,
    image_prompt: item.image_prompt || null,
    audio_suggestion: item.audio_suggestion || null,
  }));

  const { error } = await supabase.from('content_queue').insert(rows);

  if (error) {
    console.error('[Content] Failed to write content queue:', error);
    process.exit(1);
  }

  console.log(`[Content] ${rows.length} items added to content_queue`);
}

async function main() {
  console.log('[Content Agent] Starting content generation...');

  const briefing = await getTodaysBriefing();
  console.log(`[Content] Briefing has ${briefing.opportunities?.length || 0} opportunities`);

  const content = await generateContent(briefing);
  await writeContentQueue(content, briefing.id);

  console.log('[Content Agent] Done.');
}

main().catch((err) => {
  console.error('[Content Agent] Fatal error:', err);
  process.exit(1);
});
