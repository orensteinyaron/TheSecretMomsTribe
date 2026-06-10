import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAudioBoundaries,
  maxQuietJump,
  AUDIO_BOUNDARY_JUMP_THRESHOLD,
} from "../audio-boundary-check.js";

const SR = 48000;

function quietGap(samples: number): Float32Array {
  const x = new Float32Array(samples);
  for (let i = 0; i < samples; i++) x[i] = Math.sin(i * 0.001) * 1e-4; // ~1e-4
  return x;
}

test("clean (faded) cut: quiet gap, no step → PASS", () => {
  const x = quietGap(SR * 2);
  const r = checkAudioBoundaries(x, SR, [{ label: "a→b", time_s: 1.0 }]);
  assert.equal(r.verdict, "PASS");
  assert.ok(r.boundaries[0].max_quiet_jump < AUDIO_BOUNDARY_JUMP_THRESHOLD);
});

test("splice click (brief transient) in the quiet gap → FAIL", () => {
  const x = quietGap(SR * 2);
  const cut = SR * 1;
  // A real click is a brief transient in the silence, not a sustained DC step.
  x[cut] = 0.08;
  x[cut + 1] = -0.06;
  x[cut + 2] = 0.03;
  const r = checkAudioBoundaries(x, SR, [{ label: "a→b", time_s: 1.0 }]);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.boundaries[0].max_quiet_jump >= 0.05);
});

test("speech slope near the cut (high RMS) is NOT flagged — the key fix", () => {
  // A loud tone right at the cut: large sample-to-sample slope, but it's speech,
  // not a click. The old un-gated metric false-positived here (after tail-trim).
  const x = new Float32Array(SR * 2);
  for (let i = 0; i < x.length; i++) x[i] = 0.25 * Math.sin(i * 0.25); // ~0.06/sample slope
  const r = checkAudioBoundaries(x, SR, [{ label: "a→b", time_s: 1.0 }]);
  assert.equal(r.verdict, "PASS", "loud continuous tone must not be flagged as a click");
});

test("maxQuietJump ignores jumps where local energy is high", () => {
  const x = new Float32Array(SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(i * 0.2);
  assert.equal(maxQuietJump(x, SR, 0.5), 0, "no quiet region → no counted jump");
});
