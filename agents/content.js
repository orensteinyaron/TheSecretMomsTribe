/**
 * SMT Content Generation Agent
 *
 * Triggered after Research Agent completes (or manually).
 * Reads today's briefing → generates 3 autonomous content items:
 *   1. IG Carousel (5-7 slides) — wow content
 *   2. IG Static Image — trust/meme content
 *   3. TikTok Slideshow — text + images, no video
 *
 * Zero video production dependencies. All formats are
 * publishable with image generation + text only.
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

async function getRecentHooks() {
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
  const sorted = [...opportunities].sort((a, b) => a.priority - b.priority);

  // Best wow opportunity → carousel
  const carouselOpp = sorted.find((o) => o.content_type === 'wow') || sorted[0];

  // Best trust opportunity → static image
  const staticOpp = sorted.find((o) => o !== carouselOpp && o.content_type === 'trust')
    || sorted.find((o) => o !== carouselOpp) || sorted[1];

  // Next best → TikTok slideshow (wow or trust both work)
  const slideshowOpp = sorted.find((o) => o !== carouselOpp && o !== staticOpp) || sorted[2] || sorted[0];

  console.log(`[Content] Carousel: "${carouselOpp.topic}" (${carouselOpp.content_type})`);
  console.log(`[Content] Static:   "${staticOpp.topic}" (${staticOpp.content_type})`);
  console.log(`[Content] Slideshow:"${slideshowOpp.topic}" (${slideshowOpp.content_type})`);

  return { carousel: carouselOpp, static: staticOpp, slideshow: slideshowOpp };
}

// --- System Prompt ---

const SYSTEM_PROMPT = `You are the content writer for Secret Moms Tribe (SMT). You produce ready-to-post social media content for a parenting brand targeting moms of kids ages 1-16.

## Brand Voice
- Warm, knowing mom friend. Uses "we" and "us"
- Slight humor, never condescending
- She knows things other moms don't — that's the "secret"
- Empathetic but empowering — "you've got this"
- Conversational, not clinical. Never preachy.

## Content Philosophy
- Never show the process. Show the MAGIC — the output, not the tool
- Always lead with EMOTION, never with information
- Meme/relatable content outperforms educational 25:1
- Model B aesthetic: no faces shown, warm tones, cozy vibes

## KEY RULES
- Every hook must stop the scroll in 0-3 seconds
- "Wow" content shows the AI-generated OUTPUT (the story, the plan, the script)
- "Trust" content taps into shared mom experiences — viewer thinks "that's literally me"
- Instagram captions include keywords for discovery (not just hashtags)
- Each piece of content must have a clear emotional payoff

Return ONLY valid JSON. No markdown fences, no explanation.`;

// --- IG Carousel Generator (5-7 slides) ---

async function generateCarousel(opportunity) {
  const prompt = `Create an Instagram CAROUSEL post (5-7 slides) for this opportunity:

Topic: ${opportunity.topic}
Pillar: ${opportunity.pillar}
Content Type: ${opportunity.content_type}
Angle: ${opportunity.angle}
Suggested Hook: ${opportunity.suggested_hook}

This carousel shows AI-generated magic content slide by slide.
Slide 1 = hook. Slides 2-6 = the actual content. Final slide = CTA.

Return this EXACT JSON structure:
{
  "hook": "Bold text for slide 1 that stops the scroll. Short, punchy, emotional.",
  "caption": "Full Instagram caption. Start with hook, expand in 3-5 short paragraphs. Conversational, warm. Include keywords for IG search. End with subtle CTA. Use line breaks.",
  "hashtags": ["#momlife", "#parenting", "...8-10 total, mix niche + broad"],
  "ai_magic_output": "The FULL magic content structured for slides. Use --- as slide separators. Slide 1 is the hook (already in hook field — skip it here). Write slides 2 through 6-7, each with a clear heading and 1-3 sentences of genuinely useful content. Final slide should be a warm CTA. Minimum 200 words total across all slides.",
  "image_prompt": ["Slide 1: [detailed DALL-E prompt — branded background, warm earth tones, bold white text overlay with the hook, no faces, cozy aesthetic]", "Slide 2: [prompt for this slide's visual — warm tones, text overlay with slide content, Model B aesthetic]", "...one prompt per slide, matching the ai_magic_output slides"]
}

IMPORTANT: image_prompt must be a JSON array of strings, one per slide. Each prompt describes a warm, cozy image with text overlay matching that slide's content. Model B aesthetic: no faces, warm earth tones, soft pastels.

Return ONLY the JSON object.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseResponse(msg.content[0].text);
}

// --- IG Static Image Generator ---

async function generateStaticImage(opportunity) {
  const prompt = `Create an Instagram STATIC IMAGE post (single image with text) for this opportunity:

Topic: ${opportunity.topic}
Pillar: ${opportunity.pillar}
Content Type: ${opportunity.content_type}
Angle: ${opportunity.angle}
Suggested Hook: ${opportunity.suggested_hook}

This is a relatable meme or powerful quote graphic. Single image. Must be instantly shareable.

Return this EXACT JSON structure:
{
  "hook": "The main text displayed on the image. Must be punchy, relatable, and make a mom immediately tap 'share'. Max 2 sentences.",
  "caption": "Full Instagram caption. Expand on the image text with 2-4 short paragraphs. Conversational, warm. IG keywords for discovery. Subtle CTA (share with a mom who needs this). Line breaks for readability.",
  "hashtags": ["#momlife", "#parenting", "...8-10 total, mix niche + broad"],
  "ai_magic_output": null,
  "image_prompt": "Detailed DALL-E prompt for ONE image. Style: warm, cozy background (soft blurred kitchen, living room, or nature). Bold readable text overlay with the hook text. Colors: warm earth tones or soft pastels. No faces (Model B). The text should be the visual centerpiece — large, clean typography. Think: the kind of image a mom screenshots and sends to her group chat."
}

Return ONLY the JSON object.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseResponse(msg.content[0].text);
}

// --- TikTok Slideshow Generator ---

async function generateTikTokSlideshow(opportunity) {
  const prompt = `Create a TikTok PHOTO SLIDESHOW post (3-7 image slides with text) for this opportunity:

Topic: ${opportunity.topic}
Pillar: ${opportunity.pillar}
Content Type: ${opportunity.content_type}
Angle: ${opportunity.angle}
Suggested Hook: ${opportunity.suggested_hook}

This is TikTok's native photo slideshow format — images with text, NO video required.
Slide 1 = hook. Middle slides = content. Last slide = CTA.

Return this EXACT JSON structure:
{
  "hook": "Text overlay on slide 1. Must stop the scroll. Short, punchy, emotional. TikTok-native tone (raw, unfiltered, not polished).",
  "caption": "Short TikTok caption. 1-3 sentences max. Conversational. Subtle CTA (save this, share with a mom).",
  "hashtags": ["#momlife", "#parenting", "...3-5 total, highly relevant"],
  "ai_magic_output": ${opportunity.content_type === 'wow' ? '"The FULL magic content for the slideshow. Use --- as slide separators. Each slide gets a short punchy heading + 1-2 sentences. Content should be genuinely useful and complete. 5-7 slides total. Minimum 150 words."' : '"The relatable/meme content for slides. Use --- as slide separators. 3-5 slides. Each slide is a punchy observation or moment that builds on the theme. Think: story arc from relatable moment → emotional payoff."'},
  "image_prompt": ["Slide 1: [DALL-E prompt — bold text overlay with hook, warm aesthetic, no faces, TikTok vertical format 9:16]", "Slide 2: [prompt matching slide content]", "...one per slide"],
  "audio_suggestion": "Trending TikTok sound suggestion OR 'Original audio — [style description]'. Pick what fits the content mood."
}

IMPORTANT: image_prompt must be a JSON array, one per slide. TikTok vertical 9:16 format. Model B: no faces, warm tones.

Return ONLY the JSON object.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
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
    console.error(cleaned.slice(0, 500));
    throw new Error(`JSON parse failed: ${err.message}`);
  }
}

// --- Validation ---

function validatePost(post, format) {
  if (!post.hook || post.hook.length < 10) {
    throw new Error(`${format} post missing valid hook`);
  }
  if (!post.caption || post.caption.length < 20) {
    throw new Error(`${format} post missing valid caption`);
  }
  if (!Array.isArray(post.hashtags) || post.hashtags.length < 3) {
    throw new Error(`${format} post needs at least 3 hashtags`);
  }
  post.hashtags = post.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`));

  // Normalize image_prompt to string for Supabase (text column)
  if (Array.isArray(post.image_prompt)) {
    post.image_prompt = JSON.stringify(post.image_prompt);
  }

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
  console.log('[Content Agent] Formats: IG Carousel + IG Static + TT Slideshow');
  const startTime = Date.now();

  const briefing = await getLatestBriefing();
  const opportunities = briefing.opportunities || [];

  if (opportunities.length === 0) {
    console.error('[Content] Briefing has no opportunities. Aborting.');
    process.exit(1);
  }

  const recentHooks = await getRecentHooks();
  console.log(`[Content] Recent hooks to avoid: ${recentHooks.length}`);

  const { carousel: carouselOpp, static: staticOpp, slideshow: slideshowOpp } = assignOpportunities(opportunities);

  // Generate all 3 formats in parallel
  console.log('[Content] Generating all 3 content items in parallel...');
  const [carouselResult, staticResult, slideshowResult] = await Promise.allSettled([
    generateCarousel(carouselOpp),
    generateStaticImage(staticOpp),
    generateTikTokSlideshow(slideshowOpp),
  ]);

  const contentItems = [];

  // Process carousel
  if (carouselResult.status === 'fulfilled') {
    try {
      const post = validatePost(carouselResult.value, 'ig_carousel');
      contentItems.push({
        ...post,
        platform: 'instagram',
        content_type: carouselOpp.content_type,
      });
      console.log(`[Content] IG Carousel: "${post.hook.slice(0, 60)}..."`);
    } catch (err) {
      console.error(`[Content] IG Carousel validation failed: ${err.message}`);
    }
  } else {
    console.error(`[Content] IG Carousel generation failed: ${carouselResult.reason?.message}`);
  }

  // Process static
  if (staticResult.status === 'fulfilled') {
    try {
      const post = validatePost(staticResult.value, 'ig_static');
      contentItems.push({
        ...post,
        platform: 'instagram',
        content_type: staticOpp.content_type,
      });
      console.log(`[Content] IG Static: "${post.hook.slice(0, 60)}..."`);
    } catch (err) {
      console.error(`[Content] IG Static validation failed: ${err.message}`);
    }
  } else {
    console.error(`[Content] IG Static generation failed: ${staticResult.reason?.message}`);
  }

  // Process slideshow
  if (slideshowResult.status === 'fulfilled') {
    try {
      const post = validatePost(slideshowResult.value, 'tt_slideshow');
      contentItems.push({
        ...post,
        platform: 'tiktok',
        content_type: slideshowOpp.content_type,
      });
      console.log(`[Content] TT Slideshow: "${post.hook.slice(0, 60)}..."`);
    } catch (err) {
      console.error(`[Content] TT Slideshow validation failed: ${err.message}`);
    }
  } else {
    console.error(`[Content] TT Slideshow generation failed: ${slideshowResult.reason?.message}`);
  }

  if (contentItems.length === 0) {
    console.error('[Content] No content generated. Aborting.');
    process.exit(1);
  }

  // Write to Supabase
  await writeContentQueue(contentItems, briefing.id);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Content Agent] Done in ${elapsed}s.`);
  console.log(`[Content Agent] ${contentItems.length} posts written to content_queue.`);

  // Print summary
  console.log('\n=== GENERATED CONTENT ===');
  for (const item of contentItems) {
    const format = item.platform === 'tiktok' ? 'TT SLIDESHOW' : (item.ai_magic_output ? 'IG CAROUSEL' : 'IG STATIC');
    console.log(`\n[${format}] [${item.content_type.toUpperCase()}]`);
    console.log(`  Hook: "${item.hook}"`);
    console.log(`  Caption: ${item.caption.slice(0, 120)}...`);
    console.log(`  Hashtags: ${item.hashtags.join(' ')}`);
    if (item.ai_magic_output) {
      const slideCount = (item.ai_magic_output.match(/---/g) || []).length + 1;
      console.log(`  Magic output: ${slideCount} slides, ${item.ai_magic_output.length} chars`);
    }
    if (item.image_prompt) {
      const promptStr = typeof item.image_prompt === 'string' ? item.image_prompt : JSON.stringify(item.image_prompt);
      const isArray = promptStr.startsWith('[');
      console.log(`  Image prompts: ${isArray ? 'per-slide array' : 'single image'} (${promptStr.length} chars)`);
    }
    if (item.audio_suggestion) {
      console.log(`  Audio: ${item.audio_suggestion.slice(0, 80)}`);
    }
  }
}

main().catch((err) => {
  console.error('[Content Agent] Fatal error:', err);
  process.exit(1);
});
