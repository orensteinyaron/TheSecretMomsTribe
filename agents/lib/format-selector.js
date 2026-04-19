/**
 * Format selection + caption length validation.
 *
 * Rules (from CONTENT_QUALITY_V1_SPEC):
 * - Single emotional punch (≤20 words core payload) → ig_static / tiktok_text / ig_meme
 * - Method or list with 3+ distinct points → ig_carousel (or tiktok_slideshow for TT)
 * - Hook-driven reveal / story with a twist → tiktok_slideshow
 * - Rachel speaking direct-to-camera → tiktok_avatar / tiktok_avatar_visual
 *
 * Caption length caps come from platform truncation realities:
 * IG feed truncates around 125 chars; TikTok users read on-screen text
 * rather than the caption; avatar formats lean on voice not text.
 */

export const CAPTION_MAX_BY_FORMAT = {
  ig_static: 125,
  ig_carousel: 400,
  ig_meme: 125,
  tiktok_slideshow: 100,
  tiktok_text: 100,
  tiktok_avatar: 150,
  tiktok_avatar_visual: 150,
  video_script: 400,
};

// Soft target: what we ASK the LLM to write to. Hard cap stays as
// CAPTION_MAX_BY_FORMAT — that's what the post-validator enforces.
// The 20% headroom absorbs the LLM's observed ~15-30% miscalibration
// (see PR #13 investigation). Empirically tuned; adjust if the
// caption_length_overshoot debug log shows the margin is too tight or
// too generous.
export const CAPTION_TARGET_BY_FORMAT = Object.fromEntries(
  Object.entries(CAPTION_MAX_BY_FORMAT).map(([fmt, cap]) => [fmt, Math.round(cap * 0.8)]),
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
 * Pure recommendation: given a post's shape, which post_format best fits?
 * Does not mutate the post.
 */
export function recommendFormat(post) {
  const { structure, payload_word_count } = classifyDensity(post);

  if (structure === 'conversation') {
    return post?.post_format === 'tiktok_avatar_visual' ? 'tiktok_avatar_visual' : 'tiktok_avatar';
  }

  const platform = post?.platform || (String(post?.post_format || '').startsWith('tiktok') ? 'tiktok' : 'instagram');

  if (structure === 'list' || structure === 'method') {
    return platform === 'tiktok' ? 'tiktok_slideshow' : 'ig_carousel';
  }
  if (structure === 'story') return 'tiktok_slideshow';

  // single_punch → short-caption formats
  if (platform === 'tiktok') return 'tiktok_text';
  if (payload_word_count <= 8) return 'ig_meme';
  return 'ig_static';
}

/**
 * Deterministic post-generation validation. Returns an array of error
 * codes. Empty array = post passes format gates.
 */
export function validateFormat(post) {
  const errors = [];
  const fmt = post?.post_format;
  const caption = typeof post?.caption === 'string' ? post.caption : '';
  const max = CAPTION_MAX_BY_FORMAT[fmt];

  if (max != null && caption.length > max) {
    errors.push(`caption_too_long:${caption.length}>${max}:${fmt}`);
  }

  if (fmt === 'ig_static' && Array.isArray(post?.slides) && post.slides.length > 1) {
    errors.push('ig_static_must_have_single_slide');
  }

  if (fmt === 'ig_carousel') {
    const slides = Array.isArray(post?.slides) ? post.slides : [];
    if (slides.length < MIN_CAROUSEL_SLIDES) {
      errors.push(`ig_carousel_needs_${MIN_CAROUSEL_SLIDES}+_slides:have=${slides.length}`);
    }
  }

  return errors;
}
