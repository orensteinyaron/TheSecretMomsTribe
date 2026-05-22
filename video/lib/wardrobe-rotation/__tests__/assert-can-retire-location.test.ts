import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanRetireLocation,
  LOCATION_POOL_FLOOR,
  PRIMARY_LOCATION_MIN,
} from '../guards/assert-can-retire-location.js';

test('constants: LOCATION_POOL_FLOOR === 2', () => {
  assert.equal(LOCATION_POOL_FLOOR, 2);
});

test('constants: PRIMARY_LOCATION_MIN === 1', () => {
  assert.equal(PRIMARY_LOCATION_MIN, 1);
});

test('floor: count=0 → refuse', () => {
  const result = assertCanRetireLocation(0, 0, 'secondary');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /floor is 2/);
});

test('floor: count=1 → refuse', () => {
  const result = assertCanRetireLocation(1, 0, 'secondary');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /floor is 2/);
});

test('floor: count=2 → refuse', () => {
  const result = assertCanRetireLocation(2, 1, 'secondary');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /floor is 2/);
});

test('floor: count=3, retiring secondary, 1 primary remaining → allow', () => {
  const result = assertCanRetireLocation(3, 1, 'secondary');
  assert.equal(result.ok, true);
});

test('primary-survival: count=3, retiring primary, only 1 primary → refuse', () => {
  const result = assertCanRetireLocation(3, 1, 'primary');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /last active primary/);
});

test('primary-survival: count=3, retiring primary, 2 primaries → allow', () => {
  const result = assertCanRetireLocation(3, 2, 'primary');
  assert.equal(result.ok, true);
});

test('count=8, retiring secondary, 3 primaries → allow', () => {
  const result = assertCanRetireLocation(8, 3, 'secondary');
  assert.equal(result.ok, true);
});
