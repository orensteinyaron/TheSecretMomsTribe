import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapLocation } from '../flows/bootstrap-location.ts';
import type { BootstrapLocationDeps } from '../flows/bootstrap-location.ts';
import type {
  NanoBananaProFn,
  NanoBananaProInput,
  NanoBananaProImage,
} from '../flows/constants.ts';
import { LOCATION_BOOTSTRAP_CANDIDATES } from '../flows/constants.ts';
import type { RachelLocation } from '../../wardrobe-rotation/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a synthetic RachelLocation row to mimic Supabase responses.
 * Only the fields touched by bootstrap-location are interesting; the rest
 * carry safe defaults.
 */
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

/** Builds a NanoBananaProFn mock that returns N canned candidates + tracks calls. */
function makeMockGenerator(): {
  fn: NanoBananaProFn;
  calls: NanoBananaProInput[];
} {
  const calls: NanoBananaProInput[] = [];
  const fn: NanoBananaProFn = async (input) => {
    calls.push(input);
    const out: NanoBananaProImage[] = [];
    for (let i = 0; i < input.count; i++) {
      out.push({ job_id: `job_${i + 1}`, url: `https://higgsfield.example/cand_${i + 1}.jpg` });
    }
    return out;
  };
  return { fn, calls };
}

/** Builds a stub deps object that records all DB calls. */
function makeMockDeps(opts: {
  existingRow: RachelLocation | null;
}): {
  deps: BootstrapLocationDeps;
  getLocationCalls: string[];
  insertLocationCalls: Parameters<BootstrapLocationDeps['insertLocation']>[0][];
} {
  const getLocationCalls: string[] = [];
  const insertLocationCalls: Parameters<BootstrapLocationDeps['insertLocation']>[0][] = [];

  const deps: BootstrapLocationDeps = {
    getLocation: async (location_id) => {
      getLocationCalls.push(location_id);
      return opts.existingRow;
    },
    insertLocation: async (loc) => {
      insertLocationCalls.push(loc);
      return makeLocationRow({ ...loc });
    },
  };

  return { deps, getLocationCalls, insertLocationCalls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('happy path: returns location_01 + 1 candidate; generator called once', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertLocationCalls } = makeMockDeps({
    existingRow: makeLocationRow({ status: 'pending', reference_image_url: null }),
  });

  const result = await bootstrapLocation(
    { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
    generator,
    deps,
  );

  assert.equal(result.location_id, 'location_01');
  assert.equal(result.candidate_canonicals.length, LOCATION_BOOTSTRAP_CANDIDATES);
  assert.equal(genCalls.length, 1);
  assert.equal(genCalls[0]!.count, LOCATION_BOOTSTRAP_CANDIDATES);
  // Pending row already exists — insertLocation must NOT be called.
  assert.equal(insertLocationCalls.length, 0);
});

test('validation: bad location_number (99) throws with "not defined in canon" + lists valid slots', async () => {
  const { fn: generator } = makeMockGenerator();
  const { deps } = makeMockDeps({ existingRow: null });

  await assert.rejects(
    () =>
      bootstrapLocation(
        { location_number: 99, aesthetic_reference_url: 'https://example.com/foo.jpg' },
        generator,
        deps,
      ),
    (err: Error) => {
      assert.match(err.message, /not defined in canon/);
      assert.match(err.message, /1, 2/);
      return true;
    },
  );
});

test('validation: http:// URL throws "must be HTTPS"; empty string also throws', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({ existingRow: null });

  await assert.rejects(
    () =>
      bootstrapLocation(
        { location_number: 1, aesthetic_reference_url: 'http://example.com/kitchen.jpg' },
        generator,
        deps,
      ),
    /must be HTTPS/,
  );

  await assert.rejects(
    () =>
      bootstrapLocation(
        { location_number: 1, aesthetic_reference_url: '' },
        generator,
        deps,
      ),
    /must be HTTPS/,
  );

  // Generator must not have been called for either failure.
  assert.equal(genCalls.length, 0);
});

