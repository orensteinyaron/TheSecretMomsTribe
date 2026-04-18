/**
 * Content Regeneration V1 — salvage pre-V1 drafts that fail the new format
 * gates. Preserves editorial core (hook, topic, age_range, content_pillar,
 * briefing_id, source_urls) and rewrites the delivery layer
 * (post_format, caption, slides, image_prompt, image_axes, hashtags).
 *
 * Usage:
 *   npm run regenerate-drafts -- --dry-run
 *   npm run regenerate-drafts -- --confirm
 *   npm run regenerate-drafts -- --confirm --limit 3
 *   npm run regenerate-drafts -- --confirm --ids abc,def
 *
 * Safety:
 *   - Default is dry-run; --confirm required to write.
 *   - Not on the orchestrator schedule. Manual invocation only.
 *   - Idempotent: a row already marked superseded is skipped.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { logActivity } from '../agents/lib/activity.js';
import {
  AXES,
  pickRachelMode,
  readAxes,
  normalizeAxisValue,
  enforceBatchDiversity,
} from '../agents/lib/image-diversity.js';
import {
  CAPTION_MAX_BY_FORMAT,
  MIN_CAROUSEL_SLIDES,
  recommendFormat,
  validateFormat,
} from '../agents/lib/format-selector.js';
import { validateSocialUrl } from '../agents/lib/url-validator.js';
import { logCost } from './utils/cost-logger.js';

export const PRE_FIX_CUTOFF = '2026-04-18T12:50:00Z';
const BATCH_SIZE = 5;
const CLAUDE_SONNET = 'claude-sonnet-4-6';
const CLAUDE_HAIKU = 'claude-haiku-4-5';

// ---- Pure helpers (exported for unit tests) --------------------------------

export function parseArgs(argv) {
  const out = { dryRun: false, confirm: false, limit: null, ids: null };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--confirm') out.confirm = true;
    else if (tok === '--limit') out.limit = Number(argv[++i]);
    else if (tok.startsWith('--limit=')) out.limit = Number(tok.split('=')[1]);
    else if (tok === '--ids') out.ids = argv[++i]?.split(',').map((s) => s.trim()).filter(Boolean);
    else if (tok.startsWith('--ids=')) out.ids = tok.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!out.confirm) out.dryRun = true;
  return out;
}

/**
 * Eligibility filter per spec §4.2.
 * A row is eligible if:
 *   - status = 'draft'
 *   - created_at < PRE_FIX_CUTOFF
 *   - not already superseded (idempotent)
 *   - has a non-null hook
 *   - has either non-empty caption or slides
 *   - post_format is null OR current post fails validateFormat
 */
export function isEligible(row, { cutoff = PRE_FIX_CUTOFF, validateFormatFn = validateFormat } = {}) {
  if (!row || row.status !== 'draft') return false;
  if (row.metadata?.superseded_by) return false;
  if (!row.hook || typeof row.hook !== 'string') return false;
  const hasCaption = typeof row.caption === 'string' && row.caption.length > 0;
  const hasSlides = Array.isArray(row.slides) && row.slides.length > 0;
  if (!hasCaption && !hasSlides) return false;
  if (new Date(row.created_at).getTime() >= new Date(cutoff).getTime()) return false;
  if (!row.post_format) return true;
  return validateFormatFn(row).length > 0;
}

/**
 * Pick the target format for a regenerated piece given the extracted
 * editorial brief. Uses the same density-based rules content.js uses.
 */
export function projectFormat(originalRow, editorialBrief) {
  const pseudo = {
    platform: originalRow.platform,
    hook: originalRow.hook,
    caption: editorialBrief?.core_insight || editorialBrief?.topic_summary || '',
    slides: [],
    avatar_config: originalRow.avatar_config || null,
  };
  return recommendFormat(pseudo);
}

export function captionLimitFor(postFormat) {
  return CAPTION_MAX_BY_FORMAT[postFormat] ?? 400;
}

// Re-exports so tests don't need to reach into the lib tree.
export { validateFormat };

// ---- LLM prompts -----------------------------------------------------------

