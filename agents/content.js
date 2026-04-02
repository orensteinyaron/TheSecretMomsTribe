/**
 * SMT Content Generation Agent
 *
 * Triggered after Research Agent completes (or manually).
 * Reads today's briefing → generates ready-to-post content
 * for TikTok (3 posts) and Instagram (1 post).
 *
 * See: agents/content.instructions.md for full runtime spec.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/content.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- Briefing ---

async function getLatestBriefing() {
  // Try today first, fall back to most recent
  const today = new Date().toISOString().split('T')[0];

  let { data, error } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('briefing_date', today)
    .single();

  if (!data) {
    console.warn(`[Content] No briefing for ${today}, fetching most recent...`);
    ({ data, error } = await supabase
      .from('daily_briefings')
      .select('*')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .single());
  }

  if (error || !data) {
    console.error('[Content] No briefing found:', error?.message);
    process.exit(1);
  }

  console.log(`[Content] Using briefing from ${data.briefing_date} (${data.opportunities?.length || 0} opportunities)`);
  return data;
}

// --- Dedup ---

async function getRecentCaptions() {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data } = await supabase
      .from('content_queue')
      .select('hook')
      .gte('created_at', fourteenDaysAgo.toISOString());

    return (data || []).map((r) => r.hook.toLowerCase());
  } catch {
    return [];
  }
}

// --- Assignment ---

function assignOpportunities(opportunities) {
  // Pick 3 for TikTok, 1 for IG
  // Prefer: TikTok-native or "both" for TT, IG-native for IG
  const sorted = [...opportunities].sort((a, b) => a.priority - b.priority);

  const igCandidates = sorted.filter((o) => o.platform_fit === 'instagram');
  const ttCandidates = sorted.filter((o) => o.platform_fit === 'tiktok' || o.platform_fit === 'both');
  const rest = sorted.filter((o) => !igCandidates.includes(o) && !ttCandidates.includes(o));

  const igPick = igCandidates[0] || rest.pop() || sorted[sorted.length - 1];
  const ttPool = [...ttCandidates, ...rest, ...sorted].filter((o) => o !== igPick);
  const ttPicks = [...new Set(ttPool)].slice(0, 3);

  // Pad TikTok if needed
  while (ttPicks.length < 3) {
    const unused = sorted.find((o) => o !== igPick && !ttPicks.includes(o));
    if (unused) ttPicks.push(unused);
    else break;
  }

  console.log(`[Content] Assigned: ${ttPicks.length} TikTok + 1 IG`);
  return { tiktok: ttPicks, instagram: igPick };
}

// --- Claude System Prompt ---

const SYSTEM_PROMPT = `You are the content writer for Secret Moms Tribe (SMT). You write ready-to-post social media content for a parenting brand targeting moms of kids ages 1-16.

## Brand Voice
- Warm, knowing mom friend. Uses "we" and "us"
- Slight humor, never condescending
- She knows things other moms don't — that's the "secret"
- Empathetic but empowering — "you've got this"
- Conversational, not clinical. Never preachy.

## Content Philosophy
- Never show the process. Show the MAGIC — the output, not the tool
- Hook in 0-3 seconds. Magic in 3-10. Payoff in 10-15.
- Model B aesthetic: no faces shown, warm tones, cozy vibes
- Always lead with EMOTION, never with information
- Meme/relatable content outperforms educational 25:1

## KEY RULES
- Every hook must stop the scroll in 0-3 seconds
- "Wow" content shows the AI-generated OUTPUT on screen (the story, the plan, the script) — never the process
- "Trust" content taps into shared mom experiences — the viewer should think "that's literally me"
- TikTok content must feel native (not polished, not repurposed from IG)
- Instagram captions should include keywords for discovery (not just hashtags)
- Each piece of content must have a clear emotional payoff

Return ONLY valid JSON. No markdown fences, no explanation.`;

// --- TikTok Generation ---

async function generateTikTokPost(opportunity) {
  const prompt = `Create a TikTok post for this opportunity:

Topic: ${opportunity.topic}
Pillar: ${opportunity.pillar}
Content Type: ${opportunity.content_type}
Angle: ${opportunity.angle}
Suggested Hook: ${opportunity.suggested_hook}

Generate a complete TikTok post with this EXACT JSON structure:
{
  "hook": "The exact opening line/text overlay for 0-3 seconds. Must stop the scroll. Be specific and punchy.",
  "caption": "Full TikTok caption (conversational, warm, includes subtle CTA like 'save this' or 'share with a mom who needs this'). 2-4 sentences max.",
  "hashtags": ["#momlife", "#parenting", "...3-5 total highly relevant hashtags"],
  "ai_magic_output": ${opportunity.content_type === 'wow' ? '"The FULL AI-generated magic content shown on screen. If it\'s a conversation script, write the COMPLETE script with both parent and teen lines. If it\'s a plan/list, write ALL items fully. If it\'s a story, write the FULL story. This is the star of the video — make it genuinely useful and complete. Minimum 150 words."' : 'null'},
  "audio_suggestion": "Either 'Original audio — [voiceover style description]' or a specific trending sound suggestion with how to use it"
}

Return ONLY the JSON object.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseResponse(msg.content[0].text);
}

// --- Instagram Generation ---

async function generateInstagramPost(opportunity) {
  const prompt = `Create an Instagram post for this opportunity:

Topic: ${opportunity.topic}
Pillar: ${opportunity.pillar}
Content Type: ${opportunity.content_type}
Angle: ${opportunity.angle}
Suggested Hook: ${opportunity.suggested_hook}

Generate a complete Instagram post with this EXACT JSON structure:
{
  "hook": "The first line of the caption / text overlay on the first frame. Must stop the scroll in the feed.",
  "caption": "Full Instagram caption. Start with the hook line, then expand with 3-5 short paragraphs. Conversational and warm. Include relevant keywords naturally for Instagram search/discovery (Instagram SEO). End with a subtle CTA (save, share, follow). Use line breaks for readability.",
  "hashtags": ["#momlife", "#parenting", "...8-10 total, mix of niche + broader reach"],
  "ai_magic_output": ${opportunity.content_type === 'wow' ? '"The FULL AI-generated magic content. Write the COMPLETE output (script, plan, list, story). This is what gets shown in the carousel or reel. Make it genuinely useful. Minimum 150 words."' : 'null'},
  "image_prompt": "Detailed image generation prompt for DALL-E/Flux. Style: warm, cozy, soft lighting, no faces (Model B aesthetic). Include: exact composition, colors (warm earth tones, soft pastels), text overlays to include, mood. Be specific about what the viewer sees."
}

Return ONLY the JSON object.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseResponse(msg.content[0].text);
}

// --- Response Parsing ---

function parseResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[Content] JSON parse failed. Raw response:');
    console.error(cleaned.slice(0, 300));
    throw new Error(`JSON parse failed: ${err.message}`);
  }
}

// --- Validation ---

function validatePost(post, platform) {
  if (!post.hook || post.hook.length < 10) {
    throw new Error(`${platform} post missing valid hook`);
  }
  if (!post.caption || post.caption.length < 20) {
    throw new Error(`${platform} post missing valid caption`);
  }
  if (!Array.isArray(post.hashtags) || post.hashtags.length < 3) {
    throw new Error(`${platform} post needs at least 3 hashtags`);
  }
  // Ensure hashtags have # prefix
  post.hashtags = post.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`));
  return post;
}

// --- Write to Supabase ---

async function writeContentQueue(items, briefingId) {
  const rows = items.map((item) => ({
    briefing_id: briefingId,
    platform: item.platform,
    content_type: item.content_type,
    status: 'draft',
    hook: item.hook,
    caption: item.caption,
    hashtags: item.hashtags,
    ai_magic_output: item.ai_magic_output || null,
    image_prompt: item.image_prompt || null,
    audio_suggestion: item.audio_suggestion || null,
  }));

  const { data, error } = await supabase
    .from('content_queue')
    .insert(rows)
    .select();

  if (error) {
    console.error('[Content] Failed to write content queue:', error);
    process.exit(1);
  }

  console.log(`[Content] ${rows.length} items written to content_queue`);
  return data;
}

// --- Main ---

async function main() {
  console.log('[Content Agent] Starting content generation...');
  const startTime = Date.now();

  const briefing = await getLatestBriefing();
  const opportunities = briefing.opportunities || [];

  if (opportunities.length === 0) {
    console.error('[Content] Briefing has no opportunities. Aborting.');
    process.exit(1);
  }

  const recentCaptions = await getRecentCaptions();
  console.log(`[Content] Recent captions to avoid: ${recentCaptions.length}`);

  const { tiktok: ttOpps, instagram: igOpp } = assignOpportunities(opportunities);

  const contentItems = [];

  // Generate 3 TikTok posts in parallel
  console.log(`[Content] Generating ${ttOpps.length} TikTok posts...`);
  const ttResults = await Promise.allSettled(
    ttOpps.map((opp) => generateTikTokPost(opp))
  );

  for (let i = 0; i < ttResults.length; i++) {
    if (ttResults[i].status === 'fulfilled') {
      try {
        const post = validatePost(ttResults[i].value, 'tiktok');
        contentItems.push({
          ...post,
          platform: 'tiktok',
          content_type: ttOpps[i].content_type,
        });
        console.log(`[Content] TikTok ${i + 1}: "${post.hook.slice(0, 60)}..."`);
      } catch (err) {
        console.warn(`[Content] TikTok ${i + 1} validation failed: ${err.message}`);
      }
    } else {
      console.warn(`[Content] TikTok ${i + 1} generation failed: ${ttResults[i].reason?.message}`);
    }
  }

  // Generate 1 Instagram post
  console.log('[Content] Generating 1 Instagram post...');
  try {
    const igRaw = await generateInstagramPost(igOpp);
    const igPost = validatePost(igRaw, 'instagram');
    contentItems.push({
      ...igPost,
      platform: 'instagram',
      content_type: igOpp.content_type,
    });
    console.log(`[Content] IG: "${igPost.hook.slice(0, 60)}..."`);
  } catch (err) {
    console.error(`[Content] Instagram generation failed: ${err.message}`);
  }

  if (contentItems.length === 0) {
    console.error('[Content] No content generated. Aborting.');
    process.exit(1);
  }

  // Write to Supabase
  const written = await writeContentQueue(contentItems, briefing.id);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Content Agent] Done in ${elapsed}s.`);
  console.log(`[Content Agent] ${contentItems.length} posts written to content_queue.`);

  // Print summary
  console.log('\n=== GENERATED CONTENT ===');
  for (const item of contentItems) {
    console.log(`\n[${item.platform.toUpperCase()}] [${item.content_type.toUpperCase()}]`);
    console.log(`  Hook: "${item.hook}"`);
    console.log(`  Caption: ${item.caption.slice(0, 120)}...`);
    console.log(`  Hashtags: ${item.hashtags.join(' ')}`);
    if (item.ai_magic_output) {
      console.log(`  Magic output: ${item.ai_magic_output.slice(0, 150)}...`);
    }
    if (item.image_prompt) {
      console.log(`  Image prompt: ${item.image_prompt.slice(0, 120)}...`);
    }
    if (item.audio_suggestion) {
      console.log(`  Audio: ${item.audio_suggestion}`);
    }
  }
}

main().catch((err) => {
  console.error('[Content Agent] Fatal error:', err);
  process.exit(1);
});
