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
