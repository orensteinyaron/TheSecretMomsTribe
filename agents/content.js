/**
 * SMT Content Generation Agent
 *
 * Reads today's briefing + 3 brand DNA docs → generates a batch
 * of posts with full metadata (age_range, content_pillar,
 * render_profile_slug, channels).
 *
 * v2.0.0 (CHANNEL_MODEL_V1): emits `render_profile_slug` + `channels`
 * (not `post_format`). After inserting into `content_queue`, inserts
 * matching rows into `scheduled_posts` (one per channel) with
 * platform-native captions produced by a Haiku polish step.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... node agents/content.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { logCost, printCostSummary } from '../scripts/utils/cost-logger.js';
import { logActivity } from './lib/activity.js';
import { loadSkill } from './lib/skill_loader.js';
import { rejectLegacyFormatFields, validateContentQueueRow } from './lib/gate_validators.js';
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
  CAPTION_MAX_BY_SLUG,
  MIN_CAROUSEL_SLIDES,
  classifyDensity,
  validateRenderProfile,
} from './lib/format-selector.js';
import { validateSocialUrl } from './lib/url-validator.js';
import { buildUserPrompt } from './lib/content-prompt.js';
import { generateBatch as generateBatchLib } from './lib/content-generate.js';
import { buildContentQueueRow } from './lib/content-queue-row.js';
import { VALID_PILLARS, normalizePillar } from './lib/pillars.js';
import { enforceCaptionLengthWithRetry } from './lib/caption-retry.js';
import { logPromptExecution } from './lib/prompt_logger.js';
import {
  ALL_RENDER_PROFILE_SLUGS,
  RENDER_PROFILE_SLUGS,
  isValidRenderProfileSlug,
} from './lib/render-profiles.js';
import {
  ALL_CHANNELS,
  DEFAULT_CHANNELS,
  CHANNEL_STYLE,
  buildScheduledPostsRows,
  generateChannelCaptions,
  resolveTargetChannels,
} from './lib/channels.js';

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

// v2.0.0: the LLM emits render_profile_slug directly. No legacy fallback
// from post_format is needed; if the LLM omits the slug we throw in
// validateBatch.

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

// --- Output schema / avatar instructions ---
//
// The system prompt body (brand voice, content DNA, visual design, contract,
// SKILL) is loaded at runtime via loadSkill('smt_content_text_gen'). The
// in-code shim below is everything this script's JSON parser depends on:
// the avatar config schema and the strict JSON output contract.

const OUTPUT_SCHEMA_INSTRUCTIONS = `

## AVATAR VIDEO FORMAT (render_profile_slug = "avatar-v1")

When render_profile_slug is "avatar-v1", you MUST generate an "avatar_config" field in the post JSON. The avatar variant is carried by avatar_config.format ("full_avatar" or "avatar_visual").

Rachel is the friend in your group chat who always finds things out first. She's NOT a teacher. She gets frustrated, emotional, excited. She is NOT happy all the time.

SCRIPT RULES:
- Write as NATURAL SPEECH, not a script. Include "okay wait", "I mean", pauses with dashes
- First sentence is the hook — stop the scroll
- Emotional range: vary tone. Mark tone shifts with dashes and ellipses
- Max 80 words for 30s target, 150 words for 60s target
- Contractions ALWAYS. "It's" not "It is"
- End with CLIFFHANGER that drives follows, not generic CTA
- NEVER: "you guys", "so basically", "like and subscribe", anything YouTuber-coded

VARIANT RULES (avatar_config.format):
- "full_avatar": Full avatar only. 3-5 clips, all type "avatar". Best for: hot takes, personal stories, emotional topics.
- "avatar_visual": Avatar + visuals. 3-6 clips mixing "avatar", "split", "broll". Best for: product reveals, comparisons, explainers.

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
- For avatar_config.format = "full_avatar": ALL clips are type "avatar"
- For avatar_config.format = "avatar_visual": Mix avatar, split, broll. Max 4 visual inserts.
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

// --- Generate batch ---

async function generateBatch(briefing, skillSystemPrompt, coverageGaps, recentHooks, directives, insights) {
  const systemPrompt = skillSystemPrompt + OUTPUT_SCHEMA_INSTRUCTIONS;
  const userPrompt = buildUserPrompt({ briefing, coverageGaps, recentHooks, directives, insights });
  const result = await generateBatchLib(
    { briefing, systemPrompt, userPrompt },
    { client: anthropic, log: logCost, db: supabase },
  );
  // Return prompts alongside posts/usage so writeContentQueue can build
  // per-piece generation_context + prompt_executions rows (V2 §4.1).
  return { ...result, systemPrompt, userPrompt };
}

// --- Validation ---

const VALID_AGE_RANGES = ['toddler', 'little_kid', 'school_age', 'teen', 'universal'];
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
      // v2.0.0 fail-closed: any legacy field is a hard reject.
      const legacyCheck = rejectLegacyFormatFields(p);
      if (!legacyCheck.ok) throw new Error(legacyCheck.reason);

      if (!isValidRenderProfileSlug(p.render_profile_slug)) {
        throw new Error(`invalid render_profile_slug "${p.render_profile_slug}" (must be one of ${ALL_RENDER_PROFILE_SLUGS.join(', ')})`);
      }
      if (!VALID_AGE_RANGES.includes(p.age_range)) throw new Error(`invalid age_range "${p.age_range}"`);
      if (!VALID_PILLARS.includes(p.content_pillar)) throw new Error(`invalid content_pillar "${p.content_pillar}"`);
      if (!VALID_CONTENT_TYPES.includes(p.content_type)) throw new Error(`invalid content_type "${p.content_type}"`);

      // Default channels to [tiktok, instagram] when LLM omits or sends garbage.
      const llmChannels = Array.isArray(p.channels)
        ? p.channels.filter((c) => ALL_CHANNELS.includes(c))
        : [];
      p.channels = llmChannels.length > 0 ? [...new Set(llmChannels)] : [...DEFAULT_CHANNELS];
    } catch (err) {
      console.warn(`[Content] ${prefix} skipped: ${err.message}`);
      continue;
    }

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

    // Avatar-specific validation (render_profile_slug = 'avatar-v1').
    // The variant ('full_avatar' or 'avatar_visual') is the LLM's choice
    // via avatar_config.format; no longer coerced from a legacy post_format.
    if (p.render_profile_slug === RENDER_PROFILE_SLUGS.AVATAR_V1) {
      if (!p.avatar_config) {
        console.warn(`  [SKIP] Avatar post missing avatar_config`);
        continue;
      }
      const ac = p.avatar_config;

      if (ac.format !== 'full_avatar' && ac.format !== 'avatar_visual') {
        console.warn(`  [SKIP] Avatar post has invalid avatar_config.format "${ac.format}"`);
        continue;
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
  console.log(`[Content] Render profiles: ${valid.map((p) => p.render_profile_slug).join(', ')}`);

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
    normalizedAxes.rachel_mode = pickRachelMode(post.render_profile_slug);
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
Render profile: ${post.render_profile_slug}

REQUIRED axes (override any previous choice):
  shot_type: ${targetAxes.shot_type}
  lighting:  ${targetAxes.lighting}
  rachel_mode: ${pickRachelMode(post.render_profile_slug)}

Return ONLY valid JSON, no code fences:
{
  "prompt": "Full DALL-E prompt. NO FACES EVER.",
  "axes": {
    "shot_type": "${targetAxes.shot_type}",
    "lighting": "${targetAxes.lighting}",
    "palette": one of ${JSON.stringify(AXES.palette)},
    "subject": one of ${JSON.stringify(AXES.subject)},
    "mood": one of ${JSON.stringify(AXES.mood)},
    "rachel_mode": "${pickRachelMode(post.render_profile_slug)}"
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
    const errors = validateRenderProfile(post);
    if (errors.length === 0) continue;

    flagged++;
    post.format_flags = errors;
    post.status_hint = 'draft_needs_review';

    await logActivity({
      category: 'debug',
      actor_type: 'agent',
      actor_name: 'content-agent',
      action: 'format_validation_failed',
      description: `Format check failed for ${post.render_profile_slug}: ${errors.join(', ')}`,
      metadata: {
        render_profile_slug: post.render_profile_slug,
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
      console.warn(`[Content] Dropping stale source URL for ${post.render_profile_slug}: ${entry.url} (${reason})`);

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

/**
 * Defensive AI Magic gate (last line of defense before insert).
 *
 * For every post the LLM emitted with content_pillar='ai_magic', re-run
 * `validateContentQueueRow` against the matching briefing opportunity.
 * The contract requires that `ai_magic_output` quote the briefing's
 * `original_prompt` and `original_output` verbatim — if either is
 * missing or the verbatim substring is not present, the row is moved to
 * `content_queue_rejected` and excluded from the batch.
 *
 * Returns `{ kept, rejected }`. Rejected rows are persisted as a side
 * effect (best-effort; failure to persist is logged but does not break
 * the run, because the goal is preventing bad inserts, not bookkeeping).
 *
 * Anchor: May 11 fabricated AI Magic incident.
 */
