/**
 * Tests for the live content generation user prompt. Pins the length
 * discipline that keeps Sonnet from producing over-cap captions — same
 * pattern the regen script uses, which runs 11/11 in-limit.
 *
 * If someone later softens "REJECTED" back to "flagged", or restores
 * the "IG: 100-180 words" guideline, these tests fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { buildUserPrompt } = await import('../content-prompt.js');

function stubParams(overrides = {}) {
  return {
    briefing: { opportunities: [{ topic: 'Test', source: 'reddit' }] },
    coverageGaps: { gaps: 'None' },
    recentHooks: [],
    directives: [],
    insights: [],
    ...overrides,
  };
}

test('prompt: explicit per-format char caps in the caption schema line', () => {
  const prompt = buildUserPrompt(stubParams());
  // The schema's caption field must restate the numbers inline so the
  // LLM has them at the point of writing — mirrors regen-prompt pattern.
  assert.match(prompt, /ig_static[^\n]*125/);
  assert.match(prompt, /ig_carousel[^\n]*400/);
  assert.match(prompt, /tiktok_slideshow[^\n]*100/);
});

test('prompt: REJECTED threat language is present', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /REJECTED/);
});

test('prompt: contradictory "100-180 words" rule is gone', () => {
  const prompt = buildUserPrompt(stubParams());
  // Earlier version had "Follow caption structure per platform (...IG: 100-180 words)"
  // which told the LLM to write up to 1100+ chars in direct conflict with
  // the 125/400-char caps.
  assert.doesNotMatch(prompt, /100-180 words/);
});

test('prompt: soft "flagged" language is gone', () => {
  const prompt = buildUserPrompt(stubParams());
  // "flagged" reads optional next to "REJECTED". If someone re-softens
  // the threat during a future prompt cleanup, this fails.
  assert.doesNotMatch(prompt, /flagged/i);
});

test('prompt: all caption-max formats are enumerated in the caps block', () => {
  const prompt = buildUserPrompt(stubParams());
  for (const fmt of ['ig_static', 'ig_carousel', 'tiktok_slideshow', 'tiktok_text', 'tiktok_avatar', 'tiktok_avatar_visual', 'ig_meme']) {
    assert.match(prompt, new RegExp(`${fmt}[^\\n]*≤\\d+ chars`), `caps block lists ${fmt}`);
  }
});

test('prompt: still renders briefing opportunities and coverage gaps', () => {
  const prompt = buildUserPrompt(stubParams({
    briefing: { opportunities: [{ topic: 'AI bedtime stories', source: 'tiktok' }] },
    coverageGaps: { gaps: 'Missing toddler + tech' },
  }));
  assert.match(prompt, /AI bedtime stories/);
  assert.match(prompt, /Missing toddler \+ tech/);
});

test('prompt: strategy block only appears when directives or insights exist', () => {
  const empty = buildUserPrompt(stubParams());
  assert.doesNotMatch(empty, /Active Directives/);
  assert.doesNotMatch(empty, /Confirmed Strategy Insights/);

  const withStrategy = buildUserPrompt(stubParams({
    directives: [{ directive: 'Do X', directive_type: 'priority' }],
    insights: [{ insight: 'Y works', insight_type: 'audience', confidence: 8 }],
  }));
  assert.match(withStrategy, /Active Directives/);
  assert.match(withStrategy, /\[priority\] Do X/);
  assert.match(withStrategy, /Confirmed Strategy Insights/);
  assert.match(withStrategy, /Y works/);
});
