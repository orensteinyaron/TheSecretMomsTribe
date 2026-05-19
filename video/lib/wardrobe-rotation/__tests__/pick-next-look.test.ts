import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextLook, WARDROBE_COOLDOWN } from '../pick-next-look.ts';

// Helper: synthesize 11 look_ids
const eleven = Array.from({ length: 11 }, (_, i) => `look_${String(i + 1).padStart(2, '0')}`);

test('WARDROBE_COOLDOWN is 2', () => {
  assert.equal(WARDROBE_COOLDOWN, 2);
});

test('empty history with 11 active looks returns look_01', () => {
  assert.equal(pickNextLook(eleven, []), 'look_01');
});

test('11 sequential calls cycle through all 11 looks with no consecutive repeat and no repeat within cooldown=2 window', () => {
  const history: { look_id: string; used_at: string }[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 11; i++) {
    const pick = pickNextLook(eleven, history);
    picks.push(pick);
    history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
  }
  // No duplicates in first 11 picks
  assert.equal(new Set(picks).size, 11);
  // No repeat within any 2-pick window
  for (let i = 2; i < picks.length; i++) {
    assert.notEqual(picks[i], picks[i - 1]);
    assert.notEqual(picks[i], picks[i - 2]);
  }
});

test('22 sequential calls — each look appears exactly twice; 12th pick equals 1st', () => {
  const history: { look_id: string; used_at: string }[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 22; i++) {
    const pick = pickNextLook(eleven, history);
    picks.push(pick);
    history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
  }
  const counts = picks.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }), {});
  for (const id of eleven) assert.equal(counts[id], 2);
  assert.equal(picks[11], picks[0]);
});

test('history [look_01, look_02] → next pick is never look_01 or look_02', () => {
  const now = Date.now();
  const history = [
    { look_id: 'look_01', used_at: new Date(now - 2000).toISOString() },
    { look_id: 'look_02', used_at: new Date(now - 1000).toISOString() },
  ];
  const pick = pickNextLook(eleven, history);
  assert.notEqual(pick, 'look_01');
  assert.notEqual(pick, 'look_02');
});

test('deterministic — same input returns same output', () => {
  const history = [
    { look_id: 'look_03', used_at: '2026-05-19T10:00:00Z' },
    { look_id: 'look_01', used_at: '2026-05-19T10:01:00Z' },
  ];
  const a = pickNextLook(eleven, history);
  const b = pickNextLook(eleven, history);
  assert.equal(a, b);
});

test('only 2 active looks with cooldown=2 → fallback to oldest-used active look', () => {
  const two = ['look_01', 'look_02'];
  const history = [
    { look_id: 'look_01', used_at: '2026-05-19T10:00:00Z' },
    { look_id: 'look_02', used_at: '2026-05-19T10:01:00Z' },
  ];
  // Both blocked by cooldown; fallback returns oldest = look_01
  assert.equal(pickNextLook(two, history), 'look_01');
});

test('tie-break: equal recency → ascending look_id (with cooldown applied)', () => {
  const three = ['look_01', 'look_02', 'look_03'];
  const sameTime = '2026-05-19T10:00:00Z';
  const history = [
    { look_id: 'look_02', used_at: sameTime },
    { look_id: 'look_03', used_at: sameTime },
  ];
  // history's 2 most-recent are look_02, look_03 → blocked by cooldown.
  // candidates = [look_01]. pick = look_01.
  assert.equal(pickNextLook(three, history), 'look_01');
});
