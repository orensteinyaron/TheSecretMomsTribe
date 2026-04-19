/**
 * Tests for the single source of truth on content pillar names.
 *
 * Context: migration 20260418171805_enforce_pillar_taxonomy_v11
 * standardized content_queue.content_pillar to V1.1 canonical names:
 *   parenting, health, ai_magic, tech, trending, financial, uncategorized
 *
 * The agent previously emitted V1.0 long names (parenting_insights,
 * mom_health, tech_for_moms, trending_culture) which made every
 * INSERT fail the pillar_taxonomy check constraint.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VALID_PILLARS, LEGACY_TO_V11, normalizePillar } from '../pillars.js';

test('VALID_PILLARS exposes exactly the V1.1 canonical set', () => {
  assert.deepEqual(
    [...VALID_PILLARS].sort(),
    ['ai_magic', 'financial', 'health', 'parenting', 'tech', 'trending', 'uncategorized'].sort(),
  );
});

test('VALID_PILLARS never contains legacy V1.0 names', () => {
  for (const legacy of ['parenting_insights', 'mom_health', 'tech_for_moms', 'trending_culture']) {
    assert.ok(!VALID_PILLARS.includes(legacy), `VALID_PILLARS must not contain "${legacy}"`);
  }
});

test('LEGACY_TO_V11 maps every known V1.0 long name to a valid V1.1 short name', () => {
  assert.equal(LEGACY_TO_V11.parenting_insights, 'parenting');
  assert.equal(LEGACY_TO_V11.mom_health, 'health');
  assert.equal(LEGACY_TO_V11.tech_for_moms, 'tech');
  assert.equal(LEGACY_TO_V11.trending_culture, 'trending');
  for (const target of Object.values(LEGACY_TO_V11)) {
    assert.ok(VALID_PILLARS.includes(target), `mapping target "${target}" must be a valid pillar`);
  }
});

test('normalizePillar: V1.1 canonical passes through unchanged', () => {
  for (const p of VALID_PILLARS) {
    const out = normalizePillar(p);
    assert.equal(out.pillar, p);
    assert.equal(out.remapped, false);
  }
});

test('normalizePillar: V1.0 legacy names get remapped with remapped=true and legacy_value set', () => {
  const out = normalizePillar('parenting_insights');
  assert.equal(out.pillar, 'parenting');
  assert.equal(out.remapped, true);
  assert.equal(out.legacy_value, 'parenting_insights');
});

test('normalizePillar: unknown value falls back to uncategorized + remapped flag', () => {
  const out = normalizePillar('something_weird');
  assert.equal(out.pillar, 'uncategorized');
  assert.equal(out.remapped, true);
  assert.equal(out.legacy_value, 'something_weird');
});

test('normalizePillar: null / empty / non-string → uncategorized', () => {
  assert.equal(normalizePillar(null).pillar, 'uncategorized');
  assert.equal(normalizePillar('').pillar, 'uncategorized');
  assert.equal(normalizePillar(undefined).pillar, 'uncategorized');
  assert.equal(normalizePillar(42).pillar, 'uncategorized');
});
