/**
 * SMT Content Generation Agent
 *
 * Reads today's briefing + 3 brand DNA docs → generates a batch
 * of 4 posts with full metadata (age_range, content_pillar, post_format).
 *
 * Daily batch:
 *   1. TikTok slideshow
 *   2. TikTok text-on-screen OR slideshow
 *   3. IG carousel (5-7 slides)
 *   4. IG static OR meme
 *
 * Zero video dependencies. All formats publishable with images + text.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/content.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logCost, printCostSummary } from '../scripts/utils/cost-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --- Load DNA docs ---

function loadDNA() {
  const promptsDir = resolve(__dirname, '../prompts');
  const brandVoice = readFileSync(resolve(promptsDir, 'brand-voice.md'), 'utf-8');
  const contentDNA = readFileSync(resolve(promptsDir, 'content-dna.md'), 'utf-8');
  const visualDesign = readFileSync(resolve(promptsDir, 'visual-design.md'), 'utf-8');
  console.log(`[Content] Loaded DNA docs: brand-voice (${brandVoice.length}), content-dna (${contentDNA.length}), visual-design (${visualDesign.length})`);
  return { brandVoice, contentDNA, visualDesign };
}

// --- Briefing ---

async function getLatestBriefing() {
  const today = new Date().toISOString().split('T')[0];

  let { data } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('briefing_date', today)
    .single();

  if (!data) {
    console.warn(`[Content] No briefing for ${today}, fetching most recent...`);
    ({ data } = await supabase
      .from('daily_briefings')
      .select('*')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .single());
  }

  if (!data) {
    console.error('[Content] No briefing found.');
    process.exit(1);
  }

  console.log(`[Content] Using briefing from ${data.briefing_date} (${data.opportunities?.length || 0} opportunities)`);
  return data;
}

// --- Coverage gap analysis ---

async function getCoverageGaps() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data } = await supabase
      .from('content_queue')
      .select('age_range, content_pillar, content_type, platform')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!data || data.length === 0) return { covered: [], gaps: 'No content in last 7 days — all cells are open.' };

    const covered = data.map((r) => `${r.age_range}×${r.content_pillar}`);
    const coveredSet = new Set(covered);

    const ageRanges = ['toddler', 'little_kid', 'school_age', 'teen'];
    const pillars = ['ai_magic', 'parenting_insights', 'tech_for_moms', 'mom_health', 'trending'];
    const uncovered = [];

    for (const age of ageRanges) {
      for (const pillar of pillars) {
        if (!coveredSet.has(`${age}×${pillar}`)) {
          uncovered.push(`${age}×${pillar}`);
        }
      }
    }

    console.log(`[Content] Coverage: ${coveredSet.size} cells covered, ${uncovered.length} gaps`);
    return {
      covered: [...coveredSet],
      gaps: uncovered.length > 0
        ? `Uncovered cells to prioritize: ${uncovered.slice(0, 10).join(', ')}`
        : 'Good coverage across all cells.',
    };
  } catch {
    return { covered: [], gaps: 'Unable to fetch coverage data.' };
  }
}

// --- Recent hooks for dedup ---

async function getRecentHooks() {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const { data } = await supabase
      .from('content_queue')
      .select('hook')
      .gte('created_at', fourteenDaysAgo.toISOString());
    return (data || []).map((r) => r.hook).filter(Boolean);
  } catch {
    return [];
  }
}

// --- Build system prompt from DNA ---

function buildSystemPrompt(dna) {
  return `You are the content generation engine for Secret Moms Tribe (SMT).

THE FOLLOWING BRAND DOCUMENTS ARE THE LAW. Follow them exactly.

=== BRAND VOICE BIBLE ===
${dna.brandVoice}

=== CONTENT DNA FRAMEWORK ===
${dna.contentDNA}

=== VISUAL DESIGN GUIDE ===
${dna.visualDesign}

CRITICAL RULES:
- Before outputting any post, apply The SMT Test: "Would the friend in the group chat say this?"
- If it sounds like a blog, textbook, or generic momfluencer → rewrite.
- If it sounds like a text message you'd screenshot and forward → ship it.
- Return ONLY valid JSON. No markdown fences, no explanation.`;
}

// --- Generate batch ---

async function generateBatch(briefing, dna, coverageGaps, recentHooks) {
  const systemPrompt = buildSystemPrompt(dna);

  const numOpps = briefing.opportunities.length;

  const userPrompt = `Generate a post for EVERY good opportunity below. Be GREEDY — stockpile everything good. AI Magic and Tech posts are rare, always generate them.

## Today's Briefing Opportunities (${numOpps} total)
${JSON.stringify(briefing.opportunities, null, 2)}

## Coverage Gaps (last 7 days — for reference, NOT a constraint)
${coverageGaps.gaps}

## Recent Hooks to AVOID (do not duplicate)
${recentHooks.slice(0, 20).map((h) => `- "${h}"`).join('\n') || 'None yet.'}

## For Each Opportunity, Generate One Post

Pick the best post_format for each opportunity:
- TikTok slideshow (tiktok_slideshow) — best for step-by-step, lists, swaps
- TikTok text-on-screen (tiktok_text) — best for single powerful statements
- IG carousel (ig_carousel) — best for 5-7 slide deep dives
- IG static (ig_static) — best for single powerful quotes/statements
- IG meme (ig_meme) — best for relatable humor

## QUALITY RULES (these still apply to EVERY post)
- Follow ALL voice rules from Brand Voice Bible
- Use hook formulas from Content DNA Framework
- Follow caption structure per platform (TikTok: 2-3 lines max 40 words, IG: 100-180 words)
- Hashtags: 5-8 per post, NEVER use #momlife or #parenting (mega-tags)
- Emoji: only 👀 🤍 💛, max 1-2 per caption
- No duplicate topics within this batch
- Apply The SMT Test to every hook

## IMPORTANT: Every post MUST include image_prompt and slides

### image_prompt (REQUIRED for ALL posts)
A single DALL-E prompt for the hero/cover image. Describe:
- Camera angle (close-up, over-shoulder, overhead, etc)
- Subject (hands, back of head, child's feet — NO FACES EVER)
- Action/gesture being performed
- Environment (kitchen, living room, park, bedroom)
- Lighting: warm/golden hour always
- Colors: warm amber, soft cream, dusty blush, muted sage
- Mood: tender, real, quiet, editorial-warm
- Style: editorial photography, not stock, not AI-looking

### slides (REQUIRED for slideshow and carousel posts)
JSON array of slide objects. Each slide:
{
  "slide_number": 1,
  "text": "The text shown on this slide",
  "type": "hook" | "content" | "cta",
  "image_prompt": "DALL-E prompt for this specific slide's background, or null for text-on-color slides"
}
Only the hook slide and CTA slide typically need image_prompts. Content slides use brand color backgrounds.

## Output: JSON array of objects (one per opportunity)

Each object:
{
  "platform": "tiktok" | "instagram",
  "post_format": "tiktok_slideshow" | "tiktok_text" | "ig_carousel" | "ig_static" | "ig_meme",
  "content_type": "wow" | "trust" | "cta",
  "content_pillar": "ai_magic" | "parenting_insights" | "tech_for_moms" | "mom_health" | "trending",
  "age_range": "toddler" | "little_kid" | "school_age" | "teen" | "universal",
  "hook": "First thing viewer sees. Stops scroll in 0-2 seconds.",
  "caption": "Full caption following platform rules.",
  "hashtags": ["5-8 hashtags"],
  "ai_magic_output": "For wow: FULL magic content, min 200 words. Show input AND output for AI Magic. null for trust/cta.",
  "image_prompt": "REQUIRED. Single DALL-E prompt for hero/cover image. NO FACES.",
  "slides": [{"slide_number": 1, "text": "...", "type": "hook", "image_prompt": "...or null"}],
  "audio_suggestion": "TikTok only. null for IG."
}

Return ONLY the JSON array. No explanation.`;

  console.log(`[Content] Calling Claude (${CLAUDE_MODEL})...`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Log generation cost
  const genCost = await logCost(supabase, {
    pipeline_stage: 'content_generation', service: 'anthropic', model: CLAUDE_MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    briefing_id: briefing.id,
    description: `Content batch generation (${numOpps} opportunities)`,
  });

  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const posts = JSON.parse(text);
    return { posts, usage: msg.usage };
  } catch (err) {
    console.error('[Content] JSON parse failed. Raw:');
    console.error(text.slice(0, 500));
    throw new Error(`JSON parse failed: ${err.message}`);
  }
}

// --- Validation ---

const VALID_AGE_RANGES = ['toddler', 'little_kid', 'school_age', 'teen', 'universal'];
const VALID_PILLARS = ['ai_magic', 'parenting_insights', 'tech_for_moms', 'mom_health', 'trending'];
const VALID_POST_FORMATS = ['tiktok_slideshow', 'tiktok_text', 'ig_carousel', 'ig_static', 'ig_meme', 'video_script'];
const VALID_CONTENT_TYPES = ['wow', 'trust', 'cta'];

function validateBatch(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error(`Expected 1+ posts, got ${Array.isArray(posts) ? posts.length : typeof posts}`);
  }

  const valid = [];

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const prefix = `Post ${i + 1}`;

    // Hard quality gates per post — skip invalid ones instead of failing entire batch
    try {
      if (!p.hook || p.hook.length < 10) throw new Error('missing/short hook');
      if (!p.caption || p.caption.length < 20) throw new Error('missing/short caption');
      if (!Array.isArray(p.hashtags) || p.hashtags.length < 3) throw new Error('needs 3+ hashtags');
      if (!VALID_POST_FORMATS.includes(p.post_format)) throw new Error(`invalid post_format "${p.post_format}"`);
      if (!VALID_AGE_RANGES.includes(p.age_range)) throw new Error(`invalid age_range "${p.age_range}"`);
      if (!VALID_PILLARS.includes(p.content_pillar)) throw new Error(`invalid content_pillar "${p.content_pillar}"`);
      if (!VALID_CONTENT_TYPES.includes(p.content_type)) throw new Error(`invalid content_type "${p.content_type}"`);
    } catch (err) {
      console.warn(`[Content] ${prefix} skipped: ${err.message}`);
      continue;
    }

    // Enforce platform from post_format
    p.platform = p.post_format.startsWith('tiktok') ? 'tiktok' : 'instagram';

    // Normalize hashtags
    p.hashtags = p.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`));

    // Normalize image_prompt to string if array
    if (Array.isArray(p.image_prompt)) {
      p.image_prompt = JSON.stringify(p.image_prompt);
    }

    // Ensure slides is array or null
    if (p.slides && !Array.isArray(p.slides)) {
      p.slides = null;
    }

    valid.push(p);
  }

  if (valid.length === 0) {
    throw new Error('No valid posts in batch after validation');
  }

  // Log batch composition (informational, not constraints)
  const ageRanges = new Set(valid.map((p) => p.age_range));
  const pillars = new Set(valid.map((p) => p.content_pillar));
  console.log(`[Content] Batch: ${valid.length} posts validated`);
  console.log(`[Content] Age ranges: ${[...ageRanges].join(', ')}`);
  console.log(`[Content] Pillars: ${[...pillars].join(', ')}`);
  console.log(`[Content] Formats: ${valid.map((p) => p.post_format).join(', ')}`);

  return valid;
}

// --- Write to Supabase ---

async function writeContentQueue(posts, briefingId) {
  const rows = posts.map((p) => ({
    briefing_id: briefingId,
    platform: p.platform,
    content_type: p.content_type,
    status: 'draft',
    hook: p.hook,
    caption: p.caption,
    hashtags: p.hashtags,
    ai_magic_output: p.ai_magic_output || null,
    image_prompt: p.image_prompt || null,
    audio_suggestion: p.audio_suggestion || null,
    age_range: p.age_range,
    content_pillar: p.content_pillar,
    post_format: p.post_format,
    slides: p.slides || [],
    image_status: 'pending',
    launch_bank: false,
    quality_rating: null,
  }));

  const { error } = await supabase.from('content_queue').insert(rows);

  if (error) {
    console.error('[Content] Failed to write content queue:', error);
    process.exit(1);
  }

  console.log(`[Content] ${rows.length} posts written to content_queue`);
}

// --- Main ---

async function main() {
  console.log('[Content Agent] Starting content generation...');
  console.log('[Content Agent] Greedy mode: generating for ALL good opportunities');
  const startTime = Date.now();

  // Load DNA docs
  const dna = loadDNA();

  // Get briefing
  const briefing = await getLatestBriefing();
  if (!briefing.opportunities?.length) {
    console.error('[Content] Briefing has no opportunities. Aborting.');
    process.exit(1);
  }

  // Coverage analysis
  const coverageGaps = await getCoverageGaps();

  // Dedup
  const recentHooks = await getRecentHooks();
  console.log(`[Content] Recent hooks to avoid: ${recentHooks.length}`);

  // Generate batch via Claude
  const { posts: rawPosts, usage } = await generateBatch(briefing, dna, coverageGaps, recentHooks);

  // Validate
  const posts = validateBatch(rawPosts);

  // Write to Supabase
  await writeContentQueue(posts, briefing.id);

  // Log per-post cost share (split generation cost evenly)
  if (usage && posts.length > 0) {
    // Fetch the inserted post IDs
    const { data: inserted } = await supabase
      .from('content_queue')
      .select('id')
      .eq('briefing_id', briefing.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(posts.length);

    if (inserted) {
      for (const row of inserted) {
        await logCost(supabase, {
          pipeline_stage: 'content_generation', service: 'anthropic', model: CLAUDE_MODEL,
          input_tokens: Math.round(usage.input_tokens / posts.length),
          output_tokens: Math.round(usage.output_tokens / posts.length),
          content_id: row.id,
          briefing_id: briefing.id,
          description: `Content generation share (1/${posts.length} of batch)`,
        });
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Content Agent] Done in ${elapsed}s.`);
  console.log(`[Content Agent] ${posts.length} posts written to content_queue.`);

  // Summary
  console.log('\n=== GENERATED BATCH ===');
  for (const p of posts) {
    console.log(`\n[${p.post_format}] [${p.content_type}] [${p.content_pillar}] [${p.age_range}]`);
    console.log(`  Hook: "${p.hook}"`);
    console.log(`  Caption: ${p.caption.slice(0, 100)}...`);
    console.log(`  Hashtags: ${p.hashtags.join(' ')}`);
    if (p.ai_magic_output) {
      const slides = (p.ai_magic_output.match(/---/g) || []).length + 1;
      console.log(`  Magic: ${slides} sections, ${p.ai_magic_output.length} chars`);
    }
  }

  await printCostSummary(supabase);
}

main().catch((err) => {
  console.error('[Content Agent] Fatal error:', err);
  process.exit(1);
});
