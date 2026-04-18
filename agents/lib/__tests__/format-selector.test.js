/**
 * Tests for format-selector density classification + format validation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  classifyDensity,
  recommendFormat,
  validateFormat,
  CAPTION_MAX_BY_FORMAT,
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

test('recommendFormat: list structure on instagram → ig_carousel', () => {
  const post = {
    platform: 'instagram',
    hook: '3 ways to reset bedtime',
    caption: 'Here are 3 ways to fix it',
    slides: [
      { slide_number: 1, text: 'h' }, { slide_number: 2, text: 'a' }, { slide_number: 3, text: 'b' }, { slide_number: 4, text: 'c' },
    ],
  };
  assert.equal(recommendFormat(post), 'ig_carousel');
});

test('recommendFormat: single punch quote (12 words) on instagram → ig_static', () => {
  const post = {
    platform: 'instagram',
    hook: "You're not behind, you're human.",
    caption: 'A quiet reminder for tonight.',
    slides: [],
  };
  // 12 words total → ig_static (not ig_meme, since > 8)
  assert.equal(recommendFormat(post), 'ig_static');
});

test('recommendFormat: story with reveal → tiktok_slideshow', () => {
  const post = {
    platform: 'tiktok',
    hook: 'I thought she was being defiant',
    caption: 'But then I realized she was overwhelmed. Turns out it was nervous system.',
    slides: [],
  };
  assert.equal(recommendFormat(post), 'tiktok_slideshow');
});

test('recommendFormat: avatar conversation → tiktok_avatar', () => {
  const post = {
    platform: 'tiktok',
    post_format: 'tiktok_avatar',
    hook: 'Okay wait',
    caption: 'Let me tell you',
    avatar_config: { clips: [{ type: 'avatar', purpose: 'hook' }, { type: 'avatar', purpose: 'cta' }] },
  };
  assert.equal(recommendFormat(post), 'tiktok_avatar');
});

test('validateFormat: ig_static with 180-char caption → caption_too_long', () => {
  const caption = 'x'.repeat(180);
  const errs = validateFormat({ post_format: 'ig_static', caption, slides: [{}] });
  assert.ok(errs.some((e) => e.startsWith('caption_too_long')));
});

test('validateFormat: ig_static with multiple slides → single-slide error', () => {
  const errs = validateFormat({
    post_format: 'ig_static',
    caption: 'short',
    slides: [{ slide_number: 1 }, { slide_number: 2 }],
  });
  assert.ok(errs.includes('ig_static_must_have_single_slide'));
});

test('validateFormat: ig_carousel with 2 slides → needs 3+ slides', () => {
  const errs = validateFormat({
    post_format: 'ig_carousel',
    caption: 'short',
    slides: [{ slide_number: 1 }, { slide_number: 2 }],
  });
  assert.ok(errs.some((e) => e.startsWith('ig_carousel_needs_')));
});

test('validateFormat: valid ig_carousel passes', () => {
  const errs = validateFormat({
    post_format: 'ig_carousel',
    caption: 'ok',
    slides: Array.from({ length: 5 }, (_, i) => ({ slide_number: i + 1 })),
  });
  assert.deepEqual(errs, []);
});

test('validateFormat: tiktok_slideshow caption > 100 → too long', () => {
  const errs = validateFormat({ post_format: 'tiktok_slideshow', caption: 'y'.repeat(120), slides: [{}, {}, {}] });
  assert.ok(errs.some((e) => e.startsWith('caption_too_long')));
});

test('CAPTION_MAX_BY_FORMAT has entries for every known format', () => {
  for (const fmt of ['ig_static', 'ig_carousel', 'tiktok_slideshow', 'tiktok_text', 'tiktok_avatar', 'tiktok_avatar_visual', 'ig_meme']) {
    assert.ok(typeof CAPTION_MAX_BY_FORMAT[fmt] === 'number', `cap for ${fmt}`);
  }
});

test('MIN_CAROUSEL_SLIDES = 3 (per spec)', () => {
  assert.equal(MIN_CAROUSEL_SLIDES, 3);
});
