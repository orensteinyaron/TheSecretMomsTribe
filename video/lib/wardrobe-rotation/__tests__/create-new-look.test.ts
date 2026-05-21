/**
 * Unit tests for assembleLookPrompt() — pure helper in create-new-look.ts.
 *
 * createNewLook() itself requires network / DI and is covered by Smoke 2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import from the pure helper to avoid pulling in the Supabase DB layer
// (which calls process.exit at module scope when env vars are missing).
import { assembleLookPrompt } from '../look-prompt.ts';

const CANON_TAIL =
  'warm natural light, half-smile resting expression, vertical 9:16 portrait, no airbrushing';

// ── Happy paths ───────────────────────────────────────────────────────────────

test('happy path: includes wardrobe, setting, and canon tail', () => {
  const result = assembleLookPrompt(
    'linen jumpsuit, low ponytail',
    'backyard porch, afternoon light',
  );
  assert.ok(result.includes('linen jumpsuit, low ponytail'), 'wardrobe missing');
  assert.ok(result.includes('backyard porch, afternoon light'), 'setting missing');
  assert.ok(result.includes(CANON_TAIL), 'canon tail missing');
});

test('happy path: no identity terms — floral blouse, cafe setting', () => {
  // Should NOT throw — no forbidden descriptors present.
  assert.doesNotThrow(() =>
    assembleLookPrompt('floral blouse', 'cafe with friends'),
  );
});

test('happy path: "olive" fabric color alone is fine', () => {
  // "olive linen" is a fabric color, not a skin descriptor — should not throw.
  assert.doesNotThrow(() =>
    assembleLookPrompt('olive linen jumpsuit', 'sunlit terrace'),
  );
});

// ── Forbidden-term guards ─────────────────────────────────────────────────────

test('forbidden: "olive skin" in wardrobe throws', () => {
  assert.throws(
    () => assembleLookPrompt('olive skin, casual outfit', 'kitchen'),
    /forbidden identity term/i,
  );
});

test('forbidden: "hair brown" (matches hair (color|brown|wavy)) in setting throws', () => {
  assert.throws(
    () => assembleLookPrompt('navy sweater', 'home, hair brown loosely styled'),
    /forbidden identity term/i,
  );
});

// ── New tokens: complexion, sun-kissed, tan(ned) ──────────────────────────────

test('forbidden: "complexion" in wardrobe throws', () => {
  assert.throws(
    () => assembleLookPrompt('fair complexion, floral dress', 'park'),
    /forbidden identity term/i,
  );
});

test('forbidden: "sun-kissed" in setting throws', () => {
  assert.throws(
    () => assembleLookPrompt('white linen top', 'sun-kissed beach background'),
    /forbidden identity term/i,
  );
});

test('forbidden: "sunkissed" (no hyphen) in setting throws', () => {
  assert.throws(
    () => assembleLookPrompt('denim jacket', 'sunkissed outdoor setting'),
    /forbidden identity term/i,
  );
});

test('forbidden: "tan" as standalone word throws', () => {
  assert.throws(
    () => assembleLookPrompt('tan complexion, casual shirt', 'studio'),
    /forbidden identity term/i,
  );
});

test('happy path: "tantalizing" does NOT trigger tan guard', () => {
  // \btan\b should not match "tantalizing"
  assert.doesNotThrow(() =>
    assembleLookPrompt('tantalizing floral print', 'garden party'),
  );
});

test('happy path: "tanned" as standalone word throws (skin descriptor)', () => {
  assert.throws(
    () => assembleLookPrompt('tanned arms visible', 'rooftop'),
    /forbidden identity term/i,
  );
});
