import { test } from "node:test";
import assert from "node:assert/strict";
import { findTailTrimSeconds } from "../tail-trim.js";

const SR = 48000;

/** Build PCM with energy in the given [start,end] second ranges, silence elsewhere. */
function buildPcm(durS: number, loud: [number, number][]): Float32Array {
  const x = new Float32Array(Math.round(durS * SR));
  for (const [a, b] of loud) {
    for (let i = Math.round(a * SR); i < Math.round(b * SR) && i < x.length; i++) {
      x[i] = 0.3 * Math.sin(i * 0.2); // ~0.21 RMS
    }
  }
  return x;
}

test("cuts in the trailing silence before a post-word transient (the clip_05 case)", () => {
  // word 0–0.9s, silence, transient 1.5–1.55s, silence to 2.0s.
  const pcm = buildPcm(2.0, [[0, 0.9], [1.5, 1.55]]);
  const trim = findTailTrimSeconds(pcm, SR, 0.9, { maxS: 2.0 });
  assert.ok(trim > 0.9, "must keep the word");
  assert.ok(trim < 1.5, `must cut before the transient, got ${trim}`);
});

test("no trailing silence (speech to the end) → no trim (returns maxS)", () => {
  const pcm = buildPcm(1.5, [[0, 1.5]]);
  const trim = findTailTrimSeconds(pcm, SR, 1.4, { maxS: 1.5 });
  assert.equal(trim, 1.5);
});

test("trim never precedes minS", () => {
  const pcm = buildPcm(2.0, [[0, 0.5]]);
  const trim = findTailTrimSeconds(pcm, SR, 0.5, { minS: 0.8, maxS: 2.0 });
  assert.ok(trim >= 0.8);
});

test("trim never exceeds clip duration (maxS)", () => {
  const pcm = buildPcm(1.2, [[0, 0.6]]);
  const trim = findTailTrimSeconds(pcm, SR, 0.6, { maxS: 1.2 });
  assert.ok(trim <= 1.2);
});
