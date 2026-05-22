import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCanRetireStill } from '../guards/assert-can-retire-still.js';

test('pending still → always allow (0 active in combo)', () => {
  const result = assertCanRetireStill('pending', 0);
  assert.equal(result.ok, true);
});

test('pending still → always allow (1 active in combo)', () => {
  const result = assertCanRetireStill('pending', 1);
  assert.equal(result.ok, true);
});

test('retired still → always allow', () => {
  const result = assertCanRetireStill('retired', 1);
  assert.equal(result.ok, true);
});

test('active still, 0 in combo → refuse (defensive)', () => {
  const result = assertCanRetireStill('active', 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /last active still/);
});

test('active still, 1 in combo (only one) → refuse', () => {
  const result = assertCanRetireStill('active', 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /last active still/);
    assert.match(result.reason, /generateStill/);
  }
});

test('active still, 2 in combo → allow', () => {
  const result = assertCanRetireStill('active', 2);
  assert.equal(result.ok, true);
});
