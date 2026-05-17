/**
 * Tests for format-selector density classification + render-profile validation.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): format is render_profile_slug, not the legacy
 * post_format enum.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  classifyDensity,
  recommendRenderProfileSlug,
  validateRenderProfile,
  CAPTION_MAX_BY_SLUG,
  MIN_CAROUSEL_SLIDES,
} = await import('../format-selector.js');

test('classifyDensity: 3-step method with slides → list/method', () => {
  const post = {
    hook: 'Here is how you calm a meltdown',
    caption: 'Step 1 ground her. Step 2 breath. Step 3 name it.',
    slides: [
      { slide_number: 1, text: 'hook' },
      { slide_number: 2, text: 'step 1' },
      { slide_number: 3, text: 'step 2' },
      { slide_number: 4, text: 'step 3' },
      { slide_number: 5, text: 'cta' },
    ],
  };
  const d = classifyDensity(post);
  assert.ok(d.structure === 'list' || d.structure === 'method');
});

test('classifyDensity: single short quote → single_punch', () => {
  const post = {
    hook: "You're not behind, you're human.",
    caption: "Reminder for the mom rereading this at 11pm.",
    slides: [],
  };
  const d = classifyDensity(post);
  assert.equal(d.structure, 'single_punch');
  assert.ok(d.payload_word_count < 30);
});

test('classifyDensity: reveal/twist story → story', () => {
  const post = {
    hook: 'I thought she was just being defiant',
    caption: "But then I realized she was overwhelmed. Turns out it wasn't behavior.",
    slides: [],
  };
  const d = classifyDensity(post);
  assert.equal(d.structure, 'story');
});

test('classifyDensity: avatar clips present → conversation', () => {
  const post = {
    hook: 'Let me tell you what just happened',
    caption: 'Story time',
    avatar_config: { clips: [{ type: 'avatar', purpose: 'hook' }, { type: 'avatar', purpose: 'cta' }] },
  };
  assert.equal(classifyDensity(post).structure, 'conversation');
});

test('recommendRenderProfileSlug: list structure → moving-images', () => {
  const post = {
    hook: '3 ways to reset bedtime',
    caption: 'Here are 3 ways to fix it',
    slides: [
      { slide_number: 1, text: 'h' }, { slide_number: 2, text: 'a' }, { slide_number: 3, text: 'b' }, { slide_number: 4, text: 'c' },
    ],
  };
  assert.equal(recommendRenderProfileSlug(post), 'moving-images');
});

test('recommendRenderProfileSlug: single punch quote (12 words) → static-image', () => {
  const post = {
    hook: "You're not behind, you're human.",
    caption: 'A quiet reminder for tonight.',
    slides: [],
  };
  assert.equal(recommendRenderProfileSlug(post), 'static-image');
});

test('recommendRenderProfileSlug: story with reveal → moving-images', () => {
  const post = {
    hook: 'I thought she was being defiant',
    caption: 'But then I realized she was overwhelmed. Turns out it was nervous system.',
    slides: [],
  };
  assert.equal(recommendRenderProfileSlug(post), 'moving-images');
});

test('recommendRenderProfileSlug: avatar conversation → avatar-v1', () => {
  const post = {
    hook: 'Okay wait',
    caption: 'Let me tell you',
    avatar_config: { clips: [{ type: 'avatar', purpose: 'hook' }, { type: 'avatar', purpose: 'cta' }] },
  };
  assert.equal(recommendRenderProfileSlug(post), 'avatar-v1');
});

test('validateRenderProfile: static-image with 250-char caption → caption_too_long', () => {
  const caption = 'x'.repeat(250);
  const errs = validateRenderProfile({ render_profile_slug: 'static-image', caption, slides: [{}] });
  assert.ok(errs.some((e) => e.startsWith('caption_too_long')));
});

test('validateRenderProfile: static-image with multiple slides → single-slide error', () => {
  const errs = validateRenderProfile({
    render_profile_slug: 'static-image',
    caption: 'short',
    slides: [{ slide_number: 1 }, { slide_number: 2 }],
  });
  assert.ok(errs.includes('static_image_must_have_single_slide'));
});

test('validateRenderProfile: carousel with 2 slides → needs 3+ slides', () => {
  const errs = validateRenderProfile({
    render_profile_slug: 'carousel',
    caption: 'short',
    slides: [{ slide_number: 1 }, { slide_number: 2 }],
  });
  assert.ok(errs.some((e) => e.startsWith('carousel_needs_')));
});

test('validateRenderProfile: valid carousel passes', () => {
  const errs = validateRenderProfile({
    render_profile_slug: 'carousel',
    caption: 'ok',
    slides: Array.from({ length: 5 }, (_, i) => ({ slide_number: i + 1 })),
  });
  assert.deepEqual(errs, []);
});

test('validateRenderProfile: moving-images caption > 300 → too long', () => {
  const errs = validateRenderProfile({
    render_profile_slug: 'moving-images',
    caption: 'y'.repeat(320),
    slides: [{}, {}, {}],
  });
  assert.ok(errs.some((e) => e.startsWith('caption_too_long')));
});

test('CAPTION_MAX_BY_SLUG has entries for every render profile slug', () => {
  for (const slug of ['avatar-v1', 'moving-images', 'static-image', 'carousel']) {
    assert.ok(typeof CAPTION_MAX_BY_SLUG[slug] === 'number', `cap for ${slug}`);
  }
});

test('MIN_CAROUSEL_SLIDES = 3 (per spec)', () => {
  assert.equal(MIN_CAROUSEL_SLIDES, 3);
});
