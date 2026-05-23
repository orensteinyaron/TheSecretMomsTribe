import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANON_LOCATIONS } from '../canon/canon-locations.ts';
import { assembleCanonicalBootstrapPrompt } from '../prompt/canonical-bootstrap-prompt.ts';
import type { CanonLocationBrief } from '../types.js';

test('happy path: location_01 produces prompt with kitchen island, 60% width, no ceiling', () => {
  const prompt = assembleCanonicalBootstrapPrompt(CANON_LOCATIONS.location_01!);
  assert.match(prompt, /kitchen island/);
  assert.match(prompt, /60% of the frame WIDTH/);
  assert.match(prompt, /NO ceiling visible/);
});

test('framing rules always present: width/height/bottom-band/no-ceiling/no-lamps/no-near-edge', () => {
  for (const id of ['location_01', 'location_02'] as const) {
    const prompt = assembleCanonicalBootstrapPrompt(CANON_LOCATIONS[id]!);
    assert.match(prompt, /60% of the frame WIDTH/, `${id}: width`);
    assert.match(prompt, /60-70% of the frame HEIGHT/, `${id}: height`);
    assert.match(prompt, /LESS than 20% of frame height/, `${id}: bottom band`);
    assert.match(prompt, /NO ceiling visible/, `${id}: ceiling`);
    assert.match(prompt, /NO pendant lamps visible/, `${id}: lamps`);
    assert.match(prompt, /no near edge visible/, `${id}: near edge`);
  }
});

test('THIS EXACT ${loc.name} anchor is always present', () => {
  for (const id of ['location_01', 'location_02'] as const) {
    const loc = CANON_LOCATIONS[id]!;
    const prompt = assembleCanonicalBootstrapPrompt(loc);
    assert.ok(
      prompt.includes(`THIS EXACT ${loc.name} from the reference image`),
      `${id}: missing THIS EXACT anchor for "${loc.name}"`,
    );
  }
});

test('throws when background_composition is tampered with "olive skin"', () => {
  const tampered: CanonLocationBrief = {
    ...CANON_LOCATIONS.location_01!,
    background_composition: 'olive skin tone, kitchen counters',
  };
  assert.throws(
    () => assembleCanonicalBootstrapPrompt(tampered),
    /forbidden identity term/i,
  );
});

test('throws when lighting_setup contains "freckles"', () => {
  const tampered: CanonLocationBrief = {
    ...CANON_LOCATIONS.location_01!,
    lighting_setup: 'bright daylight, freckles preserved',
  };
  assert.throws(
    () => assembleCanonicalBootstrapPrompt(tampered),
    /forbidden identity term/i,
  );
});

test('surface phrase: location_01 → "marble island"; location_02 → "wooden desk"', () => {
  const kitchen = assembleCanonicalBootstrapPrompt(CANON_LOCATIONS.location_01!);
  const studio = assembleCanonicalBootstrapPrompt(CANON_LOCATIONS.location_02!);
  // The bottom-of-frame sentence mentions the surface explicitly.
  assert.match(kitchen, /the marble island top is a thin horizontal band/);
  assert.match(studio, /the wooden desk top is a thin horizontal band/);
  // And the inverse should NOT appear in each case.
  assert.ok(!/the wooden desk top is a thin horizontal band/.test(kitchen));
  assert.ok(!/the marble island top is a thin horizontal band/.test(studio));
});
