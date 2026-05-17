/**
 * Tests for the live content generation user prompt.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): the prompt asks the LLM for
 * `render_profile_slug` + `channels` and explicitly forbids legacy
 * `post_format` / inline channel columns. Caps are keyed by render
 * profile slug (CAPTION_MAX_BY_SLUG) — not by the legacy post_format.
 *
 * Pins the length discipline that keeps Sonnet from producing over-cap
 * captions — same pattern the regen script uses, which runs in-limit.
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

test('prompt: explicit per-slug char caps in the caption schema line', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /static-image[^\n]*200/);
  assert.match(prompt, /carousel[^\n]*400/);
  assert.match(prompt, /moving-images[^\n]*300/);
});

test('prompt: REJECTED threat language is present', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /REJECTED/);
});

test('prompt: contradictory "100-180 words" rule is gone', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.doesNotMatch(prompt, /100-180 words/);
});

test('prompt: all render profile slugs are enumerated in the caps block', () => {
  const prompt = buildUserPrompt(stubParams());
  for (const slug of ['static-image', 'moving-images', 'carousel', 'avatar-v1']) {
    assert.match(prompt, new RegExp(`${slug}[^\\n]*≤\\d+ chars`), `caps block lists ${slug}`);
  }
});

test('prompt: caps block lists TARGET alongside cap (PR #13 headroom)', () => {
  const prompt = buildUserPrompt(stubParams());
  // target = 80% of cap, rounded — e.g. static-image cap 200 → target 160.
  assert.match(prompt, /static-image:\s*target\s*≤160[^\n]*hard cap\s*≤200/);
  assert.match(prompt, /moving-images:\s*target\s*≤240[^\n]*hard cap\s*≤300/);
  assert.match(prompt, /carousel:\s*target\s*≤320[^\n]*hard cap\s*≤400/);
});

test('prompt: schema caption field restates target/cap for every slug', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /"caption":[\s\S]*TARGET[\s\S]*cap\s*≤/);
  assert.match(prompt, /static-image:\s*target\s*≤160,\s*cap\s*≤200/);
});

test('prompt: asks for render_profile_slug, never a post_format JSON key', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /render_profile_slug/);
  // The output schema must NOT use post_format as a key. (The fail-closed
  // disclaimer DOES mention the word post_format as a forbidden field
  // — that's fine; what matters is the schema example.)
  assert.doesNotMatch(prompt, /"post_format":/);
});

test('prompt: asks for channels array defaulting to [tiktok, instagram]', () => {
  const prompt = buildUserPrompt(stubParams());
  assert.match(prompt, /channels/);
  // Default channel set must be clearly documented.
  assert.match(prompt, /tiktok[\s\S]*instagram|instagram[\s\S]*tiktok/);
});

test('prompt: fail-closed disclaimer for legacy v1.0.0 fields', () => {
  const prompt = buildUserPrompt(stubParams());
  // rejectLegacyFormatFields catches these — the prompt warns the LLM upfront.
  assert.match(prompt, /Do NOT emit/);
  assert.match(prompt, /scheduled_at_ig/);
  assert.match(prompt, /channel_override/);
});