function briefExtractionPrompt(row) {
  const slideText = Array.isArray(row.slides)
    ? row.slides.map((s) => (s && typeof s.text === 'string' ? `- ${s.text}` : '')).filter(Boolean).join('\n')
    : '';
  return `You are analyzing an existing SMT parenting post to pull out its editorial core. The delivery (slides, caption length, format) will be rewritten, but the topic and emotional take must survive.

Original hook (locked — do not change):
"""${row.hook}"""

Original caption:
"""${(row.caption || '').slice(0, 2000)}"""

Original slides text:
${slideText || '(none)'}

Original pillar: ${row.content_pillar}
Original age range: ${row.age_range}

Return ONLY valid JSON with this shape:
{
  "topic_summary": "One sentence describing what this post is about.",
  "core_insight": "The irreducible takeaway — what the reader walks away with. Max 40 words.",
  "emotional_register": one of ["tender", "urgent", "playful", "reflective", "chaotic", "energetic", "quiet_grounding"]
}`;
}

function regenPrompt(row, brief, targetFormat, attempt, previousCaptionLen) {
  const capLimit = captionLimitFor(targetFormat);
  const slideRule = targetFormat === 'ig_static' || targetFormat === 'ig_meme'
    ? `slides = [] (single-image format)`
    : targetFormat === 'ig_carousel'
      ? `slides = array of ${MIN_CAROUSEL_SLIDES}-7 slide objects`
      : targetFormat.startsWith('tiktok_')
        ? `slides = array of 4-7 slide objects`
        : `slides = [] unless genuinely needed`;

  const rachelMode = pickRachelMode(targetFormat);
  const stricter = attempt > 1
    ? `\n\nYour previous attempt produced a caption of ${previousCaptionLen} chars. The hard cap is ${capLimit}. Be RUTHLESS this time — cut every non-essential word.\n`
    : '';

  return `You are rewriting the DELIVERY layer of an SMT post. The editorial core is LOCKED — you must preserve it. Only change format, caption, slides, hashtags, image.

## LOCKED (must appear verbatim in output)
hook: "${row.hook}"

## Editorial brief (preserve the insight)
topic_summary: ${brief.topic_summary}
core_insight: ${brief.core_insight}
emotional_register: ${brief.emotional_register}

## Target format: ${targetFormat}
Caption hard cap: ${capLimit} chars. If the caption exceeds this, the post is REJECTED.
Slides: ${slideRule}

## Pillar / audience (unchanged)
content_pillar: ${row.content_pillar}
age_range: ${row.age_range}
platform: ${row.platform}${stricter}

## Image prompt axes (required)
rachel_mode: "${rachelMode}"
Axes enum values:
  shot_type: ${JSON.stringify(AXES.shot_type)}
  lighting: ${JSON.stringify(AXES.lighting)}
  palette:  ${JSON.stringify(AXES.palette)}
  subject:  ${JSON.stringify(AXES.subject)}
  mood:     ${JSON.stringify(AXES.mood)}

## Output (return ONLY valid JSON, no code fences, no explanation)
{
  "post_format": "${targetFormat}",
  "hook": "${row.hook.replace(/"/g, '\\"')}",
  "caption": "Caption under ${capLimit} chars. Platform-native tone.",
  "hashtags": ["#tag1", "#tag2", "... 5-8 total"],
  "slides": [{"slide_number": 1, "text": "...", "type": "hook|content|cta", "image_prompt": null}],
  "audio_suggestion": "TikTok only. Empty string for IG.",
  "image_prompt": {
    "prompt": "Full DALL-E prompt, NO FACES EVER.",
    "axes": {
      "shot_type": "...", "lighting": "...", "palette": "...",
      "subject": "...", "mood": "...", "rachel_mode": "${rachelMode}"
    }
  }
}`;
}

// ---- IO layer --------------------------------------------------------------

async function fetchCandidates(supabase, { ids, limit }) {
  let q = supabase.from('content_queue')
    .select('*')
    .eq('status', 'draft')
    .lt('created_at', PRE_FIX_CUTOFF)
    .order('created_at', { ascending: true });

  if (Array.isArray(ids) && ids.length > 0) q = q.in('id', ids);

  const { data, error } = await q;
  if (error) throw new Error(`fetch candidates: ${error.message}`);

  const eligible = (data || []).filter((r) => isEligible(r));
  return typeof limit === 'number' && Number.isFinite(limit) ? eligible.slice(0, limit) : eligible;
}

