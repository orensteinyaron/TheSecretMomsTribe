/**
 * Unit tests for assertCanRetire() — pure floor-3 guard extracted from retire-look.ts.
 *
 * retireLook() itself requires network and is covered by integration tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCanRetire } from '../retire-look.ts';

test('floor-3 guard: 0 active → refuse', () => {
  const r = assertCanRetire(0);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.includes('floor is 3'));
});

test('floor-3 guard: 3 active → refuse (post-retire would be 2)', () => {
  const r = assertCanRetire(3);
  assert.equal(r.ok, false);
});

test('floor-3 guard: 4 active → allow (post-retire would be 3, at the floor)', () => {
  const r = assertCanRetire(4);
  assert.equal(r.ok, true);
});

test('floor-3 guard: 11 active → allow', () => {
  const r = assertCanRetire(11);
  assert.equal(r.ok, true);
});