async function enforceAiMagicDefensiveGate(posts, briefing) {
  const kept = [];
  const rejected = [];
  const opps = briefing?.opportunities || [];
  const oppsBySignal = new Map();
  for (const opp of opps) {
    if (opp.signal_id) oppsBySignal.set(opp.signal_id, opp);
  }

  for (const post of posts) {
    if (post.content_pillar !== 'ai_magic') {
      kept.push(post);
      continue;
    }
    const signalId = Array.isArray(post.source_signal_ids) ? post.source_signal_ids[0] : null;
    const briefingOpp = signalId ? oppsBySignal.get(signalId) : null;
    const verdict = validateContentQueueRow(post, briefingOpp);
    if (verdict.ok) {
      kept.push(post);
      continue;
    }
    rejected.push({ post, reason: verdict.reason, field: verdict.field, briefingOpp });
  }

  if (rejected.length === 0) return { kept, rejected: [] };

  console.warn(`[Content] AI Magic defensive gate REJECTED ${rejected.length} post(s).`);

  let agentId = null;
  try {
    const { data: agentRow } = await supabase
      .from('agents')
      .select('id')
      .eq('slug', 'content-text-gen')
      .maybeSingle();
    agentId = agentRow?.id || null;
  } catch {
    /* fall through with null agentId */
  }

  const pipelineRunId = process.env.PIPELINE_RUN_ID || null;
  const rows = rejected.map((r) => ({
    pipeline_run_id: pipelineRunId,
    briefing_id: briefing?.id || null,
    signal_id: Array.isArray(r.post.source_signal_ids) ? r.post.source_signal_ids[0] : null,
    agent_id: agentId,
    reason: r.reason,
    field: r.field || null,
    evidence: typeof r.post.ai_magic_output === 'string'
      ? r.post.ai_magic_output.slice(0, 1000)
      : null,
    raw_llm_output: r.post,
    raw_briefing_row: r.briefingOpp || null,
  }));

  try {
    const { error } = await supabase.from('content_queue_rejected').insert(rows);
    if (error) {
      console.warn(`[Content] Failed to persist content_queue_rejected rows: ${error.message}`);
    }
  } catch (err) {
    console.warn(`[Content] Exception persisting content_queue_rejected: ${err.message}`);
  }

  for (const r of rejected) {
    await logActivity({
      category: 'alert',
      actor_type: 'agent',
      actor_name: 'content-agent',
      action: 'ai_magic_defensive_gate_rejected',
      description: `Rejected ai_magic post: ${r.reason}`,
      metadata: {
        field: r.field || null,
        signal_id: Array.isArray(r.post.source_signal_ids) ? r.post.source_signal_ids[0] : null,
        briefing_id: briefing?.id || null,
        pipeline_run_id: pipelineRunId,
      },
    });
  }

  return { kept, rejected };
}

