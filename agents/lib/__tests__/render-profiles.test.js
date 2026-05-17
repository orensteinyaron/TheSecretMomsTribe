/**
 * Tests for render-profiles helper. Pure-function tests (no DB).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  RENDER_PROFILE_SLUGS,
  ALL_RENDER_PROFILE_SLUGS,
  isValidRenderProfileSlug,
  getRenderProfileMap,
  getRenderProfileBySlug,
  getActiveRenderProfiles,
} = await import('../render-profiles.js');

test('RENDER_PROFILE_SLUGS exposes the four canonical slugs', () => {
  assert.equal(RENDER_PROFILE_SLUGS.AVATAR_V1, 'avatar-v1');
  assert.equal(RENDER_PROFILE_SLUGS.MOVING_IMAGES, 'moving-images');
  assert.equal(RENDER_PROFILE_SLUGS.STATIC_IMAGE, 'static-image');
  assert.equal(RENDER_PROFILE_SLUGS.CAROUSEL, 'carousel');
});

test('ALL_RENDER_PROFILE_SLUGS lists exactly the four slugs', () => {
  assert.deepEqual(
    [...ALL_RENDER_PROFILE_SLUGS].sort(),
    ['avatar-v1', 'carousel', 'moving-images', 'static-image'],
  );
});

test('isValidRenderProfileSlug accepts canonical slugs', () => {
  for (const slug of ALL_RENDER_PROFILE_SLUGS) {
    assert.equal(isValidRenderProfileSlug(slug), true, `expected ${slug} valid`);
  }
});

test('isValidRenderProfileSlug rejects unknown and non-string inputs', () => {
  assert.equal(isValidRenderProfileSlug('tiktok_avatar'), false);
  assert.equal(isValidRenderProfileSlug('tiktok_slideshow'), false);
  assert.equal(isValidRenderProfileSlug(''), false);
  assert.equal(isValidRenderProfileSlug(null), false);
  assert.equal(isValidRenderProfileSlug(undefined), false);
  assert.equal(isValidRenderProfileSlug(42), false);
  assert.equal(isValidRenderProfileSlug({}), false);
});

// --- DB-backed helpers: smoke-test via a fake supabase client ---

function fakeSupabase({ rows = [], error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'render_profiles');
      const builder = {
        select() { return builder; },
        eq(col, val) { builder._eq = { col, val }; return builder; },
        maybeSingle: async () => {
          if (error) return { data: null, error };
          const match = rows.find((r) => r[builder._eq.col] === builder._eq.val) || null;
          return { data: match, error: null };
        },
        then(resolve) { resolve({ data: error ? null : rows, error }); },
      };
      return builder;
    },
  };
}

test('getRenderProfileMap returns a slug→row map', async () => {
  const rows = [
    { id: 'a', slug: 'moving-images', name: 'Moving Images', profile_type: 'video', status: 'active', cost_estimate_usd: 0.023 },
    { id: 'b', slug: 'static-image',  name: 'Static Image',  profile_type: 'static', status: 'draft', cost_estimate_usd: 0.05 },
  ];
  const map = await getRenderProfileMap(fakeSupabase({ rows }));
  assert.equal(map['moving-images'].id, 'a');
  assert.equal(map['static-image'].id, 'b');
});

test('getRenderProfileMap surfaces DB errors as thrown errors', async () => {
  await assert.rejects(
    () => getRenderProfileMap(fakeSupabase({ error: { message: 'boom' } })),
    /getRenderProfileMap: boom/,
  );
});

test('getRenderProfileBySlug returns the matched row', async () => {
  const rows = [
    { id: 'a', slug: 'moving-images', name: 'Moving Images', profile_type: 'video', status: 'active', cost_estimate_usd: 0.023 },
  ];
  const row = await getRenderProfileBySlug(fakeSupabase({ rows }), 'moving-images');
  assert.equal(row.id, 'a');
});

test('getRenderProfileBySlug rejects invalid slugs before DB call', async () => {
  await assert.rejects(
    () => getRenderProfileBySlug(fakeSupabase({}), 'tiktok_avatar'),
    /invalid slug "tiktok_avatar"/,
  );
});

test('getRenderProfileBySlug throws when no row matches', async () => {
  await assert.rejects(
    () => getRenderProfileBySlug(fakeSupabase({ rows: [] }), 'moving-images'),
    /no row for slug "moving-images"/,
  );
});

test('getActiveRenderProfiles returns the active subset', async () => {
  const rows = [
    { id: 'a', slug: 'moving-images', status: 'active' },
    { id: 'b', slug: 'avatar-v1',     status: 'active' },
  ];
  const list = await getActiveRenderProfiles(fakeSupabase({ rows }));
  assert.equal(list.length, 2);
});
