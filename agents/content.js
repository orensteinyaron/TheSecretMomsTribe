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
import { logActivity } from './lib/activity.js';
import {
  AXES,
  pickRachelMode,
  readAxes,
  normalizeAxisValue,
  auditBatchDiversity,
  suggestUntakenAxes,
  enforceBatchDiversity as sharedEnforceBatchDiversity,
  buildImagePromptGuidelines,
} from './lib/image-diversity.js';
import {
  CAPTION_MAX_BY_FORMAT,
  MIN_CAROUSEL_SLIDES,
  classifyDensity,
  validateFormat,
} from './lib/format-selector.js';
import { validateSocialUrl } from './lib/url-validator.js';
import { buildUserPrompt } from './lib/content-prompt.js';
import { generateBatch as generateBatchLib } from './lib/content-generate.js';
import { buildContentQueueRow } from './lib/content-queue-row.js';
import { VALID_PILLARS, normalizePillar } from './lib/pillars.js';

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

// --- Strategy awareness ---

async function fetchActiveDirectives() {
  try {
    const { data } = await supabase
      .from('system_directives')
      .select('directive, directive_type, parameters')
      .eq('status', 'active')
      .or('target_agent.is.null,target_agent.eq.content-text-gen');
    return data || [];
  } catch (err) {
    console.warn(`[Content] Failed to fetch directives (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchConfirmedInsights() {
  try {
    const { data } = await supabase
      .from('strategy_insights')
      .select('insight_type, insight, confidence')
      .in('status', ['confirmed', 'applied'])
      .order('confidence', { ascending: false })
      .limit(15);
    return data || [];
  } catch (err) {
    console.warn(`[Content] Failed to fetch insights (non-fatal): ${err.message}`);
    return [];
  }
}

async function fetchRenderProfileMap() {
  try {
    const { data } = await supabase
      .from('render_profiles')
      .select('id, slug, name, profile_type, status');
    if (!data) return {};
    const map = {};
    for (const rp of data) map[rp.slug] = rp;
    return map;
  } catch (err) {
    console.warn(`[Content] Failed to fetch render profiles (non-fatal): ${err.message}`);
    return {};
  }
}

// Fallback: map post_format to render profile slug
const FORMAT_TO_PROFILE = {
  tiktok_slideshow: 'moving-images',
  tiktok_text: 'static-image',
  ig_carousel: 'carousel',
  ig_static: 'static-image',
  ig_meme: 'static-image',
  video_script: 'moving-images',
  tiktok_avatar: 'avatar-v1',
  tiktok_avatar_visual: 'avatar-v1',
};

const AVATAR_LOOKS = [
  'cozy_cream_sweater', 'casual_white_tee', 'soft_grey_hoodie',
  'denim_jacket', 'olive_cardigan', 'black_turtleneck',
  'navy_blouse', 'rust_linen_top', 'striped_breton',
  'dusty_rose_knit', 'chambray_shirt', 'sage_pullover', 'cream_blazer',
];

const AVATAR_BACKGROUNDS = [
  'warm_kitchen_01', 'living_room_plants_01', 'home_office_01',
  'bedroom_neutral_01', 'patio_garden_01',
];

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
    // Coverage is only meaningful for the LLM-emitted pillars, not
    // the full DB set. financial/uncategorized exist in the schema
    // but aren't part of the mom-audience rotation.
    const pillars = ['ai_magic', 'parenting', 'tech', 'health', 'trending'];
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

## AVATAR VIDEO FORMAT (tiktok_avatar / tiktok_avatar_visual)

When post_format is "tiktok_avatar" or "tiktok_avatar_visual", you MUST generate an "avatar_config" field in the post JSON.

CHARACTER: Marry, 36, mom of three (14, 9, 4). She's the friend in your group chat who always finds things out first. She's NOT a teacher. She gets frustrated, emotional, excited. She is NOT happy all the time.

SCRIPT RULES:
- Write as NATURAL SPEECH, not a script. Include "okay wait", "I mean", pauses with dashes
- First sentence is the hook — stop the scroll
- Emotional range: vary tone. Mark tone shifts with dashes and ellipses
- Max 80 words for 30s target, 150 words for 60s target
- Contractions ALWAYS. "It's" not "It is"
- End with CLIFFHANGER that drives follows, not generic CTA
- NEVER: "you guys", "so basically", "like and subscribe", anything YouTuber-coded

FORMAT RULES:
- tiktok_avatar: Full avatar only. 3-5 clips, all type "avatar". Best for: hot takes, personal stories, emotional topics.
- tiktok_avatar_visual: Avatar + visuals. 3-6 clips mixing "avatar", "split", "broll". Best for: product reveals, comparisons, explainers.

AVATAR_CONFIG SCHEMA:
{
  "format": "full_avatar" | "avatar_visual",
  "avatar_look": "(pick one)",
  "avatar_background": "(pick one)",
  "voice_id": "9JqF6OmJtGjHTDODKG2c",
  "duration_target": 30,
  "clips": [
    {"type": "avatar", "script": "spoken text", "purpose": "hook", "duration_estimate": 5},
    {"type": "avatar", "script": "spoken text", "purpose": "body", "duration_estimate": 12},
    {"type": "split", "script": "spoken text", "visual_query": "pexels query", "visual_type": "pexels_image", "purpose": "visual_proof", "duration_estimate": 5},
    {"type": "broll", "visual_query": "pexels query", "visual_type": "pexels_video", "purpose": "emotional_beat", "duration_estimate": 3},
    {"type": "avatar", "script": "spoken text", "purpose": "cta", "duration_estimate": 8}
  ]
}

CLIP RULES:
- First clip MUST be type "avatar" with purpose "hook"
- Last clip MUST be type "avatar" with purpose "cta"
- For tiktok_avatar: ALL clips are type "avatar"
- For tiktok_avatar_visual: Mix avatar, split, broll. Max 4 visual inserts.
- Broll clips have NO script (visual-only, 2-4 seconds)
- NEVER use visual_query for AI-generated fake products

VISUAL QUERY SAFETY:
- NEVER: crying, meltdown, tantrum, distress, screaming
- NEVER: medical terms, studio photos, direct-to-camera faces
- NEVER: seasonal/holiday content
- ALWAYS: warm natural light, candid, specific objects/gestures
- PREFER MOMS: 70%+ parent images should be mothers

CRITICAL RULES:
- Before outputting any post, apply The SMT Test: "Would the friend in the group chat say this?"
- If it sounds like a blog, textbook, or generic momfluencer → rewrite.
- If it sounds like a text message you'd screenshot and forward → ship it.

CRITICAL: Return ONLY valid JSON. No em dashes (\u2014), no special unicode. Use plain hyphens (-) only. Ensure all strings are properly escaped.
- Return ONLY valid JSON. No markdown fences, no explanation.`;
}

// --- Generate batch ---

async function generateBatch(briefing, dna, coverageGaps, recentHooks, directives, insights) {
  const systemPrompt = buildSystemPrompt(dna);
  const userPrompt = buildUserPrompt({ briefing, coverageGaps, recentHooks, directives, insights });
  return generateBatchLib(
    { briefing, systemPrompt, userPrompt },
    { client: anthropic, log: logCost, db: supabase },
  );
}

// --- Validation ---

const VALID_AGE_RANGES = ['toddler', 'little_kid', 'school_age', 'teen', 'universal'];
const VALID_POST_FORMATS = ['tiktok_slideshow', 'tiktok_text', 'ig_carousel', 'ig_static', 'ig_meme', 'video_script', 'tiktok_avatar', 'tiktok_avatar_visual'];
const VALID_CONTENT_TYPES = ['wow', 'trust', 'cta'];

// Hashtag fallbacks keyed by V1.1 canonical pillar. If the LLM leaks
// a legacy long name we normalizePillar it before this lookup.
const HASHTAG_FALLBACK_BY_PILLAR = {
  parenting: { toddler: ['#momlife', '#toddlermom', '#parentingtips', '#momhacks', '#toddlerlife'], little_kid: ['#momlife', '#littlekidmom', '#parentingtips', '#momhacks', '#kidslife'], school_age: ['#momlife', '#schoolkidmom', '#parentingtips', '#momhacks', '#raisingkids'], teen: ['#momlife', '#teenmom', '#parentingtips', '#momhacks', '#raisingteens'], universal: ['#momlife', '#parentingtips', '#momhacks', '#raisingkids', '#motherhood'] },
  ai_magic: { toddler: ['#aimom', '#aitools', '#toddlermom', '#momtech', '#aiforparents'], little_kid: ['#aimom', '#aitools', '#momtech', '#aiforparents', '#smartmom'], school_age: ['#aimom', '#aitools', '#momtech', '#aiforparents', '#smartmom'], teen: ['#aimom', '#aitools', '#momtech', '#aiforparents', '#smartmom'], universal: ['#aimom', '#aitools', '#momtech', '#aiforparents', '#smartmom'] },
  tech: { toddler: ['#momtech', '#techformoms', '#toddlermom', '#smartparenting', '#momlife'], little_kid: ['#momtech', '#techformoms', '#smartparenting', '#momlife', '#kidstech'], school_age: ['#momtech', '#techformoms', '#smartparenting', '#momlife', '#kidstech'], teen: ['#momtech', '#techformoms', '#smartparenting', '#momlife', '#teentech'], universal: ['#momtech', '#techformoms', '#smartparenting', '#momlife', '#motherhood'] },
  health: { toddler: ['#momhealth', '#selfcare', '#toddlermom', '#momwellness', '#healthymom'], little_kid: ['#momhealth', '#selfcare', '#momwellness', '#healthymom', '#momlife'], school_age: ['#momhealth', '#selfcare', '#momwellness', '#healthymom', '#momlife'], teen: ['#momhealth', '#selfcare', '#momwellness', '#healthymom', '#momlife'], universal: ['#momhealth', '#selfcare', '#momwellness', '#healthymom', '#motherhood'] },
  trending: { toddler: ['#momlife', '#trending', '#toddlermom', '#momhacks', '#viral'], little_kid: ['#momlife', '#trending', '#momhacks', '#viral', '#kidslife'], school_age: ['#momlife', '#trending', '#momhacks', '#viral', '#raisingkids'], teen: ['#momlife', '#trending', '#momhacks', '#viral', '#raisingteens'], universal: ['#momlife', '#trending', '#momhacks', '#viral', '#motherhood'] },
  financial: { toddler: ['#momlife', '#momsavings', '#parentingtips', '#momhacks', '#momfinance'], little_kid: ['#momlife', '#momsavings', '#parentingtips', '#momhacks', '#momfinance'], school_age: ['#momlife', '#momsavings', '#parentingtips', '#momhacks', '#momfinance'], teen: ['#momlife', '#momsavings', '#parentingtips', '#momhacks', '#momfinance'], universal: ['#momlife', '#momsavings', '#parentingtips', '#momhacks', '#motherhood'] },
  uncategorized: { toddler: ['#momlife', '#parentingtips', '#momhacks', '#toddlermom', '#motherhood'], little_kid: ['#momlife', '#parentingtips', '#momhacks', '#kidslife', '#motherhood'], school_age: ['#momlife', '#parentingtips', '#momhacks', '#raisingkids', '#motherhood'], teen: ['#momlife', '#parentingtips', '#momhacks', '#raisingteens', '#motherhood'], universal: ['#momlife', '#parentingtips', '#momhacks', '#raisingkids', '#motherhood'] },
};

async function validateBatch(posts) {
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

      // Normalize pillar FIRST so every downstream step (hashtag
      // fallback, validation, DB INSERT) sees V1.1 canonical values.
      // Emit a pillar_remapped_legacy activity log if the LLM leaked
      // a V1.0 long name so we can monitor and eventually remove the
      // safety net.
      const norm = normalizePillar(p.content_pillar);
      if (norm.remapped) {
        console.warn(`[Content] ${prefix}: pillar "${norm.legacy_value}" remapped to "${norm.pillar}"`);
        await logActivity({
          category: 'debug',
          actor_type: 'agent',
          actor_name: 'content-agent',
          action: 'pillar_remapped_legacy',
          description: `Pillar "${norm.legacy_value}" remapped to V1.1 "${norm.pillar}"`,
          metadata: {
            post_index: i,
            legacy_value: norm.legacy_value,
            canonical: norm.pillar,
            hook: p.hook?.slice(0, 120) || null,
          },
        });
      }
      p.content_pillar = norm.pillar;

      if (!Array.isArray(p.hashtags) || p.hashtags.length < 3) {
        const pillarFallback = HASHTAG_FALLBACK_BY_PILLAR[p.content_pillar] || HASHTAG_FALLBACK_BY_PILLAR.parenting;
        p.hashtags = pillarFallback[p.age_range] || pillarFallback.universal;
        console.warn(`[Content] ${prefix}: hashtags missing/insufficient, auto-generated defaults`);
      }
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

    // Avatar-specific validation
    if (p.post_format === 'tiktok_avatar' || p.post_format === 'tiktok_avatar_visual') {
      if (!p.avatar_config) {
        console.warn(`  [SKIP] Avatar post missing avatar_config`);
        continue;
      }
      const ac = p.avatar_config;

      if (p.post_format === 'tiktok_avatar' && ac.format !== 'full_avatar') {
        ac.format = 'full_avatar';
      }
      if (p.post_format === 'tiktok_avatar_visual' && ac.format !== 'avatar_visual') {
        ac.format = 'avatar_visual';
      }

      if (!Array.isArray(ac.clips) || ac.clips.length < 2) {
        console.warn(`  [SKIP] Avatar post has < 2 clips`);
        continue;
      }

      if (ac.clips[0].purpose !== 'hook') ac.clips[0].purpose = 'hook';
      if (ac.clips[ac.clips.length - 1].purpose !== 'cta') ac.clips[ac.clips.length - 1].purpose = 'cta';

      if (!ac.avatar_look) {
        ac.avatar_look = AVATAR_LOOKS[Math.floor(Math.random() * AVATAR_LOOKS.length)];
      }
      if (!ac.avatar_background) {
        ac.avatar_background = AVATAR_BACKGROUNDS[Math.floor(Math.random() * AVATAR_BACKGROUNDS.length)];
      }
      ac.voice_id = ac.voice_id || '9JqF6OmJtGjHTDODKG2c';

      if (ac.format === 'full_avatar') {
        for (const clip of ac.clips) {
          if (clip.type !== 'avatar') clip.type = 'avatar';
        }
      }
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

// --- Post-processing (axes normalization, format validation, diversity,
//     URL revalidation). Runs AFTER shape-validateBatch, BEFORE write.

/**
 * Convert the LLM-returned image_prompt — which we ask for as
 * { prompt, axes } — back into a plain string (for image_prompt column)
 * plus an axes object (for metadata.image_axes). Tolerates legacy string
 * output too.
 */
function normalizeImageFields(post) {
  const raw = post.image_prompt;
  let promptText = '';
  let axes = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    promptText = typeof raw.prompt === 'string' ? raw.prompt : '';
    axes = raw.axes && typeof raw.axes === 'object' ? raw.axes : {};
  } else if (typeof raw === 'string') {
    promptText = raw;
  } else if (Array.isArray(raw)) {
    promptText = JSON.stringify(raw);
  }

  // Normalize each axis to a canonical slug; default rachel_mode from format.
  const normalizedAxes = {};
  for (const axisName of Object.keys(AXES)) {
    const val = normalizeAxisValue(axes[axisName]);
    normalizedAxes[axisName] = val || null;
  }
  if (!normalizedAxes.rachel_mode) {
    normalizedAxes.rachel_mode = pickRachelMode(post.post_format);
  }

  post.image_prompt = promptText;
  post.image_axes = normalizedAxes;
  return post;
}

/**
 * Regenerate a single post's image_prompt + axes via Haiku, with the
 * target untaken shot_type+lighting pair supplied as a constraint.
 */
async function regenerateImagePrompt(post, targetAxes) {
  const promptBody = `You are a DALL-E art director for a parenting brand. The following post
needs a brand-new cover image prompt that strictly uses the given axes.

Post hook: ${JSON.stringify(post.hook)}
Post caption: ${JSON.stringify((post.caption || '').slice(0, 200))}
Post pillar: ${post.content_pillar}
Post format: ${post.post_format}

REQUIRED axes (override any previous choice):
  shot_type: ${targetAxes.shot_type}
  lighting:  ${targetAxes.lighting}
  rachel_mode: ${pickRachelMode(post.post_format)}

Return ONLY valid JSON, no code fences:
{
  "prompt": "Full DALL-E prompt. NO FACES EVER.",
  "axes": {
    "shot_type": "${targetAxes.shot_type}",
    "lighting": "${targetAxes.lighting}",
    "palette": one of ${JSON.stringify(AXES.palette)},
    "subject": one of ${JSON.stringify(AXES.subject)},
    "mood": one of ${JSON.stringify(AXES.mood)},
    "rachel_mode": "${pickRachelMode(post.post_format)}"
  }
}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: promptBody }],
    });
    let text = msg.content[0].text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
    }
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.prompt === 'string' && parsed.axes) {
      post.image_prompt = parsed.prompt;
      post.image_axes = {};
      for (const axisName of Object.keys(AXES)) {
        post.image_axes[axisName] = normalizeAxisValue(parsed.axes[axisName]) || null;
      }
      await logCost(supabase, {
        pipeline_stage: 'content_generation', service: 'anthropic', model: 'claude-haiku-4-5',
        input_tokens: msg.usage.input_tokens,
        output_tokens: msg.usage.output_tokens,
        description: 'Image prompt regen for diversity enforcement',
      });
      return true;
    }
  } catch (err) {
    console.warn(`[Content] Image regen failed: ${err.message}`);
  }
  return false;
}

/**
 * Enforce batch diversity via the shared helper. Haiku rewrites any
 * duplicate; last-resort fallback stamps untaken axes.
 */
async function enforceBatchDiversity(posts) {
  const result = await sharedEnforceBatchDiversity(posts, {
    regenerateFn: (post, target) => regenerateImagePrompt(post, target),
    logEvent: ({ index, key, target, regenerated }) =>
      logActivity({
        category: 'debug',
        actor_type: 'agent',
        actor_name: 'content-agent',
        action: 'image_diversity_regenerated',
        description: `Image duplicate shot+lighting — regenerated to ${target.shot_type}+${target.lighting}`,
        metadata: { index, key, target, regenerated },
      }),
  });

  if (result.violations > 0) {
    console.warn(`[Content] Image diversity: ${result.violations} duplicate(s) — ${result.regenerated} regenerated, ${result.forced} forced`);
  }
  const audit = auditBatchDiversity(posts);
  console.log(`[Content] Image diversity after regen: ${audit.violations.length} violations remain`);
  return { regenerated: result.regenerated, forced: result.forced };
}

/**
 * Run deterministic format gates. On failure, mark the post for review (no
 * silent ship) and attach diagnostic metadata.
 */
async function enforceFormatGates(posts) {
  let flagged = 0;
  for (const post of posts) {
    const errors = validateFormat(post);
    if (errors.length === 0) continue;

    flagged++;
    post.format_flags = errors;
    post.status_hint = 'draft_needs_review';

    await logActivity({
      category: 'debug',
      actor_type: 'agent',
      actor_name: 'content-agent',
      action: 'format_validation_failed',
      description: `Format check failed for ${post.post_format}: ${errors.join(', ')}`,
      metadata: {
        post_format: post.post_format,
        errors,
        caption_length: (post.caption || '').length,
        slide_count: Array.isArray(post.slides) ? post.slides.length : 0,
      },
    });
  }
  if (flagged > 0) {
    console.warn(`[Content] Format validation flagged ${flagged} post(s) as draft_needs_review`);
  }
  return { flagged };
}

/**
 * Resolve source signals for a post. Prefers explicit source_signal_ids
 * from the LLM; falls back to source_indices for backwards compat.
 *
 * @returns {Array<{url: string, signal_id: string|null, relation: string, source: string}>}
 */
function resolveSourceUrls(post, briefingOpps) {
  const signalMap = new Map();
  (briefingOpps || []).forEach((opp, idx) => {
    if (opp && opp.signal_id) signalMap.set(opp.signal_id, { opp, idx });
  });

  // Primary: source_signal_ids
  const signalIds = Array.isArray(post.source_signal_ids)
    ? post.source_signal_ids.filter((s) => typeof s === 'string' && s.length > 0)
    : [];

  const entries = [];
  const seenUrls = new Set();

  for (let i = 0; i < signalIds.length; i++) {
    const hit = signalMap.get(signalIds[i]);
    if (!hit) continue;
    const opp = hit.opp;
    const url = (opp.source_url || '').trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    entries.push({
      url,
      signal_id: opp.signal_id,
      relation: i === 0 ? 'primary_inspiration' : 'supporting_context',
      source: opp.source || 'unknown',
    });
  }

  // Fallback: source_indices (legacy)
  if (entries.length === 0 && Array.isArray(post.source_indices) && briefingOpps) {
    post.source_indices
      .filter((idx) => typeof idx === 'number' && briefingOpps[idx])
      .forEach((idx, i) => {
        const opp = briefingOpps[idx];
        const url = (opp.source_url || '').trim();
        if (!url || seenUrls.has(url)) return;
        seenUrls.add(url);
        entries.push({
          url,
          signal_id: opp.signal_id || null,
          relation: i === 0 ? 'primary_inspiration' : 'supporting_context',
          source: opp.source || 'unknown',
        });
      });
  }

  return entries;
}

/**
 * Revalidate every URL attached to posts right before writing. Any dead URL
 * is dropped from its post's source_urls and logged. If a post's only
 * primary_inspiration URL dies, the post is marked draft_needs_review.
 */
async function revalidatePostSourceUrls(posts) {
  let checked = 0;
  let dropped = 0;
  let staleBlocked = 0;

  for (const post of posts) {
    const urls = Array.isArray(post.source_urls) ? post.source_urls : [];
    if (urls.length === 0) continue;

    const keep = [];
    for (const entry of urls) {
      if (!entry || !entry.url) continue;
      checked++;
      const result = await validateSocialUrl(entry.url);
      if (result.valid) {
        keep.push(entry);
        continue;
      }
      dropped++;
      const reason = result.reason || result.error || 'unknown';
      console.warn(`[Content] Dropping stale source URL for ${post.post_format}: ${entry.url} (${reason})`);

      await logActivity({
        category: 'debug',
        actor_type: 'agent',
        actor_name: 'content-agent',
        action: 'url_validation_dropped_content',
        description: `Content-time URL validation failed: ${entry.url} — ${reason}`,
        metadata: {
          url: entry.url,
          reason,
          status: result.status ?? null,
          platform: result.platform ?? null,
          relation: entry.relation,
          signal_id: entry.signal_id,
        },
      });

      if (entry.relation === 'primary_inspiration') {
        staleBlocked++;
        post.status_hint = 'draft_needs_review';
        post.format_flags = [...(post.format_flags || []), 'primary_source_stale'];
      }
    }
    post.source_urls = keep;
  }

  console.log(`[Content] URL revalidation: ${checked} checked, ${dropped} dropped, ${staleBlocked} blocked draft`);
  return { checked, dropped, staleBlocked };
}

// --- Write to Supabase ---

async function writeContentQueue(posts, briefingId, renderProfileMap) {
  const rows = posts.map((p) => {
    const recommendedSlug = p._recommendedSlug || FORMAT_TO_PROFILE[p.post_format] || 'static-image';
    const profile = renderProfileMap[recommendedSlug];
    const renderProfileId = profile?.id || null;
    const density = classifyDensity(p);
    return buildContentQueueRow(p, { briefingId, renderProfileId, density });
  });

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

  // Fetch strategy context + coverage in parallel
  const [coverageGaps, recentHooks, directives, insights, renderProfileMap] = await Promise.all([
    getCoverageGaps(),
    getRecentHooks(),
    fetchActiveDirectives(),
    fetchConfirmedInsights(),
    fetchRenderProfileMap(),
  ]);
  console.log(`[Content] Recent hooks: ${recentHooks.length}, Directives: ${directives.length}, Insights: ${insights.length}, Render profiles: ${Object.keys(renderProfileMap).length}`);

  // Generate batch via Claude
  const { posts: rawPosts, usage } = await generateBatch(briefing, dna, coverageGaps, recentHooks, directives, insights);

  // Validate (shape)
  const posts = await validateBatch(rawPosts);

  // Post-process: normalize image fields, resolve source_urls, enforce
  // format + diversity gates, revalidate URLs. Each step logs its own
  // activity_log events so failures are visible in the debug stream.
  for (const p of posts) {
    normalizeImageFields(p);
    p.source_urls = resolveSourceUrls(p, briefing.opportunities);
    const opp = (briefing.opportunities || []).find((o) => o.signal_id === p.source_urls[0]?.signal_id);
    p._recommendedSlug = opp?.recommended_format || FORMAT_TO_PROFILE[p.post_format] || 'static-image';
  }

  await enforceFormatGates(posts);
  await enforceBatchDiversity(posts);
  await revalidatePostSourceUrls(posts);

  // Write to Supabase
  await writeContentQueue(posts, briefing.id, renderProfileMap);

  // Log per-post cost share (split generation cost evenly)
  if (usage && posts.length > 0) {
    // Fetch the inserted post IDs
    const { data: inserted } = await supabase
      .from('content_queue')
      .select('id')
      .eq('briefing_id', briefing.id)
      .in('status', ['draft', 'draft_needs_review'])
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
