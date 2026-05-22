import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retireLocation } from '../flows/retire-location.ts';
import type { RetireLocationDeps } from '../flows/retire-location.ts';
import type {
  RachelLocation,
  RachelLookStatus,
  LocationTier,
} from '../../wardrobe-rotation/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLocationRow(overrides: Partial<RachelLocation> = {}): RachelLocation {
  return {
    location_id: 'location_01',
    name: 'kitchen',
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, chest up',
    rachel_position: 'standing behind island',
    background_composition: 'cooktop visible',
    lighting_setup: 'bright daylight',
    props: ['white marble island'],
    wall_color: 'soft white',
    floor_material: 'light oak hardwood',
    reference_image_url: 'https://higgsfield.example/locked.jpg',
    reference_image_id: 'job_canonical',
    tier: 'primary',
    notes: null,
    status: 'active',
    created_at: '2026-05-22T00:00:00.000Z',
    approved_at: '2026-05-22T00:00:00.000Z',
    retired_at: null,
    created_by: 'skill_v1',
    source: 'canon_seed',
    ...overrides,
  };
}

/** Makes N synthetic active locations with the given tier mix. */
function makeActives(count: number, primaryCount: number): RachelLocation[] {
  const out: RachelLocation[] = [];
  for (let i = 0; i < count; i++) {
    const tier: LocationTier = i < primaryCount ? 'primary' : 'secondary';
    out.push(
      makeLocationRow({
        location_id: `location_${String(i + 1).padStart(2, '0')}`,
        tier,
        status: 'active',
      }),
    );
  }
  return out;
}

interface MockDepsResult {
  deps: RetireLocationDeps;
  updateStatusCalls: Array<{ location_id: string; status: RachelLookStatus }>;
}

function makeMockDeps(opts: {
  row: RachelLocation | null;
  actives: RachelLocation[];
}): MockDepsResult {
  const updateStatusCalls: Array<{ location_id: string; status: RachelLookStatus }> = [];

  const deps: RetireLocationDeps = {
    getLocation: async (_id) => opts.row,
    listActiveLocations: async () => opts.actives,
    updateLocationStatus: async (location_id, status) => {
      updateStatusCalls.push({ location_id, status });
      return {
        ...(opts.row as RachelLocation),
        status,
        retired_at: status === 'retired' ? '2026-05-22T00:00:00.000Z' : null,
      };
    },
  };

  return { deps, updateStatusCalls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('happy path: secondary retire with 4 actives (2 primary) → retires successfully', async () => {
  const target = makeLocationRow({
    location_id: 'location_03',
    tier: 'secondary',
    status: 'active',
  });
  const { deps, updateStatusCalls } = makeMockDeps({
    row: target,
    actives: makeActives(4, 2), // 4 active, 2 primary
  });

  const result = await retireLocation('location_03', deps);

  assert.equal(result.status, 'retired');
  assert.equal(updateStatusCalls.length, 1);
  assert.equal(updateStatusCalls[0]!.location_id, 'location_03');
  assert.equal(updateStatusCalls[0]!.status, 'retired');
});

test('not found: throws "not found"; no status write', async () => {
  const { deps, updateStatusCalls } = makeMockDeps({
    row: null,
    actives: makeActives(4, 2),
  });

  await assert.rejects(
    () => retireLocation('location_99', deps),
    (err: Error) => {
      assert.match(err.message, /location_id 'location_99' not found/);
      return true;
    },
  );
  assert.equal(updateStatusCalls.length, 0);
});

test('not active: pending row → throws "expected active"; no status write', async () => {
  const target = makeLocationRow({ status: 'pending' });
  const { deps, updateStatusCalls } = makeMockDeps({
    row: target,
    actives: makeActives(4, 2),
  });

  await assert.rejects(
    () => retireLocation('location_01', deps),
    (err: Error) => {
      assert.match(err.message, /current status is 'pending'/);
      assert.match(err.message, /expected 'active'/);
      return true;
    },
  );
  assert.equal(updateStatusCalls.length, 0);
});

test('floor breach: only 2 actives → retire would drop to 1 → throws "pool floor"', async () => {
  const target = makeLocationRow({
    location_id: 'location_02',
    tier: 'secondary',
    status: 'active',
  });
  const { deps, updateStatusCalls } = makeMockDeps({
    row: target,
    actives: makeActives(2, 1), // 2 active, 1 primary
  });

  await assert.rejects(
    () => retireLocation('location_02', deps),
    (err: Error) => {
      assert.match(err.message, /pool floor is 2/);
      return true;
    },
  );
  assert.equal(updateStatusCalls.length, 0);
});

test('primary-floor breach: would leave 0 active primaries → throws "last active primary"', async () => {
  const target = makeLocationRow({
    location_id: 'location_01',
    tier: 'primary',
    status: 'active',
  });
  // 3 active total: 1 primary, 2 secondary. Retiring the primary leaves 0 primaries.
  const { deps, updateStatusCalls } = makeMockDeps({
    row: target,
    actives: makeActives(3, 1),
  });

  await assert.rejects(
    () => retireLocation('location_01', deps),
    (err: Error) => {
      assert.match(err.message, /last active primary/);
      return true;
    },
  );
  assert.equal(updateStatusCalls.length, 0);
});