// --- Write to Supabase ---

async function writeContentQueue(posts, briefingId, renderProfileMap, batchCtx = null) {
  // V2 §4.1: per-piece accounting of the batch generation cost. Anthropic Sonnet 4.6
  // pricing: $3/MTok input, $15/MTok output. Split evenly across the batch since
  // one LLM call produced N pieces.
  const totalCostUsd = batchCtx?.usage
    ? (batchCtx.usage.input_tokens * 3 + batchCtx.usage.output_tokens * 15) / 1_000_000
    : null;
  const costPerPiece = totalCostUsd != null ? totalCostUsd / Math.max(1, posts.length) : null;
  const tokensInPerPiece = batchCtx?.usage ? Math.round(batchCtx.usage.input_tokens / Math.max(1, posts.length)) : null;
  const tokensOutPerPiece = batchCtx?.usage ? Math.round(batchCtx.usage.output_tokens / Math.max(1, posts.length)) : null;

  const rows = posts.map((p) => {
    // v2.0.0: LLM emits render_profile_slug directly; resolve to ID via the map.
    const profile = renderProfileMap[p.render_profile_slug];
    const renderProfileId = profile?.id || null;
    const density = classifyDensity(p);
    const row = buildContentQueueRow(p, { briefingId, renderProfileId, density });
    if (batchCtx) {
      // V2 §4.1: per-piece generation_context snapshot, frozen at insert time.
      row.generation_context = {
        model: CLAUDE_MODEL,
        system_prompt: batchCtx.systemPrompt,
        user_prompt: batchCtx.userPrompt,
        tokens_in: tokensInPerPiece,
        tokens_out: tokensOutPerPiece,
        cost_usd: costPerPiece,
        pillar_input: p.content_pillar,
        format_input: p.render_profile_slug,
        channels: p.channels,
        active_directives: (batchCtx.directives || []).map((d) => ({
          directive_type: d.directive_type,
          directive: d.directive,
        })),
        briefing_id: briefingId,
        // Agent Skills v2.0.0 — pinpoint which skill produced this row.
        agent_slug: 'smt_content_text_gen',
        skill_version: batchCtx.skillVersion || null,
        contract_version: batchCtx.contractVersion || null,
      };
    }
    return row;
  });

  const { data: inserted, error } = await supabase
    .from('content_queue')
    .insert(rows)
    .select('id');

  if (error) {
    console.error('[Content] Failed to write content queue:', error);
    process.exit(1);
  }

  console.log(`[Content] ${rows.length} posts written to content_queue`);

  // V2 §4.1: log step-1 prompt_executions in parallel. logPromptExecution
  // never throws — observability plumbing must not block the critical path.
  if (batchCtx && inserted) {
    await Promise.allSettled(
      inserted.map((row, i) =>
        logPromptExecution({
          contentId: row.id,
          agentName: 'content_gen',
          stepName: 'content_gen',
          stepOrder: 1,
          model: CLAUDE_MODEL,
          systemPrompt: batchCtx.systemPrompt,
          userPrompt: batchCtx.userPrompt,
          renderedOutput: JSON.stringify(posts[i]),
          outputJson: posts[i],
          tokensIn: tokensInPerPiece,
          tokensOut: tokensOutPerPiece,
          costUsd: costPerPiece,
          status: 'ok',
          latencyMs: batchCtx.latencyMs ?? null,
        }),
      ),
    );
  }

  return inserted;
}

