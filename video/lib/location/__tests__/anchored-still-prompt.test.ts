import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANON_LOOKS } from '../../wardrobe-rotation/canon/canon-looks.ts';
import { assembleAnchoredStillPrompt } from '../prompt/anchored-still-prompt.ts';
import type { RachelLook } from '../../wardrobe-rotation/types.js';

// Helper: build a minimal RachelLook from a CanonLookBrief for tests.
function makeLook(
  look_id: string,
  overrides: Partial<RachelLook> = {},
): RachelLook {
  const brief = CANON_LOOKS[look_id]!;
  return {
    look_id,
    wardrobe: brief.wardrobe,
    hair: brief.hair,
    accessories: brief.accessories,
    notes: null,
    status: 'active',
    created_at: '2026-05-22T00:00:00Z',
    approved_at: '2026-05-22T00:00:00Z',
    retired_at: null,
    created_by: 'test',
    source: 'canon_seed',
    ...overrides,
  };
}

test('happy path: look_01 (cream cable-knit) prompt contains wardrobe + framing reminder', () => {
  const prompt = assembleAnchoredStillPrompt(makeLook('look_01'));
  assert.match(prompt, /cream cable-knit sweater/);
  // Framing reminder
  assert.match(prompt, /~60% width and ~60-70% height/);
  assert.match(prompt, /Surface band at the bottom/);
  assert.match(prompt, /No ceiling, no pendant lamps/);
});

test('null accessories: no literal "null" or "undefined" appears (look_01)', () => {
  const look = makeLook('look_01');
  assert.equal(look.accessories, null, 'precondition: look_01 has accessories=null');
  const prompt = assembleAnchoredStillPrompt(look);
  assert.ok(!prompt.includes('null'), 'prompt must not contain "null"');
  assert.ok(!prompt.includes('undefined'), 'prompt must not contain "undefined"');
});

test('non-null accessories: token appears in the wardrobe phrase (look_04 → "small gold necklace")', () => {
  const look = makeLook('look_04');
  assert.ok(look.accessories && look.accessories.length > 0, 'precondition: look_04 has accessories');
  const prompt = assembleAnchoredStillPrompt(look);
  assert.ok(prompt.includes(look.accessories!), `prompt must include accessories token "${look.accessories}"`);
});

test('prompt is SHORT — total length < 600 characters', () => {
  for (const look_id of ['look_01', 'look_02', 'look_03', 'look_04', 'look_05']) {
    const prompt = assembleAnchoredStillPrompt(makeLook(look_id));
    assert.ok(
      prompt.length < 600,
      `${look_id}: prompt length ${prompt.length} must be < 600`,
    );
  }
});

test('throws when look.wardrobe is tampered to contain "olive skin"', () => {
  const tampered = makeLook('look_01', { wardrobe: 'olive skin tone, cream sweater' });
  assert.throws(
    () => assembleAnchoredStillPrompt(tampered),
    /forbidden identity term/i,
  );
});

test('output contains "ONLY difference" emphasizing wardrobe-only change', () => {
  const prompt = assembleAnchoredStillPrompt(makeLook('look_02'));
  assert.match(prompt, /ONLY difference/);
});
