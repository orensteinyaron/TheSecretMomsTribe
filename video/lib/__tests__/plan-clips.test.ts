import { test } from "node:test";
import assert from "node:assert/strict";

import { planClips, estimateAudioSeconds } from "../clip-duration.js";

// planClips is the pure phaseInit plan-split helper: expand any clip whose
// ESTIMATED audio exceeds planTargetS into ordered, stably-suffixed
// sub-clips; pass short clips through untouched.

const PLAN_TARGET_S = 12.0;

// At 14 chars/sec, 12s = 168 chars. Build scripts above/below that.
function chars(n: number): string {
  // Sentence-terminated so splitScriptToFit has real boundaries to cut on.
  // Repeat short sentences to reach the target length.
  const sentence = "x".repeat(40) + ". ";
  let s = "";
  while (s.length < n) s += sentence;
  return s.slice(0, n).trim();
}

test("planClips: short clip passes through unchanged (same id)", () => {
  const clips = [{ id: "clip_01", expected_script: chars(80), duration_target_s: 8 }];
  const out = planClips(clips, PLAN_TARGET_S);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "clip_01");
  assert.equal(out[0].expected_script, clips[0].expected_script);
});

test("planClips: long clip splits into stably-suffixed sub-clips in order", () => {
  // ~252 chars ≈ 18s estimated → must split.
  const longScript = chars(252);
  assert.ok(estimateAudioSeconds(longScript) > PLAN_TARGET_S);

  const clips = [{ id: "clip_03", expected_script: longScript, duration_target_s: 18 }];
  let logged: { id: string; subIds: string[] } | null = null;
  const out = planClips(clips, PLAN_TARGET_S, ({ id, subIds }) => {
    logged = { id, subIds };
  });

  assert.ok(out.length >= 2, "splits into >= 2 sub-clips");
  // Stable suffixed ids: clip_03a, clip_03b, …
  assert.equal(out[0].id, "clip_03a");
  assert.equal(out[1].id, "clip_03b");
  // Each sub-clip fits the target and has a measured-from-estimate target.
  for (const sub of out) {
    assert.ok(estimateAudioSeconds(sub.expected_script) <= PLAN_TARGET_S);
    assert.equal(sub.duration_target_s, Math.ceil(estimateAudioSeconds(sub.expected_script)));
  }
  // onSplit fired with the original id + the new sub ids.
  assert.deepEqual(logged, { id: "clip_03", subIds: out.map((c) => c.id) });
});

test("planClips: order preserved across a mixed list", () => {
  const clips = [
    { id: "clip_01", expected_script: chars(80), duration_target_s: 6 },
    { id: "clip_02", expected_script: chars(252), duration_target_s: 18 },
    { id: "clip_03", expected_script: chars(70), duration_target_s: 5 },
  ];
  const out = planClips(clips, PLAN_TARGET_S);
  const ids = out.map((c) => c.id);
  // clip_01 untouched, clip_02 expanded, clip_03 untouched — all in order.
  assert.equal(ids[0], "clip_01");
  assert.equal(ids[ids.length - 1], "clip_03");
  assert.ok(ids.includes("clip_02a") && ids.includes("clip_02b"));
  // clip_03 must come strictly after all clip_02* sub-clips.
  const lastSub = Math.max(...ids.map((id, i) => (id.startsWith("clip_02") ? i : -1)));
  assert.ok(ids.indexOf("clip_03") > lastSub);
});

test("planClips: preserves other per-clip fields on sub-clips", () => {
  const clips = [
    { id: "clip_05", expected_script: chars(252), duration_target_s: 18, register: "concerned_insider" as const },
  ];
  const out = planClips(clips, PLAN_TARGET_S);
  assert.ok(out.length >= 2);
  for (const sub of out) {
    assert.equal((sub as typeof clips[0]).register, "concerned_insider");
  }
});
