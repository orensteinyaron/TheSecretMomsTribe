/**
 * Render-profile recommendation + deterministic format validation.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): Format is `render_profile_slug` — one of
 * `avatar-v1`, `moving-images`, `static-image`, `carousel`. The legacy
 * `post_format` enum is dropped.
 *
 * Caption caps here are for the BASE caption that the main LLM emits.
 * The downstream Haiku polish step produces per-channel variants with
 * their own caps (see CHANNEL_STYLE in channels.js: tiktok max 150,
 * instagram max 2200). Render-profile-level caps encode content-density
 * expectations — a static-image piece is tighter than a carousel piece.
 *
 * Rules (from CONTENT_QUALITY_V1_SPEC, re-keyed):
 * - Single emotional punch (≤20 words core payload) → static-image
 * - Method or list with 3+ distinct points → moving-images (or carousel
 *   when the piece is explicitly an IG-style image swipe).
 * - Hook-driven reveal / story with a twist → moving-images
 * - Rachel speaking direct-to-camera → avatar-v1
 */

import { RENDER_PROFILE_SLUGS } from './render-profiles.js';

export const CAPTION_MAX_BY_SLUG = {
  [RENDER_PROFILE_SLUGS.STATIC_IMAGE]:  200,
  [RENDER_PROFILE_SLUGS.MOVING_IMAGES]: 300,
  [RENDER_PROFILE_SLUGS.CAROUSEL]:      400,
  [RENDER_PROFILE_SLUGS.AVATAR_V1]:     200,
};

// Soft target: what we ASK the LLM to write to. Hard cap stays as
// CAPTION_MAX_BY_SLUG — that's what the post-validator enforces. The 20%
// headroom absorbs the LLM's observed ~15-30% miscalibration (see PR #13
// investigation). Empirically tuned; adjust if the caption_length_overshoot
// debug log shows the margin is too tight or too generous.
export const CAPTION_TARGET_BY_SLUG = Object.fromEntries(
  Object.entries(CAPTION_MAX_BY_SLUG).map(([slug, cap]) => [slug, Math.round(cap * 0.8)]),
);

// Max overshoot (as fraction of cap) that's still considered
// "recoverable via one-shot retry". Above this, the LLM structurally
// missed the target — retries won't help; go straight to flag.
export const RECOVERABLE_OVERSHOOT_FRACTION = 0.05;

export const MIN_CAROUSEL_SLIDES = 3;
export const SINGLE_PUNCH_MAX_WORDS = 20;

/**
 * Classify a post's content density deterministically (no LLM).
 * Uses hook + caption + slides + avatar clip count.
 *
 * @returns {{structure: 'single_punch'|'list'|'method'|'story'|'conversation', payload_word_count: number}}
 */
export function classifyDensity(post) {
  const hook = typeof post?.hook === 'string' ? post.hook : '';
  const caption = typeof post?.caption === 'string' ? post.caption : '';
  const slides = Array.isArray(post?.slides) ? post.slides : [];
  const avatarClips = Array.isArray(post?.avatar_config?.clips)
    ? post.avatar_config.clips
    : [];

  const slideText = slides.map((s) => (typeof s?.text === 'string' ? s.text : '')).join(' ');
  const core = [hook, caption, slideText].filter(Boolean).join(' ').trim();
  const payloadWords = core ? core.split(/\s+/).filter(Boolean).length : 0;

  const looksLikeList =
    /\b(step\s+\d|first[,.]|second[,.]|third[,.]|finally|here'?s how|these \d|\d\s+ways|\d\s+rules|\d\s+things)\b/i.test(
      caption + ' ' + hook + ' ' + slideText,
    );
  const enoughSlides = slides.length >= MIN_CAROUSEL_SLIDES;
  const revealStory = /\b(but then|turns out|plot twist|didn'?t expect|what happened|the twist)\b/i.test(
    caption + ' ' + hook,
  );
  const directToCam = avatarClips.length > 0;

  if (directToCam) return { structure: 'conversation', payload_word_count: payloadWords };
  if (enoughSlides && looksLikeList) return { structure: 'list', payload_word_count: payloadWords };
  if (enoughSlides) return { structure: 'method', payload_word_count: payloadWords };
  if (looksLikeList) return { structure: 'list', payload_word_count: payloadWords };
  if (revealStory) return { structure: 'story', payload_word_count: payloadWords };
  if (payloadWords <= SINGLE_PUNCH_MAX_WORDS) {
    return { structure: 'single_punch', payload_word_count: payloadWords };
  }
  return { structure: 'method', payload_word_count: payloadWords };
}

/**
 * Pure recommendation: given a post's shape, which render_profile_slug fits?
 * Does not mutate the post.
 *
 * The LLM emits its own render_profile_slug; this function exists for
 * tooling that needs to suggest a slug deterministically (e.g.,
 * regenerate-stale-drafts).
 */
export function recommendRenderProfileSlug(post) {
  const { structure, payload_word_count } = classifyDensity(post);

  if (structure === 'conversation') {
    return RENDER_PROFILE_SLUGS.AVATAR_V1;
  }
  if (structure === 'list' || structure === 'method' || structure === 'story') {
    return RENDER_PROFILE_SLUGS.MOVING_IMAGES;
  }
  // single_punch → tight, statement-style piece
  if (payload_word_count <= SINGLE_PUNCH_MAX_WORDS) {
    return RENDER_PROFILE_SLUGS.STATIC_IMAGE;
  }
  return RENDER_PROFILE_SLUGS.STATIC_IMAGE;
}

/**
 * Deterministic post-generation validation. Returns an array of error
 * codes. Empty array = post passes format gates.
 */
export function validateRenderProfile(post) {
  const errors = [];
  const slug = post?.render_profile_slug;
  const caption = typeof post?.caption === 'string' ? post.caption : '';
  const max = CAPTION_MAX_BY_SLUG[slug];

  if (max != null && caption.length > max) {
    errors.push(`caption_too_long:${caption.length}>${max}:${slug}`);
  }

  if (slug === RENDER_PROFILE_SLUGS.STATIC_IMAGE && Array.isArray(post?.slides) && post.slides.length > 1) {
    errors.push('static_image_must_have_single_slide');
  }

  if (slug === RENDER_PROFILE_SLUGS.CAROUSEL) {
    const slides = Array.isArray(post?.slides) ? post.slides : [];
    if (slides.length < MIN_CAROUSEL_SLIDES) {
      errors.push(`carousel_needs_${MIN_CAROUSEL_SLIDES}+_slides:have=${slides.length}`);
    }
  }

  return errors;
}
