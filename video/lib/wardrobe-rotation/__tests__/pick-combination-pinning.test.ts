// YAR-146 — pickCombination honors pre-pinned look_id / location_id.
// A pinned id SKIPS the LRU pick for that dimension; LRU fills only the
// null dimension(s). A pin to an id not in the active set throws.

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

// ── Fixtures (mirrors pick-combination.test.ts conventions) ────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────

test('pin look only (valid): pinned look honored, location filled by LRU', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makeSecondary('location_02')];
  const activeStills: RachelStill[] = [];

  // Recency biases the LRU LOOK pick toward look_01 (oldest), but the pin
  // must win — proving the look LRU was skipped. Location has no history, so
  // pickLocation deterministically returns the primary location_01.
  const recentLookPicks: RecentLookPick[] = [];
  const recentLocationPicks: RecentLocationPick[] = [];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks,
    recentLocationPicks,
    pinnedLookId: 'look_07',
  });

  assert.equal(result.look_id, 'look_07', 'pinned look must be honored verbatim');
  // pickLocation with empty history → primary, sorted asc → location_01
  assert.equal(result.location_id, 'location_01', 'location LRU should still run');
  assert.equal(result.needs_generation, true);
  assert.equal(result.still_id, null);
});

test('pin location only (valid): pinned location honored, look filled by LRU', () => {
  const activeLooks = eleven;
  // Two primaries; LRU with empty history picks location_01. Pin location_05
  // to prove the location LRU was skipped.
  const activeLocations = [makePrimary('location_01'), makePrimary('location_05')];
  const activeStills: RachelStill[] = [];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks: [],
    recentLocationPicks: [],
    pinnedLocationId: 'location_05',
  });

  // pickLook with empty history → sorted asc → look_01
  assert.equal(result.look_id, 'look_01', 'look LRU should still run');
  assert.equal(result.location_id, 'location_05', 'pinned location must be honored verbatim');
});

test('pin both (valid): both honored, still match found', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makePrimary('location_05')];
  const targetStill = makeStill('look_07', 'location_05', 'still-uuid-pinned');
  const activeStills = [targetStill];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks: [],
    recentLocationPicks: [],
    pinnedLookId: 'look_07',
    pinnedLocationId: 'location_05',
  });

  assert.equal(result.look_id, 'look_07');
  assert.equal(result.location_id, 'location_05');
  assert.equal(result.needs_generation, false);
  assert.equal(result.still_id, 'still-uuid-pinned');
});

test('null pin (e.g. JSON null in avatar_config) → LRU fills, no throw', () => {
  const activeLooks = eleven;
  const activeLocations = [makePrimary('location_01'), makePrimary('location_05')];

  const result = pickCombination({
    activeLooks,
    activeLocations,
    activeStills: [],
    recentLookPicks: [],
    recentLocationPicks: [],
    // A JSON null flowing through the ?: string type — must be treated as
    // "not pinned" (LRU fills), NOT a pin to the id "null".
    pinnedLookId: null as unknown as string,
    pinnedLocationId: null as unknown as string,
  });

  // Empty history → pickLook → look_01, pickLocation → location_01.
  assert.equal(result.look_id, 'look_01');
  assert.equal(result.location_id, 'location_01');
});

test('pin unknown look id → throws', () => {
  assert.throws(
    () =>
      pickCombination({
        activeLooks: eleven,
        activeLocations: [makePrimary('location_01')],
        activeStills: [],
        recentLookPicks: [],
        recentLocationPicks: [],
        pinnedLookId: 'look_99',
      }),
    /pinned look_id look_99 is not an active look/,
  );
});

test('pin inactive/unknown location id → throws', () => {
  assert.throws(
    () =>
      pickCombination({
        activeLooks: eleven,
        activeLocations: [makePrimary('location_01')],
        activeStills: [],
        recentLookPicks: [],
        recentLocationPicks: [],
        pinnedLocationId: 'location_99',
      }),
    /pinned location_id location_99 is not an active location/,
  );
});