async function fetchBriefing(supabase, briefingId) {
  if (!briefingId) return null;
  const { data } = await supabase.from('daily_briefings').select('*').eq('id', briefingId).single();
  return data || null;
}

async function revalidateSourceUrls(row, actorName) {
  const urls = Array.isArray(row.source_urls) ? row.source_urls : [];
  if (urls.length === 0) return urls;
  const keep = [];
  for (const entry of urls) {
    if (!entry?.url) continue;
    const result = await validateSocialUrl(entry.url);
    if (result.valid) {
      keep.push(entry);
      continue;
    }
    await logActivity({
      category: 'debug',
      actor_type: 'agent',
      actor_name: actorName,
      action: 'url_validation_dropped_regen',
      description: `Regen-time URL validation failed: ${entry.url} — ${result.reason || result.error || 'unknown'}`,
      metadata: {
        url: entry.url,
        reason: result.reason,
        platform: result.platform,
        signal_id: entry.signal_id,
        original_content_id: row.id,
      },
    });
  }
  return keep;
}

async function extractBrief(anthropic, supabase, row) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_HAIKU,
    max_tokens: 400,
    messages: [{ role: 'user', content: briefExtractionPrompt(row) }],
  });
  await logCost(supabase, {
    pipeline_stage: 'content_regeneration',
    service: 'anthropic',
    model: CLAUDE_HAIKU,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    content_id: row.id,
    description: 'Regen editorial brief extraction',
  });
  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  return JSON.parse(text);
}

async function generateDelivery(anthropic, supabase, row, brief, targetFormat, attempt, previousCaptionLen) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_SONNET,
    max_tokens: 4000,
    messages: [{ role: 'user', content: regenPrompt(row, brief, targetFormat, attempt, previousCaptionLen) }],
  });
  await logCost(supabase, {
    pipeline_stage: 'content_regeneration',
    service: 'anthropic',
    model: CLAUDE_SONNET,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    content_id: row.id,
    description: `Regen delivery attempt ${attempt}`,
  });
  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  return JSON.parse(text);
}

export function normalizePost(row, gen, targetFormat, brief) {
  const post = {
    platform: row.platform,
    post_format: gen.post_format || targetFormat,
    content_type: row.content_type,
    content_pillar: row.content_pillar,
    age_range: row.age_range,
    hook: row.hook, // LOCKED
    caption: typeof gen.caption === 'string' ? gen.caption : '',
    hashtags: Array.isArray(gen.hashtags) ? gen.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)) : [],
    slides: Array.isArray(gen.slides) ? gen.slides : [],
    audio_suggestion: gen.audio_suggestion || null,
    image_prompt: '',
    image_axes: {},
    briefing_id: row.briefing_id,
    avatar_config: row.avatar_config || null,
    source_urls: Array.isArray(row.source_urls) ? row.source_urls : [],
    ai_magic_output: row.ai_magic_output || null,
  };

  // Image fields: accept {prompt, axes} object or plain string.
  if (gen.image_prompt && typeof gen.image_prompt === 'object' && !Array.isArray(gen.image_prompt)) {
    post.image_prompt = typeof gen.image_prompt.prompt === 'string' ? gen.image_prompt.prompt : '';
    const axes = gen.image_prompt.axes || {};
    for (const axis of Object.keys(AXES)) {
      post.image_axes[axis] = normalizeAxisValue(axes[axis]) || null;
    }
  } else if (typeof gen.image_prompt === 'string') {
    post.image_prompt = gen.image_prompt;
  }
  if (!post.image_axes.rachel_mode) post.image_axes.rachel_mode = pickRachelMode(post.post_format);

  // Stash the brief for traceability
  post._brief = brief;
  return post;
}