// --- Caption polish + scheduled_posts insert (v2.0.0) ---

const POLISH_MODEL = 'claude-haiku-4-5';

function buildChannelPolishPrompt(post, channel) {
  const style = CHANNEL_STYLE[channel];
  return (
    `You are tailoring a parenting post caption to ${channel.toUpperCase()}.\n\n` +
    `Render profile: ${post.render_profile_slug}\n` +
    `Pillar: ${post.content_pillar}\n` +
    `Hook (already shown on screen — do NOT repeat verbatim): ${JSON.stringify(post.hook || '')}\n` +
    `Base caption:\n"""${post.caption || ''}"""\n\n` +
    `Channel tone: ${style.tone}\n` +
    `Target ≤${style.target_chars} chars. Hard cap ${style.max_chars} chars.\n\n` +
    (channel === 'tiktok'
      ? `TikTok rules: hook-first opening, hashtag-dense end. Lean into search-friendly tags.\n`
      : `Instagram rules: open with the most emotionally landing line, then add 2-3 sentences of supporting context. Bury hashtags at the end (or omit if the post is long).\n`) +
    `Voice: ${post.hashtags ? `hashtags already chosen: ${post.hashtags.join(' ')}. Use them.` : 'pick 5-8 niche/medium hashtags.'} No mega-tags (#momlife/#parenting).\n\n` +
    `Return ONLY valid JSON: {"caption": "..."}. No explanation, no code fences.`
  );
}

function parseChannelCaption(text) {
  if (typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.caption === 'string') return parsed.caption.trim();
  } catch {
    // fall through
  }
  const match = cleaned.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return match ? JSON.parse(`"${match[1]}"`).trim() : null;
}

/**
 * For each (post × channel), call Haiku to produce a platform-native
 * caption. Returns a map keyed by post index → { [channel]: caption }.
 * Per-call failure is non-fatal: the corresponding scheduled_posts
 * row still gets inserted with caption=null, and the publish agent
 * falls back to content_queue.caption.
 */
