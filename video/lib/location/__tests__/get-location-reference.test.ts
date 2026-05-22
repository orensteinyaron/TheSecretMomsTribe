import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocationReference } from '../flows/get-location-reference.ts';
import type { GetLocationReferenceDeps } from '../flows/get-location-reference.ts';

// ── Tests ─────────────────────────────────────────────────────────────────────

test('returns the URL string when set', async () => {
  const calls: string[] = [];
  const deps: GetLocationReferenceDeps = {
    getLocationReferenceImage: async (location_id) => {
      calls.push(location_id);
      return 'https://higgsfield.example/canonical.jpg';
    },
  };

  const result = await getLocationReference('location_01', deps);
  assert.equal(result, 'https://higgsfield.example/canonical.jpg');
  assert.deepEqual(calls, ['location_01']);
});

test('returns null when not bootstrapped', async () => {
  const deps: GetLocationReferenceDeps = {
    getLocationReferenceImage: async () => null,
  };

  const result = await getLocationReference('location_01', deps);
  assert.equal(result, null);
});

test('propagates the underlying error', async () => {
  const deps: GetLocationReferenceDeps = {
    getLocationReferenceImage: async () => {
      throw new Error('[getLocationReferenceImage] supabase exploded');
    },
  };

  await assert.rejects(
    () => getLocationReference('location_01', deps),
    /supabase exploded/,
  );
});