async function writeRegenRow(supabase, originalRow, post, { attemptsUsed, needsReview }) {
  const status = needsReview ? 'draft_needs_review' : 'draft';
  const metadata = {
    image_axes: post.image_axes,
    regenerated_from: originalRow.id,
    regen_attempt: attemptsUsed,
    regen_editorial_brief: post._brief,
    format_flags: needsReview ? validateFormat(post) : [],
  };
  const row = {
    briefing_id: post.briefing_id,
    platform: post.platform,
    content_type: post.content_type,
    status,
    hook: post.hook,
    caption: post.caption,
    hashtags: post.hashtags,
    ai_magic_output: post.ai_magic_output,
    image_prompt: post.image_prompt || null,
    audio_suggestion: post.audio_suggestion || null,
    age_range: post.age_range,
    content_pillar: post.content_pillar,
    post_format: post.post_format,
    slides: post.slides || [],
    avatar_config: post.avatar_config,
    image_status: 'pending',
    launch_bank: false,
    quality_rating: null,
    source_urls: post.source_urls,
    metadata,
  };

  const { data, error } = await supabase.from('content_queue').insert(row).select('id').single();
  if (error) throw new Error(`insert regen row: ${error.message}`);
  return data.id;
}

async function markSuperseded(supabase, originalRow, newId) {
  const nextMeta = {
    ...(originalRow.metadata || {}),
    superseded_by: newId,
    superseded_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('content_queue')
    .update({ status: 'superseded', metadata: nextMeta })
    .eq('id', originalRow.id);
  if (error) throw new Error(`mark superseded: ${error.message}`);
}

// ---- Per-piece pipeline ----------------------------------------------------

async function regenerateOne(row, { anthropic, supabase }) {
  const actor = 'content-regen-agent';

  await logActivity({
    category: 'pipeline',
    actor_type: 'agent',
    actor_name: actor,
    action: 'content_regen_started',
    description: `Regen started for ${row.id} (${row.post_format || 'null'})`,
    entity_type: 'content',
    entity_id: row.id,
  });

  row.source_urls = await revalidateSourceUrls(row, actor);

  const brief = await extractBrief(anthropic, supabase, row);
  const targetFormat = projectFormat(row, brief);

  let gen;
  let post;
  let errors = [];
  let attempt = 0;
  let previousCaptionLen = 0;

  for (attempt = 1; attempt <= 2; attempt++) {
    gen = await generateDelivery(anthropic, supabase, row, brief, targetFormat, attempt, previousCaptionLen);
    post = normalizePost(row, gen, targetFormat, brief);
    errors = validateFormat(post);
    if (errors.length === 0) break;

    previousCaptionLen = (post.caption || '').length;
    if (attempt === 1) {
      await logActivity({
        category: 'debug',
        actor_type: 'agent',
        actor_name: actor,
        action: 'content_regen_retry',
        description: `Regen attempt 1 failed validateFormat: ${errors.join(', ')}`,
        entity_type: 'content',
        entity_id: row.id,
        metadata: { errors, caption_length: previousCaptionLen, target_format: targetFormat },
      });
    }
  }

  return { row, post, attemptsUsed: attempt > 2 ? 2 : attempt, targetFormat, brief, errors };
}

// ---- Public runner ---------------------------------------------------------

export async function runRegeneration({ argv = [], supabase, anthropic, stdout = console } = {}) {
  const args = parseArgs(argv);
  stdout.log(`[Regen] Mode: ${args.dryRun ? 'DRY-RUN' : 'CONFIRM'}${args.limit ? ` (limit=${args.limit})` : ''}${args.ids ? ` (ids=${args.ids.length})` : ''}`);

  const candidates = await fetchCandidates(supabase, { ids: args.ids, limit: args.limit });
  stdout.log(`[Regen] ${candidates.length} eligible candidate(s)`);

  // Dry-run: extract brief + project format, print, no DB writes.
  if (args.dryRun) {
    stdout.log('[Regen] --- Dry-run plan ---');
    const plan = [];
    for (const row of candidates) {
      const brief = await extractBrief(anthropic, supabase, row);
      const targetFormat = projectFormat(row, brief);
      const capLimit = captionLimitFor(targetFormat);
      plan.push({
        id: row.id,
        current_format: row.post_format || '(null)',
        caption_len: (row.caption || '').length,
        topic_summary: brief.topic_summary,
        core_insight: brief.core_insight,
        projected_format: targetFormat,
        projected_caption_cap: capLimit,
      });
      stdout.log(`  ${row.id}  ${row.post_format || 'null'} (cap=${(row.caption || '').length}) → ${targetFormat} (cap<=${capLimit})`);
      stdout.log(`    topic: ${brief.topic_summary}`);
      stdout.log(`    core:  ${brief.core_insight}`);
    }
    // Rough cost estimate ($0.04/piece avg including amortized retry)
    const est = (candidates.length * 0.04).toFixed(2);
    stdout.log(`[Regen] Estimated cost for --confirm run: ~$${est}`);
    stdout.log('[Regen] Dry-run complete. Re-run with --confirm to execute.');
    return { mode: 'dry-run', count: candidates.length, plan };
  }

  // Confirm run. Process in batches of 5, enforce diversity per batch.
  const results = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const processed = [];
    for (const row of batch) {
      try {
        const res = await regenerateOne(row, { anthropic, supabase });
        processed.push(res);
      } catch (err) {
        stdout.error(`[Regen] ${row.id} failed: ${err.message}`);
        await logActivity({
          category: 'alert',
          actor_type: 'agent',
          actor_name: 'content-regen-agent',
          action: 'content_regen_failed',
          description: `Regen threw: ${err.message}`,
          entity_type: 'content',
          entity_id: row.id,
          metadata: { error: err.message },
        });
      }
    }

    // Batch-level diversity across NEW posts.
    const newPosts = processed.map((p) => p.post);
    const diversityResult = await enforceBatchDiversity(newPosts, {
      regenerateFn: async () => false, // no LLM regen here — we just force axes slugs
      logEvent: ({ index, key, target, regenerated }) =>
        logActivity({
          category: 'debug',
          actor_type: 'agent',
          actor_name: 'content-regen-agent',
          action: 'image_diversity_regenerated',
          description: `Regen batch image duplicate — forced to ${target.shot_type}+${target.lighting}`,
          metadata: { index, key, target, regenerated, batch_start: i },
        }),
    });

    // Persist each regen piece: write new row, mark original superseded.
    for (const { row, post, attemptsUsed, errors } of processed) {
      const needsReview = errors.length > 0;
      try {
        const newId = await writeRegenRow(supabase, row, post, { attemptsUsed, needsReview });
        await markSuperseded(supabase, row, newId);

        const event = needsReview ? 'content_regen_needs_review' : 'content_regen_succeeded';
        const category = needsReview ? 'alert' : 'pipeline';
        await logActivity({
          category,
          actor_type: 'agent',
          actor_name: 'content-regen-agent',
          action: event,
          description: needsReview
            ? `Regen ${row.id} → ${newId} (draft_needs_review after ${attemptsUsed} attempts): ${errors.join(', ')}`
            : `Regen ${row.id} → ${newId} (${post.post_format}, caption=${(post.caption || '').length})`,
          entity_type: 'content',
          entity_id: newId,
          metadata: {
            original_id: row.id,
            new_id: newId,
            target_format: post.post_format,
            caption_length: (post.caption || '').length,
            attempts: attemptsUsed,
            format_flags: needsReview ? errors : [],
          },
        });

        results.push({ original_id: row.id, new_id: newId, status: needsReview ? 'draft_needs_review' : 'draft', post_format: post.post_format });
        stdout.log(`  ✓ ${row.id} → ${newId}  ${post.post_format}  (cap=${(post.caption || '').length}, status=${needsReview ? 'draft_needs_review' : 'draft'})`);
      } catch (err) {
        stdout.error(`[Regen] ${row.id} persist failed: ${err.message}`);
      }
    }

    await logActivity({
      category: 'pipeline',
      actor_type: 'agent',
      actor_name: 'content-regen-agent',
      action: 'content_regen_batch_complete',
      description: `Batch complete: ${processed.length} processed, diversity violations=${diversityResult.violations}`,
      metadata: { batch_start: i, processed: processed.length, diversity: diversityResult },
    });
  }

  stdout.log(`[Regen] Done. ${results.length} regen rows written.`);
  return { mode: 'confirm', count: results.length, results };
}

// ---- CLI entrypoint --------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
    console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  runRegeneration({ argv: process.argv.slice(2), supabase, anthropic })
    .catch((err) => {
      console.error('[Regen] Fatal:', err);
      process.exit(1);
    });
}