test('idempotency: active row with reference_image_url set → refuses; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    existingRow: makeLocationRow({
      status: 'active',
      reference_image_url: 'https://higgsfield.example/locked_canonical.jpg',
      reference_image_id: 'job_abc',
    }),
  });

  await assert.rejects(
    () =>
      bootstrapLocation(
        { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
        generator,
        deps,
      ),
    (err: Error) => {
      assert.match(err.message, /already active/);
      assert.match(err.message, /updateLocationReference/);
      return true;
    },
  );

  assert.equal(genCalls.length, 0, 'generator must not be called on idempotency refusal');
});

test('idempotency: pending row exists (pre-seed) → proceeds; insertLocation NOT called; generator IS called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertLocationCalls } = makeMockDeps({
    existingRow: makeLocationRow({ status: 'pending', reference_image_url: null }),
  });

  const result = await bootstrapLocation(
    { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
    generator,
    deps,
  );

  assert.equal(result.candidate_canonicals.length, LOCATION_BOOTSTRAP_CANDIDATES);
  assert.equal(insertLocationCalls.length, 0, 'insertLocation should not run when pending row exists');
  assert.equal(genCalls.length, 1);
});

test('defensive: no row exists → insertLocation called with full canon-brief shape; then generator', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertLocationCalls } = makeMockDeps({ existingRow: null });

  await bootstrapLocation(
    { location_number: 1, aesthetic_reference_url: 'https://example.com/kitchen.jpg' },
    generator,
    deps,
  );

  assert.equal(insertLocationCalls.length, 1, 'insertLocation must run when no row exists');
  const inserted = insertLocationCalls[0]!;
  assert.equal(inserted.location_id, 'location_01');
  assert.equal(inserted.name, 'kitchen');
  assert.equal(inserted.tier, 'primary');
  assert.equal(inserted.status, 'pending');
  assert.equal(inserted.reference_image_url, null);
  assert.equal(inserted.reference_image_id, null);
  assert.equal(inserted.created_by, 'skill_v1');
  assert.equal(inserted.source, 'canon_seed');
  // Canon brief fields should be present + non-empty.
  assert.ok(inserted.camera_angle.length > 0);
  assert.ok(inserted.camera_distance.length > 0);
  assert.ok(inserted.rachel_position.length > 0);
  assert.ok(inserted.background_composition.length > 0);
  assert.ok(inserted.lighting_setup.length > 0);
  assert.ok(inserted.wall_color.length > 0);
  assert.ok(inserted.floor_material.length > 0);
  assert.ok(Array.isArray(inserted.props) && inserted.props.length > 0);
  assert.ok(inserted.notes && inserted.notes.includes('Canon Location #1'));

  // Generator still runs after the insert.
  assert.equal(genCalls.length, 1);
});

test('transport contract: prompt non-empty + count=LOCATION_BOOTSTRAP_CANDIDATES + aspect_ratio=9:16 + resolution=2k + medias[0] = {role:image,value:URL}', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    existingRow: makeLocationRow({ status: 'pending' }),
  });
  const url = 'https://example.com/kitchen.jpg';

  await bootstrapLocation(
    { location_number: 1, aesthetic_reference_url: url },
    generator,
    deps,
  );

  assert.equal(genCalls.length, 1);
  const input = genCalls[0]!;
  assert.ok(input.prompt.length > 0, 'prompt must be non-empty');
  assert.equal(input.count, LOCATION_BOOTSTRAP_CANDIDATES);
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(input.resolution, '2k');
  assert.equal(input.medias.length, 1);
  assert.equal(input.medias[0]!.role, 'image');
  assert.equal(input.medias[0]!.value, url);
});

test('location_02 also works (sanity for second canon slot)', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    existingRow: makeLocationRow({
      location_id: 'location_02',
      name: 'home_studio',
      status: 'pending',
    }),
  });

  const result = await bootstrapLocation(
    { location_number: 2, aesthetic_reference_url: 'https://example.com/studio.jpg' },
    generator,
    deps,
  );

  assert.equal(result.location_id, 'location_02');
  assert.equal(result.candidate_canonicals.length, LOCATION_BOOTSTRAP_CANDIDATES);
  assert.equal(genCalls.length, 1);
});
