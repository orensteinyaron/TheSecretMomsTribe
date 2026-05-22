import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCombination } from '../pickers/pick-combination.js';
import type {
  RachelLook,
  RachelLocation,
  RachelStill,
  RecentLookPick,
  RecentLocationPick,
} from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLook(id: string): RachelLook {
  return {
    look_id: id,
    wardrobe: `wardrobe for ${id}`,
    hair: 'hair down',
    accessories: null,
    notes: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    approved_at: '2026-01-01T00:00:00Z',
    retired_at: null,
    created_by: 'test',
    source: 'canon_seed',
  };
}

function makePrimary(id: string): RachelLocation {
  return {
    location_id: id,
    name: `name_${id}`,
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, chest up',
    rachel_position: `position for ${id}`,
    background_composition: `background for ${id}`,
    lighting_setup: 'natural daylight',
    props: ['prop_a', 'prop_b'],
    wall_color: 'white',
    floor_material: 'wood',
    reference_image_url: null,
    reference_image_id: null,
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

function makeStill(lookId: string, locationId: string, stillId?: string): RachelStill {
  return {
    still_id: stillId ?? `still_${lookId}_${locationId}`,
    look_id: lookId,
    location_id: locationId,
    soul_still_id: 'soul-abc-123',
    soul_still_url: 'https://example.com/still.png',
    reference_image_url_used: 'https://example.com/canonical.png',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    approved_at: '2026-01-01T00:00:00Z',
    retired_at: null,
    created_by: 'test',
  };
}

const eleven = Array.from({ length: 11 }, (_, i) =>
  makeLook(`look_${String(i + 1).padStart(2, '0')}`),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('happy path: still exists for picked combo → returns needs_generation: false', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makePrimary('location_02')];
  const targetStill = makeStill('look_01', 'location_01', 'still-uuid-001');
  const activeStills = [targetStill];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks: [],
    recentLocationPicks: [],
  });

  // With empty histories: pickLook → look_01 (sorted asc, no history)
  // pickLocation → location_01 (primary, no history, sorted asc)
  assert.equal(result.look_id, 'look_01');
  assert.equal(result.location_id, 'location_01');
  assert.equal(result.needs_generation, false);
  assert.equal(result.still_id, 'still-uuid-001');
});

test('needs generation: no still for picked combo → returns needs_generation: true', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makePrimary('location_02')];
  // No still for (look_01, location_01)
  const activeStills: RachelStill[] = [];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks: [],
    recentLocationPicks: [],
  });

  assert.equal(result.look_id, 'look_01');
  assert.equal(result.location_id, 'location_01');
  assert.equal(result.needs_generation, true);
  assert.equal(result.still_id, null);
});

test('determinism: same input → same output', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makeSecondary('location_03')];
  const activeStills = [makeStill('look_01', 'location_01')];
  const recentLookPicks: RecentLookPick[] = [
    { look_id: 'look_03', used_at: '2026-05-19T10:00:00Z' },
  ];
  const recentLocationPicks: RecentLocationPick[] = [
    { location_id: 'location_03', tier: 'secondary', used_at: '2026-05-19T09:00:00Z' },
  ];

  const input = {
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks,
    recentLocationPicks,
  };

  const a = pickCombination(input);
  const b = pickCombination(input);
  assert.deepEqual(a, b);
});

test('integration: LRU and tier-ratio both fire correctly across 5+ sequential picks', () => {
  // 3 looks, 2 locations (1 primary, 1 secondary), empty stills
  const looks = [makeLook('look_01'), makeLook('look_02'), makeLook('look_03')];
  const locations = [makePrimary('location_01'), makeSecondary('location_02')];
  const activeStills: RachelStill[] = [];

  const lookHistory: RecentLookPick[] = [];
  const locationHistory: RecentLocationPick[] = [];
  const picks: Array<{ look_id: string; location_id: string }> = [];

  for (let i = 0; i < 7; i++) {
    const result = pickCombination({
      activeLooks: looks,
      activeLocations: locations,
      activeStills,
      recentLookPicks: lookHistory,
      recentLocationPicks: locationHistory,
    });

    picks.push({ look_id: result.look_id, location_id: result.location_id });

    const usedAt = new Date(1000000 + i * 1000).toISOString();
    lookHistory.unshift({ look_id: result.look_id, used_at: usedAt });
    const tier = locations.find((l) => l.location_id === result.location_id)!.tier;
    locationHistory.unshift({ location_id: result.location_id, tier, used_at: usedAt });
  }

  // Verify look LRU: no consecutive repeat within 3 picks (cooldown=3 with only 3 looks
  // means degenerate fallback is expected — but no consecutive repeat at minimum)
  for (let i = 1; i < picks.length; i++) {
    assert.notEqual(picks[i].look_id, picks[i - 1].look_id, `consecutive look repeat at pick ${i}`);
  }

  // Verify tier ratio: over 7 picks with 1 primary and 1 secondary, primaries should
  // dominate early (ratio seeks 5/7 primary)
  const primaryCount = picks.filter((p) => {
    const loc = locations.find((l) => l.location_id === p.location_id)!;
    return loc.tier === 'primary';
  }).length;
  // With only 1 primary and 1 secondary, ratio target of 5/7 means primary should be
  // picked at least 4 out of 7 times (ratio pressure pushes toward primary whenever below threshold)
  assert.ok(primaryCount >= 4, `expected ≥4 primary picks, got ${primaryCount}`);
});

test('zero active looks → throws (delegated to pickLook)', () => {
  assert.throws(
    () =>
      pickCombination({
        activeLooks: [],
        activeLocations: [makePrimary('location_01')],
        activeStills: [],
        recentLookPicks: [],
        recentLocationPicks: [],
      }),
    /pickLook: no active looks available/,
  );
});
