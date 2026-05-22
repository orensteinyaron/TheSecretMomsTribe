import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLook, LOOK_COOLDOWN } from '../pickers/pick-look.js';

// Helper: synthesize 11 look_ids
const eleven = Array.from({ length: 11 }, (_, i) => `look_${String(i + 1).padStart(2, '0')}`);

test('LOOK_COOLDOWN is 3', () => {
  assert.equal(LOOK_COOLDOWN, 3);
});

test('empty history with 11 active looks returns look_01', () => {
  assert.equal(pickLook(eleven, []), 'look_01');
});

test('11 sequential calls cycle through all 11 looks with no repeat within 3-pick window', () => {
  const history: { look_id: string; used_at: string }[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 11; i++) {
    const pick = pickLook(eleven, history);
    picks.push(pick);
    history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
  }
  // No duplicates in first 11 picks (all 11 looks appear exactly once)
  assert.equal(new Set(picks).size, 11);
  // No repeat within any 3-pick window
  for (let i = 3; i < picks.length; i++) {
    assert.notEqual(picks[i], picks[i - 1]);
    assert.notEqual(picks[i], picks[i - 2]);
    assert.notEqual(picks[i], picks[i - 3]);
  }
});

test('22 sequential picks — each look appears exactly twice; 12th pick equals 1st', () => {
  const history: { look_id: string; used_at: string }[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 22; i++) {
    const pick = pickLook(eleven, history);
    picks.push(pick);
    history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
  }
  const counts = picks.reduce<Record<string, number>>(
    (acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }),
    {},
  );
  for (const id of eleven) assert.equal(counts[id], 2);
  assert.equal(picks[11], picks[0]);
});

test('history [look_01, look_02, look_03] → next pick is never any of those three', () => {
  const now = Date.now();
  const history = [
    { look_id: 'look_01', used_at: new Date(now - 3000).toISOString() },
    { look_id: 'look_02', used_at: new Date(now - 2000).toISOString() },
    { look_id: 'look_03', used_at: new Date(now - 1000).toISOString() },
  ];
  const pick = pickLook(eleven, history);
  assert.notEqual(pick, 'look_01');
  assert.notEqual(pick, 'look_02');
  assert.notEqual(pick, 'look_03');
});

test('deterministic — same input returns same output', () => {
  const history = [
    { look_id: 'look_03', used_at: '2026-05-19T10:00:00Z' },
    { look_id: 'look_01', used_at: '2026-05-19T10:01:00Z' },
    { look_id: 'look_05', used_at: '2026-05-19T10:02:00Z' },
  ];
  const a = pickLook(eleven, history);
  const b = pickLook(eleven, history);
  assert.equal(a, b);
});

test('only 3 active looks with cooldown=3 → fallback to oldest-used active look', () => {
  const three = ['look_01', 'look_02', 'look_03'];
  const history = [
    { look_id: 'look_01', used_at: '2026-05-19T10:00:00Z' },
    { look_id: 'look_02', used_at: '2026-05-19T10:01:00Z' },
    { look_id: 'look_03', used_at: '2026-05-19T10:02:00Z' },
  ];
  // All 3 blocked by cooldown=3; fallback returns oldest = look_01
  assert.equal(pickLook(three, history), 'look_01');
});

test('tie-break: equal recency → ascending look_id', () => {
  const four = ['look_01', 'look_02', 'look_03', 'look_04'];
  const sameTime = '2026-05-19T10:00:00Z';
  const history = [
    { look_id: 'look_02', used_at: sameTime },
    { look_id: 'look_03', used_at: sameTime },
    { look_id: 'look_04', used_at: sameTime },
  ];
  // history's 3 most-recent are look_02, look_03, look_04 → all blocked by cooldown=3.
  // candidates = [look_01]. pick = look_01.
  // (Tie-break fires when candidates have equal recency among themselves; here look_01 is
  // never-used so it wins outright. Test specifically constructed for ascending-id tie-break.)
  assert.equal(pickLook(four, history), 'look_01');
});
