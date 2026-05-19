import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLookIdFrom } from '../generate-look-id.ts';

test('empty table → returns look_01', () => {
  assert.equal(nextLookIdFrom(null), 'look_01');
});

test('existing look_11 → returns look_12', () => {
  assert.equal(nextLookIdFrom('look_11'), 'look_12');
});

test('existing look_01 → returns look_02', () => {
  assert.equal(nextLookIdFrom('look_01'), 'look_02');
});

test('existing look_99 → throws overflow', () => {
  assert.throws(() => nextLookIdFrom('look_99'), /overflow/i);
});

test('gap-tolerance: max-derived behavior, NOT gap-fill — look_05 → look_06', () => {
  // Caller passes the max look_id from the table (look_05 if rows are look_01, look_03, look_05).
  // Function returns max + 1, never gap-fills.
  assert.equal(nextLookIdFrom('look_05'), 'look_06');
});

test('throws on malformed input', () => {
  assert.throws(() => nextLookIdFrom('look_'), /malformed|invalid/i);
  assert.throws(() => nextLookIdFrom('look_abc'), /malformed|invalid/i);
  assert.throws(() => nextLookIdFrom('foo_05'), /malformed|invalid/i);
});
