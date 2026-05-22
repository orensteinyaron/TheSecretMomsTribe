import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLocation,
  PRIMARY_LOCATION_RATIO,
  LOCATION_COOLDOWN_WITHIN_TIER,
  LOCATION_RATIO_WINDOW,
} from '../pickers/pick-location.js';
import type { RachelLocation, RecentLocationPick } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePrimary(id: string): RachelLocation {
  return {
    location_id: id,
    setting: `setting for ${id}`,
    lighting: 'natural',
    framing: 'medium shot',
    tier: 'primary',
    notes: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    approved_at: '2026-01-01T00:00:00Z',
    retired_at: null,
    created_by: 'test',
    source: 'canon_seed',
  };
}

function makeSecondary(id: string): RachelLocation {
  return { ...makePrimary(id), tier: 'secondary' };
}

function pick(
  locationId: string,
  tier: 'primary' | 'secondary',
  usedAt: string,
): RecentLocationPick {
  return { location_id: locationId, tier, used_at: usedAt };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('constants: PRIMARY_LOCATION_RATIO === 5/7, LOCATION_COOLDOWN_WITHIN_TIER === 1, LOCATION_RATIO_WINDOW === 7', () => {
  assert.equal(PRIMARY_LOCATION_RATIO, 5 / 7);
  assert.equal(LOCATION_COOLDOWN_WITHIN_TIER, 1);
  assert.equal(LOCATION_RATIO_WINDOW, 7);
});

test('empty history + 2 active primaries → returns first primary by location_id (location_01)', () => {
  const active = [makePrimary('location_01'), makePrimary('location_02')];
  assert.equal(pickLocation(active, []), 'location_01');
});

test('empty history + only secondary actives → fallback returns a secondary', () => {
  const active = [makeSecondary('location_03'), makeSecondary('location_04')];
  // Empty history → currentRatio = 0 < 5/7 → want primary, but none available → fallback to secondary
  const result = pickLocation(active, []);
  assert.ok(
    result === 'location_03' || result === 'location_04',
    `expected a secondary location, got ${result}`,
  );
});

test('recent ratio 4/7 primary → next pick must be primary', () => {
  // 4 primaries + 3 secondaries in last 7 picks → ratio = 4/7 < 5/7 → want primary
  const now = 1000000;
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_01', 'primary', new Date(now + 1).toISOString()),
    pick('location_02', 'primary', new Date(now + 2).toISOString()),
    pick('location_01', 'primary', new Date(now + 3).toISOString()),
    pick('location_02', 'primary', new Date(now + 4).toISOString()),
    pick('location_03', 'secondary', new Date(now + 5).toISOString()),
    pick('location_03', 'secondary', new Date(now + 6).toISOString()),
    pick('location_03', 'secondary', new Date(now + 7).toISOString()),
  ];
  const active = [
    makePrimary('location_01'),
    makePrimary('location_02'),
    makeSecondary('location_03'),
  ];
  const result = pickLocation(active, recentlyUsed);
  // The result must come from primary tier
  const resultTier = active.find((l) => l.location_id === result)!.tier;
  assert.equal(resultTier, 'primary');
});

test('recent ratio 5/7 primary → next pick must be secondary (at-threshold)', () => {
  // 5 primaries + 2 secondaries in last 7 picks → ratio = 5/7 → at-threshold → push to secondary
  const now = 1000000;
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_01', 'primary', new Date(now + 1).toISOString()),
    pick('location_01', 'primary', new Date(now + 2).toISOString()),
    pick('location_01', 'primary', new Date(now + 3).toISOString()),
    pick('location_01', 'primary', new Date(now + 4).toISOString()),
    pick('location_01', 'primary', new Date(now + 5).toISOString()),
    pick('location_03', 'secondary', new Date(now + 6).toISOString()),
    pick('location_04', 'secondary', new Date(now + 7).toISOString()),
  ];
  const active = [
    makePrimary('location_01'),
    makePrimary('location_02'),
    makeSecondary('location_03'),
    makeSecondary('location_04'),
  ];
  const result = pickLocation(active, recentlyUsed);
  const resultTier = active.find((l) => l.location_id === result)!.tier;
  assert.equal(resultTier, 'secondary');
});

