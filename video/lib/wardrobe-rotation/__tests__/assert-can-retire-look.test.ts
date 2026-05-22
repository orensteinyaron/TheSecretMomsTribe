import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanRetireLook,
  LOOK_POOL_FLOOR,
  LOOK_POOL_WARNING_THRESHOLD,
} from '../guards/assert-can-retire-look.js';

test('constants: LOOK_POOL_FLOOR === 4', () => {
  assert.equal(LOOK_POOL_FLOOR, 4);
});

test('constants: LOOK_POOL_WARNING_THRESHOLD === 5', () => {
  assert.equal(LOOK_POOL_WARNING_THRESHOLD, 5);
});

test('0 active → refuse, reason contains "floor is 4"', () => {
  const result = assertCanRetireLook(0);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /floor is 4/);
  }
});

test('4 active → refuse (boundary: at or below floor)', () => {
  const result = assertCanRetireLook(4);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /floor is 4/);
  }
});

test('5 active → allow with warning', () => {
  const result = assertCanRetireLook(5);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.warning, 'expected a warning string');
    assert.match(result.warning!, /thinning/);
  }
});

test('6 active → allow, no warning', () => {
  const result = assertCanRetireLook(6);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.warning, undefined);
  }
});

test('11 active → allow, no warning', () => {
  const result = assertCanRetireLook(11);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.warning, undefined);
  }
});