async function polishCaptionsPerChannel(posts) {
  const out = posts.map(() => ({}));

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const channels = Array.isArray(post.channels) && post.channels.length > 0
      ? post.channels
      : [...DEFAULT_CHANNELS];

    try {
      out[i] = await generateChannelCaptions(
        post,
        channels,
        async (p, channel) => {
          const msg = await anthropic.messages.create({
            model: POLISH_MODEL,
            max_tokens: 600,
            messages: [{ role: 'user', content: buildChannelPolishPrompt(p, channel) }],
          });
          const caption = parseChannelCaption(msg?.content?.[0]?.text);
          await logCost(supabase, {
            pipeline_stage: 'content_generation',
            service: 'anthropic',
            model: POLISH_MODEL,
            input_tokens: msg?.usage?.input_tokens ?? 0,
            output_tokens: msg?.usage?.output_tokens ?? 0,
            description: `Caption polish for ${channel} (${p.render_profile_slug})`,
          });
          if (!caption) throw new Error('empty caption from polish step');
          return caption;
        },
      );
    } catch (err) {
      console.warn(`[Content] Caption polish failed for post ${i + 1}: ${err.message}`);
      await logActivity({
        category: 'debug',
        actor_type: 'agent',
        actor_name: 'content-agent',
        action: 'caption_polish_failed',
        description: `Caption polish failed for post ${i + 1}: ${err.message}`,
        metadata: { post_index: i, render_profile_slug: post.render_profile_slug, channels },
      });
      // Leave out[i] as the partial map (may have some channels filled in).
    }
  }

  return out;
}

/**
 * Insert scheduled_posts rows (one per channel per piece) in 'pending'
 * status. captionsPerPost[i] is the channel→caption map from
 * polishCaptionsPerChannel; channels missing a caption become null
 * (publish agent falls back to content_queue.caption).
 */
async function writeScheduledPosts(posts, insertedContentRows, captionsPerPost) {
  if (!Array.isArray(insertedContentRows) || insertedContentRows.length === 0) return;

  const allRows = [];
  for (let i = 0; i < insertedContentRows.length; i++) {
    const contentId = insertedContentRows[i].id;
    const post = posts[i];
    const channels = resolveTargetChannels(post.render_profile_slug, post.content_pillar);
    const rows = buildScheduledPostsRows(contentId, channels, captionsPerPost[i] || {});
    allRows.push(...rows);
  }

  if (allRows.length === 0) return;

  const { error } = await supabase.from('scheduled_posts').insert(allRows);
  if (error) {
    // FAIL LOUD. Silent returns here are exactly what masked Run #667:
    // pipeline reported clean while zero rows persisted. The orchestrator's
    // failure path (non-zero exit code → escalation) is the correct place
    // for this — not a silently swallowed log.
    //
    // 'alert' is the right activity_log category here: 'error' is not a
    // valid value (see agents/lib/activity.js), and a silent logActivity
    // failure is part of how Run #667 hid for 2+ hours.
    console.error('[Content] Failed to write scheduled_posts:', error);
    await logActivity({
      category: 'alert',
      actor_type: 'agent',
      actor_name: 'content-agent',
      action: 'scheduled_posts_insert_failed',
      description: `scheduled_posts insert failed for ${insertedContentRows.length} pieces: ${error.message}`,
      metadata: { content_ids: insertedContentRows.map((r) => r.id), error: error.message },
    });
    throw new Error(
      `scheduled_posts insert failed for ${insertedContentRows.length} pieces ` +
      `(content_ids: ${insertedContentRows.map((r) => r.id).join(',')}): ${error.message}`,
    );
  }
  console.log(`[Content] ${allRows.length} scheduled_posts rows written (${insertedContentRows.length} pieces × channels)`);
}

// --- Main ---

