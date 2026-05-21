/**
 * Unit tests for nextIdFrom() — generic sequential ID generator.
 *
 * Covers both 'look' and 'location' prefixes, overflow, and malformed input.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextIdFrom } from '../flows/generate-id.ts';

// ── Null (empty table) ────────────────────────────────────────────────────────

test('empty table (null) with prefix "look" → "look_01"', () => {
  assert.equal(nextIdFrom('look', null), 'look_01');
});

test('empty table (null) with prefix "location" → "location_01"', () => {
  assert.equal(nextIdFrom('location', null), 'location_01');
});

// ── Normal increments ─────────────────────────────────────────────────────────

test('"look_11" → "look_12"', () => {
  assert.equal(nextIdFrom('look', 'look_11'), 'look_12');
});

test('"location_03" → "location_04"', () => {
  assert.equal(nextIdFrom('location', 'location_03'), 'location_04');
});

// ── Overflow ──────────────────────────────────────────────────────────────────

test('"look_99" → throws overflow', () => {
  assert.throws(() => nextIdFrom('look', 'look_99'), /overflow/i);
});

test('"location_99" → throws overflow', () => {
  assert.throws(() => nextIdFrom('location', 'location_99'), /overflow/i);
});

// ── Malformed input ───────────────────────────────────────────────────────────

test('mismatched prefix: "foo_05" with prefix "look" → throws malformed', () => {
  assert.throws(() => nextIdFrom('look', 'foo_05'), /malformed/i);
});

test('truncated: "look_" with prefix "look" → throws malformed', () => {
  assert.throws(() => nextIdFrom('look', 'look_'), /malformed/i);
});

test('non-numeric suffix: "look_abc" with prefix "look" → throws malformed', () => {
  assert.throws(() => nextIdFrom('look', 'look_abc'), /malformed/i);
});

// ── Gap-tolerance ─────────────────────────────────────────────────────────────

test('gap-tolerance: "look_05" → "look_06" (max + 1, not gap-fill)', () => {
  // Caller passes the max id (look_05) even if gaps exist (e.g. look_01, look_03, look_05).
  // nextIdFrom always returns max + 1, never gap-fills.
  assert.equal(nextIdFrom('look', 'look_05'), 'look_06');
});
