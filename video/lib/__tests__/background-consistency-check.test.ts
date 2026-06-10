import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkBackgroundScaleUniform,
  BACKGROUND_SCALE_RATIO_TOLERANCE,
} from "../background-consistency-check.js";

test("uniform scale (the fix) → PASS", () => {
  const r = checkBackgroundScaleUniform([1.166, 1.166, 1.166, 1.166, 1.166, 1.166]);
  assert.equal(r.verdict, "PASS");
  assert.equal(r.ratio, 1);
});

test("per-clip face-equalization scales (the bug) → FAIL", () => {
  // The exact spread observed on the @themompsychologist render.
  const r = checkBackgroundScaleUniform([1.61, 1.175, 1.081, 1.573, 1.083, 1.538]);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.ratio > 1.4, "ratio should reflect the ~1.49x zoom spread");
});

test("tiny rounding differences within tolerance → PASS", () => {
  const r = checkBackgroundScaleUniform([1.166, 1.167, 1.165]);
  assert.equal(r.verdict, "PASS");
  assert.ok(r.ratio <= BACKGROUND_SCALE_RATIO_TOLERANCE);
});

test("just over tolerance → FAIL", () => {
  const r = checkBackgroundScaleUniform([1.0, 1.05]); // ratio 1.05 > 1.02
  assert.equal(r.verdict, "FAIL");
});

test("empty → PASS (nothing to diverge)", () => {
  assert.equal(checkBackgroundScaleUniform([]).verdict, "PASS");
});
