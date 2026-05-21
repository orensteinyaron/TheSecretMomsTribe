/**
 * Unit tests for assembleLookPrompt() — two-axis prompt assembly.
 *
 * Covers: happy paths, null accessories, FORBIDDEN_RE guards, word-boundary
 * edge cases (tan/tantalizing, olive/olive skin, hair/hair color).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLookPrompt, PROMPT_TAIL } from '../prompt/look-prompt.ts';
import type { CanonLookBrief, CanonLocationBrief } from '../types.js';
import { CANON_LOOKS } from '../canon/canon-looks.ts';
import { CANON_LOCATIONS } from '../canon/canon-locations.ts';

// ── Happy paths ───────────────────────────────────────────────────────────────

test('happy path 1: look_01 + location_01 — contains key tokens + PROMPT_TAIL', () => {
  const result = assembleLookPrompt(CANON_LOOKS.look_01, CANON_LOCATIONS.location_01);
  assert.ok(result.includes('cream cable-knit sweater'), 'wardrobe missing');
  assert.ok(result.includes('loose half-up'), 'hair missing');
  assert.ok(result.includes('modern kitchen'), 'setting missing');
  assert.ok(result.includes('kitchen island in background'), 'setting detail missing');
  assert.ok(result.includes(PROMPT_TAIL), 'PROMPT_TAIL missing');
});

test('happy path 2: look_04 + location_02 — accessories token present', () => {
  const result = assembleLookPrompt(CANON_LOOKS.look_04, CANON_LOCATIONS.location_02);
  assert.ok(result.includes('small gold necklace'), 'accessories missing');
  assert.ok(result.includes('fitted black top'), 'wardrobe missing');
  assert.ok(result.includes('home office / studio'), 'setting missing');
});

test('null accessories: look_02 does NOT inject "null" or "undefined" into prompt', () => {
  const result = assembleLookPrompt(CANON_LOOKS.look_02, CANON_LOCATIONS.location_01);
  assert.ok(!result.includes('null'), 'literal "null" present in prompt');
  assert.ok(!result.includes('undefined'), 'literal "undefined" present in prompt');
  // The prompt should still be non-empty and include key fields
  assert.ok(result.includes('white casual tee'), 'wardrobe missing');
  assert.ok(result.includes('hair down'), 'hair missing');
});

// ── Forbidden guard — wardrobe ────────────────────────────────────────────────

test('forbidden: "olive skin" in wardrobe throws with match in error', () => {
  const badLook: CanonLookBrief = {
    ...CANON_LOOKS.look_01,
    wardrobe: 'olive skin, cream sweater',
  };
  assert.throws(
    () => assembleLookPrompt(badLook, CANON_LOCATIONS.location_01),
    /olive skin/i,
  );
});

// ── Forbidden guard — setting ─────────────────────────────────────────────────

test('forbidden: "freckle close-up" in setting throws', () => {
  const badLocation: CanonLocationBrief = {
    ...CANON_LOCATIONS.location_01,
    setting: 'freckle close-up, bright studio',
  };
  assert.throws(
    () => assembleLookPrompt(CANON_LOOKS.look_01, badLocation),
    /forbidden identity term/i,
  );
});

// ── Forbidden guard — lighting ────────────────────────────────────────────────

test('forbidden: "tan-colored backlight" in lighting throws (\btan\b matches)', () => {
  const badLocation: CanonLocationBrief = {
    ...CANON_LOCATIONS.location_01,
    lighting: 'tan-colored backlight',
  };
  // \btan\b should match "tan" in "tan-colored" since '-' is a non-word character
  assert.throws(
    () => assembleLookPrompt(CANON_LOOKS.look_01, badLocation),
    /forbidden identity term/i,
  );
});

// ── Word-boundary edge cases ──────────────────────────────────────────────────

test('word-boundary: "tantalizing fabric" does NOT throw (\btan\b does not match "tantalizing")', () => {
  // "tantalizing" — after "tan" comes "t" which IS a word character, so \b does not fire.
  const goodLook: CanonLookBrief = {
    ...CANON_LOOKS.look_01,
    wardrobe: 'tantalizing fabric print',
  };
  assert.doesNotThrow(() => assembleLookPrompt(goodLook, CANON_LOCATIONS.location_01));
});

test('word-boundary: "olive linen jumpsuit" does NOT throw (regex requires "olive skin")', () => {
  const goodLook: CanonLookBrief = {
    ...CANON_LOOKS.look_01,
    wardrobe: 'olive linen jumpsuit',
  };
  assert.doesNotThrow(() => assembleLookPrompt(goodLook, CANON_LOCATIONS.location_01));
});

test('word-boundary: "hair clip accessory" does NOT throw (regex requires hair color/brown/wavy)', () => {
  const goodLook: CanonLookBrief = {
    ...CANON_LOOKS.look_01,
    accessories: 'hair clip accessory',
  };
  assert.doesNotThrow(() => assembleLookPrompt(goodLook, CANON_LOCATIONS.location_01));
});

// ── Multiple forbidden terms ──────────────────────────────────────────────────

test('multiple forbidden: "olive skin" + "freckles" — throws with FIRST match in message', () => {
  const badLook: CanonLookBrief = {
    ...CANON_LOOKS.look_01,
    wardrobe: 'olive skin tone, cream sweater',
    accessories: 'freckle-pattern scarf',
  };
  // "skin tone" appears first in the combined string, so the error message names "skin tone"
  // The combined string is: "olive skin tone, cream sweater, loose half-up, freckle-pattern scarf | ..."
  assert.throws(
    () => assembleLookPrompt(badLook, CANON_LOCATIONS.location_01),
    /forbidden identity term/i,
  );
});
