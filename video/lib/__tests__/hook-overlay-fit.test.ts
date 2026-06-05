import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hookPrimaryFontSize,
  HOOK_SAFE_WIDTH_FRAC,
} from "../hook-overlay-fit.js";

test("short hooks (≤12 visible chars) → locked 124 size", () => {
  // boundary: exactly 12 chars stays at the locked design size
  assert.equal(hookPrimaryFontSize("AI DEEPFAKES"), 124); // 11 chars
  assert.equal(hookPrimaryFontSize("SCREEN TIME!"), 124); // 12 chars
});

test("12-char boundary → 124, 13-char crosses to 108", () => {
  assert.equal(hookPrimaryFontSize("a".repeat(12)), 124);
  assert.equal(hookPrimaryFontSize("a".repeat(13)), 108);
});

test("18-char boundary → 108, 19-char crosses to 92", () => {
  assert.equal(hookPrimaryFontSize("a".repeat(18)), 108);
  assert.equal(hookPrimaryFontSize("a".repeat(19)), 92);
});

test("whitespace does not count toward the visible-char tier", () => {
  // "BEST PARENTING" = 13 visible chars (space stripped) → 108, not 124
  assert.equal(hookPrimaryFontSize("BEST PARENTING"), 108);
  // collapse runs of whitespace too — still 13 visible chars
  assert.equal(hookPrimaryFontSize("  BEST   PARENTING  "), 108);
});

test('long hook "BEST PARENTING SCENE ON TV" (22 visible chars) → 92', () => {
  assert.equal(hookPrimaryFontSize("BEST PARENTING SCENE ON TV"), 92);
});

test("empty string → top tier (124)", () => {
  assert.equal(hookPrimaryFontSize(""), 124);
  assert.equal(hookPrimaryFontSize("   "), 124);
});

test("HOOK_SAFE_WIDTH_FRAC is 0.9", () => {
  assert.equal(HOOK_SAFE_WIDTH_FRAC, 0.9);
});
