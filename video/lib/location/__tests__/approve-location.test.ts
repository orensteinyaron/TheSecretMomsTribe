import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveLocation } from '../flows/approve-location.ts';
import type { ApproveLocationDeps } from '../flows/approve-location.ts';
import type { RachelLocation, RachelLookStatus } from '../../wardrobe-rotation/types.js';

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
    reference_image_url: null,
    reference_image_id: null,
    tier: 'primary',
    notes: null,
    status: 'pending',
    created_at: '2026-05-22T00:00:00.000Z',
    approved_at: null,
    retired_at: null,
    created_by: 'skill_v1',
    source: 'canon_seed',
    ...overrides,
  };
}

interface MockDepsResult {
  deps: ApproveLocationDeps;
  /** Call log: order matters for the "reference BEFORE status" invariant. */
  callLog: string[];
  updateRefCalls: Array<{ location_id: string; url: string; id: string }>;
  updateStatusCalls: Array<{ location_id: string; status: RachelLookStatus }>;
}

function makeMockDeps(opts: { row: RachelLocation | null }): MockDepsResult {
  const callLog: string[] = [];
  const updateRefCalls: Array<{ location_id: string; url: string; id: string }> = [];
  const updateStatusCalls: Array<{ location_id: string; status: RachelLookStatus }> = [];

  const deps: ApproveLocationDeps = {
    getLocation: async (_id) => {
      callLog.push('getLocation');
      return opts.row;
    },
    updateLocationReferenceImage: async (location_id, url, id) => {
      callLog.push('updateLocationReferenceImage');
      updateRefCalls.push({ location_id, url, id });
      return { ...(opts.row as RachelLocation), reference_image_url: url, reference_image_id: id };
    },
    updateLocationStatus: async (location_id, status) => {
      callLog.push('updateLocationStatus');
      updateStatusCalls.push({ location_id, status });
      return {
        ...(opts.row as RachelLocation),
        status,
        approved_at: status === 'active' ? '2026-05-22T00:00:00.000Z' : null,
      };
    },
  };

  return { deps, callLog, updateRefCalls, updateStatusCalls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('happy path: pending row + valid URL + id → returns active row; reference written BEFORE status', async () => {
  const { deps, callLog, updateRefCalls, updateStatusCalls } = makeMockDeps({
    row: makeLocationRow({ status: 'pending' }),
  });

  const result = await approveLocation(
    'location_01',
    'https://higgsfield.example/canonical.jpg',
    'job_abc',
    deps,
  );

  assert.equal(result.status, 'active');
  assert.equal(result.location_id, 'location_01');

  // Ordering invariant: reference is written BEFORE the status flip.
  assert.deepEqual(callLog, [
    'getLocation',
    'updateLocationReferenceImage',
    'updateLocationStatus',
  ]);
  assert.equal(updateRefCalls.length, 1);
  assert.equal(updateRefCalls[0]!.location_id, 'location_01');
  assert.equal(updateRefCalls[0]!.url, 'https://higgsfield.example/canonical.jpg');
  assert.equal(updateRefCalls[0]!.id, 'job_abc');
  assert.equal(updateStatusCalls.length, 1);
  assert.equal(updateStatusCalls[0]!.status, 'active');
});

test('bad URL: empty / http:// / file:// all throw "must be a non-empty HTTPS URL"', async () => {
  const { deps, callLog } = makeMockDeps({
    row: makeLocationRow({ status: 'pending' }),
  });

  await assert.rejects(
    () => approveLocation('location_01', '', 'job_abc', deps),
    /must be a non-empty HTTPS URL/,
  );
  await assert.rejects(
    () => approveLocation('location_01', 'http://example.com/x.jpg', 'job_abc', deps),
    /must be a non-empty HTTPS URL/,
  );
  await assert.rejects(
    () => approveLocation('location_01', 'file:///etc/passwd', 'job_abc', deps),
    /must be a non-empty HTTPS URL/,
  );

  // No DB calls happen — URL validation runs before getLocation.
  assert.equal(callLog.length, 0);
});

test('bad reference_image_id: empty string / whitespace → throws "non-empty string"', async () => {
  const { deps, callLog } = makeMockDeps({
    row: makeLocationRow({ status: 'pending' }),
  });

  await assert.rejects(
    () => approveLocation('location_01', 'https://example.com/c.jpg', '', deps),
    /non-empty string/,
  );
  await assert.rejects(
    () => approveLocation('location_01', 'https://example.com/c.jpg', '   ', deps),
    /non-empty string/,
  );

  assert.equal(callLog.length, 0);
});

test('location not found: throws "not found"; no writes', async () => {
  const { deps, updateRefCalls, updateStatusCalls } = makeMockDeps({ row: null });

  await assert.rejects(
    () => approveLocation('location_99', 'https://example.com/c.jpg', 'job_abc', deps),
    (err: Error) => {
      assert.match(err.message, /location_id 'location_99' not found/);
      return true;
    },
  );

  assert.equal(updateRefCalls.length, 0);
  assert.equal(updateStatusCalls.length, 0);
});

test('already active: throws "expected pending"; no writes', async () => {
  const { deps, updateRefCalls, updateStatusCalls } = makeMockDeps({
    row: makeLocationRow({
      status: 'active',
      reference_image_url: 'https://higgsfield.example/already.jpg',
      reference_image_id: 'job_existing',
    }),
  });

  await assert.rejects(
    () => approveLocation('location_01', 'https://example.com/c.jpg', 'job_abc', deps),
    (err: Error) => {
      assert.match(err.message, /current status is 'active'/);
      assert.match(err.message, /expected 'pending'/);
      return true;
    },
  );

  assert.equal(updateRefCalls.length, 0);
  assert.equal(updateStatusCalls.length, 0);
});

test('already retired: throws "expected pending"; no writes', async () => {
  const { deps, updateRefCalls, updateStatusCalls } = makeMockDeps({
    row: makeLocationRow({ status: 'retired' }),
  });

  await assert.rejects(
    () => approveLocation('location_01', 'https://example.com/c.jpg', 'job_abc', deps),
    (err: Error) => {
      assert.match(err.message, /current status is 'retired'/);
      assert.match(err.message, /expected 'pending'/);
      return true;
    },
  );

  assert.equal(updateRefCalls.length, 0);
  assert.equal(updateStatusCalls.length, 0);
});
