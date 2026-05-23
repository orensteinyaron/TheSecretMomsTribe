import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAnchoredStill } from '../flows/generate-anchored-still.ts';
import type { GenerateAnchoredStillDeps } from '../flows/generate-anchored-still.ts';
import type {
  NanoBananaProFn,
  NanoBananaProInput,
  NanoBananaProImage,
} from '../flows/constants.ts';
import { ANCHORED_STILL_CANDIDATES } from '../flows/constants.ts';
import type {
  RachelLook,
  RachelLocation,
  RachelStill,
  RachelLookStatus,
} from '../../wardrobe-rotation/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANONICAL_URL = 'https://higgsfield.example/locked_canonical.jpg';

function makeLook(overrides: Partial<RachelLook> = {}): RachelLook {
  return {
    look_id: 'look_01',
    wardrobe: 'cream linen wrap top with rolled sleeves and high-waist olive trousers',
    hair: 'loose waves swept slightly off the shoulder',
    accessories: 'small gold hoop earrings',
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

function makeLocation(overrides: Partial<RachelLocation> = {}): RachelLocation {
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
    reference_image_url: CANONICAL_URL,
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

function makeStill(overrides: Partial<RachelStill> = {}): RachelStill {
  return {
    still_id: 'still_uuid_default',
    look_id: 'look_01',
    location_id: 'location_01',
    soul_still_id: 'job_default',
    soul_still_url: 'https://higgsfield.example/still_default.jpg',
    reference_image_url_used: CANONICAL_URL,
    status: 'pending',
    created_at: '2026-05-22T00:00:00.000Z',
    approved_at: null,
    retired_at: null,
    created_by: 'skill_v1',
    ...overrides,
  };
}

/** Mock nano_banana_pro transport that returns N canned candidates + tracks calls. */
function makeMockGenerator(opts?: { countOverride?: number }): {
  fn: NanoBananaProFn;
  calls: NanoBananaProInput[];
} {
  const calls: NanoBananaProInput[] = [];
  const fn: NanoBananaProFn = async (input) => {
    calls.push(input);
    const n = opts?.countOverride ?? input.count;
    const out: NanoBananaProImage[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        job_id: `job_${i + 1}`,
        url: `https://higgsfield.example/cand_${i + 1}.jpg`,
      });
    }
    return out;
  };
  return { fn, calls };
}

interface MockDepsResult {
  deps: GenerateAnchoredStillDeps;
  getLookCalls: string[];
  getLocationCalls: string[];
  listStillsCalls: Parameters<GenerateAnchoredStillDeps['listStills']>[0][];
  insertStillCalls: Parameters<GenerateAnchoredStillDeps['insertStill']>[0][];
  updateStillStatusCalls: Array<{ still_id: string; status: RachelLookStatus }>;
}

function makeMockDeps(opts: {
  look: RachelLook | null;
  location: RachelLocation | null;
  existingActives?: RachelStill[];
}): MockDepsResult {
  const getLookCalls: string[] = [];
  const getLocationCalls: string[] = [];
  const listStillsCalls: Parameters<GenerateAnchoredStillDeps['listStills']>[0][] = [];
  const insertStillCalls: Parameters<GenerateAnchoredStillDeps['insertStill']>[0][] = [];
  const updateStillStatusCalls: Array<{ still_id: string; status: RachelLookStatus }> = [];

  let insertCounter = 0;

  const deps: GenerateAnchoredStillDeps = {
    getLook: async (look_id) => {
      getLookCalls.push(look_id);
      return opts.look;
    },
    getLocation: async (location_id) => {
      getLocationCalls.push(location_id);
      return opts.location;
    },
    listStills: async (filters) => {
      listStillsCalls.push(filters);
      return opts.existingActives ?? [];
    },
    insertStill: async (still) => {
      insertStillCalls.push(still);
      insertCounter += 1;
      return makeStill({
        ...still,
        still_id: `still_uuid_${insertCounter}`,
      });
    },
    updateStillStatus: async (still_id, status) => {
      updateStillStatusCalls.push({ still_id, status });
      return makeStill({
        still_id,
        status,
        approved_at: status === 'active' ? '2026-05-22T00:00:00.000Z' : null,
        retired_at: status === 'retired' ? '2026-05-22T00:00:00.000Z' : null,
        // Recover the original soul fields from the prior insertStill call by id.
        soul_still_id: insertStillCalls.find((_, i) => `still_uuid_${i + 1}` === still_id)?.soul_still_id ?? 'job_default',
        soul_still_url: insertStillCalls.find((_, i) => `still_uuid_${i + 1}` === still_id)?.soul_still_url ?? 'https://higgsfield.example/still_default.jpg',
      });
    },
  };

  return {
    deps,
    getLookCalls,
    getLocationCalls,
    listStillsCalls,
    insertStillCalls,
    updateStillStatusCalls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('happy path: approves the candidate, retires any siblings, snapshots canonical URL', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertStillCalls, updateStillStatusCalls } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'active', reference_image_url: CANONICAL_URL }),
  });

  const result = await generateAnchoredStill('look_01', 'location_01', generator, deps);

  // Result shape: first candidate becomes the active still.
  assert.equal(result.still_id, 'still_uuid_1');
  assert.equal(result.soul_still_id, 'job_1');
  assert.equal(result.soul_still_url, 'https://higgsfield.example/cand_1.jpg');
  assert.equal(result.reference_image_url_used, CANONICAL_URL);
  // With ANCHORED_STILL_CANDIDATES = 1 there are no siblings to retire.
  assert.equal(result.retired_still_ids.length, 0);
  assert.deepEqual(result.retired_still_ids, []);

  // One insert, one approve, zero retires (count=1 cap).
  assert.equal(insertStillCalls.length, ANCHORED_STILL_CANDIDATES);
  const approves = updateStillStatusCalls.filter((c) => c.status === 'active');
  const retires = updateStillStatusCalls.filter((c) => c.status === 'retired');
  assert.equal(approves.length, 1);
  assert.equal(retires.length, 0);
  assert.equal(approves[0]!.still_id, 'still_uuid_1');

  // Transport contract: prompt non-empty, count=ANCHORED_STILL_CANDIDATES,
  // medias[0] = canonical with role=image.
  assert.equal(genCalls.length, 1);
  const input = genCalls[0]!;
  assert.ok(input.prompt.length > 0, 'prompt must be non-empty');
  assert.equal(input.count, ANCHORED_STILL_CANDIDATES);
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(input.resolution, '2k');
  assert.equal(input.medias.length, 1);
  assert.equal(input.medias[0]!.value, CANONICAL_URL);
  assert.equal(input.medias[0]!.role, 'image');
});