async function main() {
  console.log('[Content Agent] Starting content generation...');
  console.log('[Content Agent] Greedy mode: generating for ALL good opportunities');
  const startTime = Date.now();

  // Load runtime skill (brand voice + DNA + visual + face + contract are
  // bundled by the loader's companion_files mechanism).
  const skill = await loadSkill('smt_content_text_gen');
  console.log(`[Content Agent] Loaded skill smt_content_text_gen v${skill.skillVersion} (contract v${skill.contractVersion})`);

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

  // Generate batch via Claude. Capture latency for prompt_executions logging (V2 §4.1).
  const genStart = Date.now();
  const { posts: rawPosts, usage, systemPrompt, userPrompt } = await generateBatch(briefing, skill.systemPrompt, coverageGaps, recentHooks, directives, insights);
  const genLatencyMs = Date.now() - genStart;

  // Validate (shape)
  const posts = await validateBatch(rawPosts);

  // Post-process: normalize image fields, resolve source_urls, enforce
  // format + diversity gates, revalidate URLs. Each step logs its own
  // activity_log events so failures are visible in the debug stream.
  for (const p of posts) {
    normalizeImageFields(p);
    p.source_urls = resolveSourceUrls(p, briefing.opportunities);
    // v2.0.0: render_profile_slug comes from the LLM. No mapping fallback.
  }

  // Caption length retry: one-shot regen for captions ≤5% over their
  // hard cap. Runs BEFORE format gates so a successful retry replaces
  // the caption and the gate sees the clean value. Posts that overshoot
  // >5% (or whose retry fails) get status_hint='draft_needs_review' and
  // a caption_length_overshoot debug event.
  await enforceCaptionLengthWithRetry(posts, { client: anthropic });

  await enforceFormatGates(posts);
  await enforceBatchDiversity(posts);
  await revalidatePostSourceUrls(posts);

  // Defensive AI Magic gate — last line of defense before insert. Any post
  // whose ai_magic_output doesn't verbatim quote the briefing's prompt +
  // output gets diverted to content_queue_rejected and removed from the
  // insert batch. (May 11 incident anchor.)
  const { kept, rejected } = await enforceAiMagicDefensiveGate(posts, briefing);
  posts.length = 0;
  posts.push(...kept);
  if (rejected.length > 0) {
    console.warn(`[Content Agent] ${rejected.length} post(s) diverted to content_queue_rejected by defensive gate`);
  }

  if (posts.length === 0) {
    console.error('[Content Agent] All posts rejected by gate — nothing to write.');
    process.exit(1);
  }

  // Write to Supabase. Pass batch context so writeContentQueue can build
  // per-piece generation_context + prompt_executions rows (V2 §4.1).
  const inserted = await writeContentQueue(posts, briefing.id, renderProfileMap, {
    systemPrompt,
    userPrompt,
    usage,
    directives,
    latencyMs: genLatencyMs,
    skillVersion: skill.skillVersion,
    contractVersion: skill.contractVersion,
  });

  // v2.0.0 (CHANNEL_MODEL_V1): per-channel caption polish (2× Haiku per
  // piece, one TikTok-native + one Instagram-native) → insert
  // scheduled_posts rows in 'pending' status. Non-fatal: failures here
  // do not roll back the content_queue write.
  if (Array.isArray(inserted) && inserted.length > 0) {
    const captionsPerPost = await polishCaptionsPerChannel(posts.slice(0, inserted.length));
    await writeScheduledPosts(posts.slice(0, inserted.length), inserted, captionsPerPost);
  }

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

  // Stamp skill_version + contract_version onto the latest agent_runs row
  // (best-effort).
  try {
    const { data: agentRow } = await supabase
      .from('agents')
      .select('id')
      .eq('slug', 'content-text-gen')
      .maybeSingle();
    if (agentRow?.id) {
      const { data: latestRun } = await supabase
        .from('agent_runs')
        .select('id')
        .eq('agent_id', agentRow.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRun?.id) {
        await supabase
          .from('agent_runs')
          .update({ skill_version: skill.skillVersion, contract_version: skill.contractVersion })
          .eq('id', latestRun.id);
      }
    }
  } catch (err) {
    console.warn(`[Content Agent] Failed to stamp skill_version on agent_runs (non-fatal): ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Content Agent] Done in ${elapsed}s.`);
  console.log(`[Content Agent] ${posts.length} posts written to content_queue.`);
  console.log(`[Content Agent] Skill: smt_content_text_gen v${skill.skillVersion} (contract v${skill.contractVersion})`);

  // Summary
  console.log('\n=== GENERATED BATCH ===');
  for (const p of posts) {
    console.log(`\n[${p.render_profile_slug}] [${p.channels?.join(',')}] [${p.content_type}] [${p.content_pillar}] [${p.age_range}]`);
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