test('recent ratio 6/7 primary → next pick must be secondary', () => {
  const now = 1000000;
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_01', 'primary', new Date(now + 1).toISOString()),
    pick('location_01', 'primary', new Date(now + 2).toISOString()),
    pick('location_01', 'primary', new Date(now + 3).toISOString()),
    pick('location_01', 'primary', new Date(now + 4).toISOString()),
    pick('location_01', 'primary', new Date(now + 5).toISOString()),
    pick('location_01', 'primary', new Date(now + 6).toISOString()),
    pick('location_03', 'secondary', new Date(now + 7).toISOString()),
  ];
  const active = [
    makePrimary('location_01'),
    makePrimary('location_02'),
    makeSecondary('location_03'),
  ];
  const result = pickLocation(active, recentlyUsed);
  const resultTier = active.find((l) => l.location_id === result)!.tier;
  assert.equal(resultTier, 'secondary');
});

test('within-tier cooldown: 2 active primaries, last pick was location_01 → next primary pick must be location_02', () => {
  const now = 1000000;
  // ratio: 2/7 primaries in window → want primary
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_03', 'secondary', new Date(now + 1).toISOString()),
    pick('location_03', 'secondary', new Date(now + 2).toISOString()),
    pick('location_03', 'secondary', new Date(now + 3).toISOString()),
    pick('location_03', 'secondary', new Date(now + 4).toISOString()),
    pick('location_03', 'secondary', new Date(now + 5).toISOString()),
    pick('location_01', 'primary', new Date(now + 6).toISOString()),
    pick('location_02', 'primary', new Date(now + 7).toISOString()),
    // Most recent primary pick is location_02, so location_02 is blocked within-tier
    pick('location_01', 'primary', new Date(now + 8).toISOString()),
  ];
  // Last primary pick is location_01 (most recent) → blocked. location_02 is the candidate.
  const active = [makePrimary('location_01'), makePrimary('location_02')];
  // Adjust: ratio in last 7 = 3 primaries out of 7 = 3/7 < 5/7 → want primary
  // Rebuild to make ratio clearly < 5/7 with last primary being location_01
  const recent2: RecentLocationPick[] = [
    pick('location_03', 'secondary', new Date(now + 1).toISOString()),
    pick('location_03', 'secondary', new Date(now + 2).toISOString()),
    pick('location_03', 'secondary', new Date(now + 3).toISOString()),
    pick('location_03', 'secondary', new Date(now + 4).toISOString()),
    pick('location_03', 'secondary', new Date(now + 5).toISOString()),
    pick('location_02', 'primary', new Date(now + 6).toISOString()),
    pick('location_01', 'primary', new Date(now + 7).toISOString()),
  ];
  // Window[0..6]: 2 primaries, 5 secondary → ratio = 2/7 < 5/7 → want primary
  // Last primary pick: location_01 (index 6, most recent) → blocked
  // candidates = [location_02]
  const result = pickLocation(active, recent2);
  assert.equal(result, 'location_02');
});

test('no active in required tier → fallback to other tier', () => {
  // Ratio is 0/7 (all secondary) → want primary, but no primaries active → fallback to secondary
  const now = 1000000;
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_03', 'secondary', new Date(now + 1).toISOString()),
    pick('location_03', 'secondary', new Date(now + 2).toISOString()),
    pick('location_03', 'secondary', new Date(now + 3).toISOString()),
    pick('location_03', 'secondary', new Date(now + 4).toISOString()),
    pick('location_03', 'secondary', new Date(now + 5).toISOString()),
    pick('location_03', 'secondary', new Date(now + 6).toISOString()),
    pick('location_03', 'secondary', new Date(now + 7).toISOString()),
  ];
  // Only secondaries active
  const active = [makeSecondary('location_03'), makeSecondary('location_04')];
  const result = pickLocation(active, recentlyUsed);
  assert.ok(
    result === 'location_03' || result === 'location_04',
    `expected secondary fallback, got ${result}`,
  );
});

test('determinism: same inputs → same output', () => {
  const now = 1000000;
  const recentlyUsed: RecentLocationPick[] = [
    pick('location_01', 'primary', new Date(now + 1).toISOString()),
    pick('location_03', 'secondary', new Date(now + 2).toISOString()),
    pick('location_02', 'primary', new Date(now + 3).toISOString()),
  ];
  const active = [
    makePrimary('location_01'),
    makePrimary('location_02'),
    makeSecondary('location_03'),
  ];
  const a = pickLocation(active, recentlyUsed);
  const b = pickLocation(active, recentlyUsed);
  assert.equal(a, b);
});

test('tie-break: equal recency in tier → ascending location_id', () => {
  // 2 primaries, never used → both never-used → tie → ascending id → location_01
  const active = [makePrimary('location_02'), makePrimary('location_01')];
  const result = pickLocation(active, []);
  assert.equal(result, 'location_01');
});
