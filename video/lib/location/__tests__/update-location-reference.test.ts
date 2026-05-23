import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  updateLocationReference,
  confirmReferenceUpdate,
} from '../flows/update-location-reference.ts';
import type { UpdateLocationReferenceDeps } from '../flows/update-location-reference.ts';
import type {
  NanoBananaProFn,
  NanoBananaProInput,
  NanoBananaProImage,
} from '../flows/constants.ts';
import { LOCATION_BOOTSTRAP_CANDIDATES } from '../flows/constants.ts';
import type { RachelLocation, RachelLookStatus } from '../../wardrobe-rotation/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const OLD_CANONICAL_URL = 'https://higgsfield.example/old_canonical.jpg';

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
    reference_image_url: OLD_CANONICAL_URL,
    reference_image_id: 'job_old',
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

function makeMockGenerator(): {
  fn: NanoBananaProFn;
  calls: NanoBananaProInput[];
} {
  const calls: NanoBananaProInput[] = [];
  const fn: NanoBananaProFn = async (input) => {
    calls.push(input);
    const out: NanoBananaProImage[] = [];
    for (let i = 0; i < input.count; i++) {
      out.push({
        job_id: `new_job_${i + 1}`,
        url: `https://higgsfield.example/new_cand_${i + 1}.jpg`,
      });
    }
    return out;
  };
  return { fn, calls };
}

interface MockDepsResult {
  deps: UpdateLocationReferenceDeps;
  updateRefCalls: Array<{ location_id: string; url: string; id: string }>;
}

function makeMockDeps(opts: { row: RachelLocation | null }): MockDepsResult {
  const updateRefCalls: Array<{ location_id: string; url: string; id: string }> = [];
  const deps: UpdateLocationReferenceDeps = {
    getLocation: async (_id) => opts.row,
    updateLocationReferenceImage: async (location_id, url, id) => {
      updateRefCalls.push({ location_id, url, id });
      return {
        ...(opts.row as RachelLocation),
        reference_image_url: url,
        reference_image_id: id,
      };
    },
  };
  return { deps, updateRefCalls };
}

// ── updateLocationReference tests ─────────────────────────────────────────────

test('updateLocationReference happy path: active row → returns LOCATION_BOOTSTRAP_CANDIDATES candidates; transport called once', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    row: makeLocationRow({ status: 'active', reference_image_url: OLD_CANONICAL_URL }),
  });

  const result = await updateLocationReference(
    { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
    generator,
    deps,
  );

  // Shape matches BootstrapLocationResult.
  assert.equal(result.location_id, 'location_01');
  assert.equal(result.candidate_canonicals.length, LOCATION_BOOTSTRAP_CANDIDATES);
  for (const c of result.candidate_canonicals) {
    assert.ok(c.job_id.startsWith('new_job_'));
    assert.ok(c.url.startsWith('https://higgsfield.example/new_cand_'));
  }

  // One transport call with the expected shape.
  assert.equal(genCalls.length, 1);
  assert.equal(genCalls[0]!.count, LOCATION_BOOTSTRAP_CANDIDATES);
  assert.equal(genCalls[0]!.aspect_ratio, '9:16');
  assert.equal(genCalls[0]!.resolution, '2k');
  assert.equal(genCalls[0]!.medias[0]!.value, 'https://example.com/kitchen.jpg');
});

test('updateLocationReference on pending row: throws "expected active"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    row: makeLocationRow({ status: 'pending', reference_image_url: null }),
  });

  await assert.rejects(
    () =>
      updateLocationReference(
        { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
        generator,
        deps,
      ),
    (err: Error) => {
      assert.match(err.message, /is 'pending'/);
      assert.match(err.message, /expected 'active'/);
      assert.match(err.message, /bootstrapLocation/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
});

test('updateLocationReference on missing row: throws "not found"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({ row: null });

  await assert.rejects(
    () =>
      updateLocationReference(
        { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
        generator,
        deps,
      ),
    (err: Error) => {
      assert.match(err.message, /location_id 'location_01' not found/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
});

// ── confirmReferenceUpdate tests ──────────────────────────────────────────────

test('confirmReferenceUpdate happy path: active row + valid URL → writes new URL, returns updated row', async () => {
  const { deps, updateRefCalls } = makeMockDeps({
    row: makeLocationRow({ status: 'active', reference_image_url: OLD_CANONICAL_URL }),
  });

  const result = await confirmReferenceUpdate(
    'location_01',
    'https://higgsfield.example/new_canonical.jpg',
    'new_job_1',
    deps,
  );

  assert.equal(result.reference_image_url, 'https://higgsfield.example/new_canonical.jpg');
  assert.equal(result.reference_image_id, 'new_job_1');
  assert.equal(result.status, 'active', 'status must be preserved');
  assert.equal(updateRefCalls.length, 1);
  assert.equal(updateRefCalls[0]!.location_id, 'location_01');
  assert.equal(updateRefCalls[0]!.url, 'https://higgsfield.example/new_canonical.jpg');
  assert.equal(updateRefCalls[0]!.id, 'new_job_1');
});

test('confirmReferenceUpdate bad URL: empty / http:// / file:// all throw; no write', async () => {
  const { deps, updateRefCalls } = makeMockDeps({
    row: makeLocationRow({ status: 'active' }),
  });

  await assert.rejects(
    () => confirmReferenceUpdate('location_01', '', 'job_x', deps),
    /must be a non-empty HTTPS URL/,
  );
  await assert.rejects(
    () => confirmReferenceUpdate('location_01', 'http://example.com/x.jpg', 'job_x', deps),
    /must be a non-empty HTTPS URL/,
  );
  await assert.rejects(
    () => confirmReferenceUpdate('location_01', 'https://example.com/x.jpg', '', deps),
    /non-empty string/,
  );

  assert.equal(updateRefCalls.length, 0);
});

test('confirmReferenceUpdate on pending row: throws "expected active"; no write', async () => {
  const { deps, updateRefCalls } = makeMockDeps({
    row: makeLocationRow({ status: 'pending', reference_image_url: null }),
  });

  await assert.rejects(
    () =>
      confirmReferenceUpdate(
        'location_01',
        'https://higgsfield.example/new.jpg',
        'new_job_1',
        deps,
      ),
    (err: Error) => {
      assert.match(err.message, /is 'pending'/);
      assert.match(err.message, /expected 'active'/);
      return true;
    },
  );
  assert.equal(updateRefCalls.length, 0);
});

test('confirmReferenceUpdate on missing row: throws "not found"; no write', async () => {
  const { deps, updateRefCalls } = makeMockDeps({ row: null });

  await assert.rejects(
    () =>
      confirmReferenceUpdate(
        'location_99',
        'https://higgsfield.example/new.jpg',
        'new_job_1',
        deps,
      ),
    /not found/,
  );
  assert.equal(updateRefCalls.length, 0);
});