test('look not found: throws with "not found"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertStillCalls } = makeMockDeps({
    look: null,
    location: makeLocation({ status: 'active' }),
  });

  await assert.rejects(
    () => generateAnchoredStill('look_99', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /look_id 'look_99' not found/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0, 'generator must not be called');
  assert.equal(insertStillCalls.length, 0);
});

test('look not active: throws "expected active"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    look: makeLook({ status: 'pending' }),
    location: makeLocation({ status: 'active' }),
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /is 'pending'/);
      assert.match(err.message, /expected 'active'/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
});

test('location not found: throws "not found"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: null,
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_99', generator, deps),
    (err: Error) => {
      assert.match(err.message, /location_id 'location_99' not found/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
});

test('location not active: throws "expected active"', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'pending', reference_image_url: null }),
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /is 'pending'/);
      assert.match(err.message, /expected 'active'/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
});

test('location missing reference_image_url: throws "has no reference_image_url"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertStillCalls } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'active', reference_image_url: null }),
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /has no reference_image_url/);
      assert.match(err.message, /bootstrapLocation/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
  assert.equal(insertStillCalls.length, 0);
});

test('active still already exists: throws "active still already exists"; generator NOT called', async () => {
  const { fn: generator, calls: genCalls } = makeMockGenerator();
  const { deps, insertStillCalls, listStillsCalls } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'active', reference_image_url: CANONICAL_URL }),
    existingActives: [makeStill({ status: 'active', still_id: 'still_existing' })],
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /active still already exists/);
      assert.match(err.message, /Retire it first/);
      return true;
    },
  );
  assert.equal(genCalls.length, 0);
  assert.equal(insertStillCalls.length, 0);
  // listStills filter must be by (look_id, location_id, status=active).
  assert.equal(listStillsCalls.length, 1);
  assert.equal(listStillsCalls[0]?.look_id, 'look_01');
  assert.equal(listStillsCalls[0]?.location_id, 'location_01');
  assert.equal(listStillsCalls[0]?.status, 'active');
});

test('transport returns wrong count: throws "expected 1 candidates, got 2"', async () => {
  const { fn: generator } = makeMockGenerator({ countOverride: 2 });
  const { deps, insertStillCalls } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'active', reference_image_url: CANONICAL_URL }),
  });

  await assert.rejects(
    () => generateAnchoredStill('look_01', 'location_01', generator, deps),
    (err: Error) => {
      assert.match(err.message, /expected 1 candidates, got 2/);
      return true;
    },
  );
  // No inserts on count mismatch (the check fires before persistence).
  assert.equal(insertStillCalls.length, 0);
});

test('every insert receives the canonical URL in reference_image_url_used', async () => {
  const { fn: generator } = makeMockGenerator();
  const { deps, insertStillCalls } = makeMockDeps({
    look: makeLook({ status: 'active' }),
    location: makeLocation({ status: 'active', reference_image_url: CANONICAL_URL }),
  });

  await generateAnchoredStill('look_01', 'location_01', generator, deps);

  assert.equal(insertStillCalls.length, ANCHORED_STILL_CANDIDATES);
  for (const insert of insertStillCalls) {
    assert.equal(insert.reference_image_url_used, CANONICAL_URL);
    assert.equal(insert.look_id, 'look_01');
    assert.equal(insert.location_id, 'location_01');
    assert.equal(insert.status, 'pending');
    assert.equal(insert.created_by, 'skill_v1');
  }
  // Inserts carry the soul_still_id / soul_still_url values mapped 1:1 from
  // the transport's candidates by index. With ANCHORED_STILL_CANDIDATES = 1
  // this is just the first candidate; the shape is kept so a future count-cap
  // fix doesn't require changing the assertion.
  const soulIds = insertStillCalls.map((i) => i.soul_still_id);
  assert.deepEqual(soulIds, ['job_1']);
  const soulUrls = insertStillCalls.map((i) => i.soul_still_url);
  assert.deepEqual(soulUrls, ['https://higgsfield.example/cand_1.jpg']);
});
