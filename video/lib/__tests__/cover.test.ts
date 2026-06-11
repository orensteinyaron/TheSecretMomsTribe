// Cover stage unit tests: directive variance, banner safe-zone geometry,
// prompt identity rules, QA fail-closed behavior, and the fallback chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  applyVariance,
  buildCoverDirective,
  directiveFromTone,
  FRAMING_ROTATION,
  COMPOSITION_ROTATION,
  TONE_DIRECTIVES,
} from "../cover/directive.js";
import {
  assertBannerInsideSafeZone,
  bannerSvg,
  composeCoverWithBanner,
  fitBannerFontSize,
  BAND_BOTTOM_Y,
  BAND_ROTATION_OVERSHOOT_PX,
  BAND_SHADOW_OFFSET_PX,
  BAND_TOP_Y,
  BRAND_PRIMARY,
  COVER_H,
  COVER_W,
  IG_GRID_SAFE_BOTTOM_Y,
  IG_GRID_SAFE_TOP_Y,
  INK,
} from "../cover/banner.js";
import { buildCoverPrompt, generateGeminiCover } from "../cover/gemini.js";
import { checkSameness, qaCover, IDENTITY_PASS_THRESHOLD } from "../cover/qa.js";
import { parseRecentCovers } from "../cover/recent.js";
import { runCoverChain, type CoverChainDeps } from "../cover/run.js";
import type { CoverDirective, CoverQaReport, RecentCover } from "../cover/types.js";

// ── directive ────────────────────────────────────────────────────────────

test("directiveFromTone: exact, fuzzy (register suffix), and unknown", () => {
  assert.equal(directiveFromTone("warm"), TONE_DIRECTIVES.warm);
  assert.equal(directiveFromTone("Concerned_Insider"), TONE_DIRECTIVES.concerned);
  assert.equal(directiveFromTone("deadpan_sarcasm"), null);
});

test("applyVariance: excludes every combination used in the last 5 covers", () => {
  const base = TONE_DIRECTIVES.warm;
  // Exclude 5 combos with the SAME expression as base — variance must pick a
  // (framing, side) pair outside all of them.
  const recent: RecentCover[] = [
    { expression: base.expression, framing: "close_up", composition_side: "center" },
    { expression: base.expression, framing: "medium", composition_side: "left" },
    { expression: base.expression, framing: "three_quarter", composition_side: "right" },
    { expression: base.expression, framing: "close_up", composition_side: "left" },
    { expression: base.expression, framing: "medium", composition_side: "center" },
  ];
  const d = applyVariance(base, recent);
  for (const r of recent) {
    assert.ok(
      !(d.framing === r.framing && d.composition_side === r.composition_side),
      `picked an excluded combo: ${d.framing}/${d.composition_side}`,
    );
  }
  assert.ok(FRAMING_ROTATION.includes(d.framing));
  assert.ok(COMPOSITION_ROTATION.includes(d.composition_side));
});

test("applyVariance: rotates framing away from the most recent cover", () => {
  const base = TONE_DIRECTIVES.playful;
  const d = applyVariance(base, [
    { expression: "something else entirely", framing: "close_up", composition_side: "center" },
  ]);
  // Different expression → no exclusions bite, but rotation still starts
  // after the last cover's framing.
  assert.equal(d.framing, "medium");
  assert.equal(d.composition_side, "left");
});

test("buildCoverDirective: tone present → deterministic, LLM never called", async () => {
  const llm = async () => {
    throw new Error("LLM must not be called when tone is present");
  };
  const r = await buildCoverDirective(
    { hook: "h", scriptSummary: "s", tone: "reassuring", recentCovers: [] },
    llm,
  );
  assert.equal(r.derivedVia, "tone");
  assert.equal(r.cost_usd, 0);
  assert.equal(r.directive.expression, TONE_DIRECTIVES.reassuring.expression);
});

test("buildCoverDirective: no tone → one LLM call", async () => {
  let calls = 0;
  const llm = async () => {
    calls++;
    return { base: { expression: "mid-laugh", gaze: "direct to camera", pose: "leaning in" }, cost_usd: 0.001 };
  };
  const r = await buildCoverDirective({ hook: "h", scriptSummary: "s", recentCovers: [] }, llm);
  assert.equal(calls, 1);
  assert.equal(r.derivedVia, "llm");
  assert.equal(r.directive.expression, "mid-laugh");
});

// ── banner / safe zone ───────────────────────────────────────────────────

test("banner: IG 3:4 center-crop safe zone math is 240..1680 on 1080x1920", () => {
  assert.equal(IG_GRID_SAFE_TOP_Y, 240);
  assert.equal(IG_GRID_SAFE_BOTTOM_Y, 1680);
});

test("banner: band incl. rotation overshoot + shadow stays inside the safe zone", () => {
  assert.doesNotThrow(assertBannerInsideSafeZone);
  assert.ok(BAND_TOP_Y - BAND_ROTATION_OVERSHOOT_PX >= IG_GRID_SAFE_TOP_Y);
  assert.ok(BAND_BOTTOM_Y + BAND_SHADOW_OFFSET_PX + BAND_ROTATION_OVERSHOOT_PX <= IG_GRID_SAFE_BOTTOM_Y);
});

test("banner: font size is length-responsive with a floor (hook-fit lesson)", () => {
  const short = fitBannerFontSize("WAIT FOR IT");
  const long = fitBannerFontSize("THE LIE TRAP WE ALL FALL INTO EVERY SINGLE NIGHT");
  assert.ok(short > long);
  assert.ok(long >= 56);
});

test("banner: SVG uses brand styling (BRAND_PRIMARY band, INK shadow, Poppins ExtraBold, uppercase)", () => {
  const svg = bannerSvg("my teen finally talks", "here is why");
  assert.ok(svg.includes(BRAND_PRIMARY));
  assert.ok(svg.includes(INK));
  assert.ok(svg.includes("Poppins"));
  assert.ok(svg.includes('font-weight="800"'));
  assert.ok(svg.includes("MY TEEN FINALLY TALKS"));
  assert.ok(svg.includes("HERE IS WHY"));
});

test("banner: composes to a 1080x1920 PNG", async () => {
  const base = await sharp({
    create: { width: 540, height: 960, channels: 3, background: { r: 120, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
  const out = await composeCoverWithBanner({ baseImage: base, hookPrimary: "test hook" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, COVER_W);
  assert.equal(meta.height, COVER_H);
  assert.equal(meta.format, "png");
});

// ── gemini prompt ────────────────────────────────────────────────────────

test("prompt: anchors identity to the reference, never to described features", () => {
  const d: CoverDirective = {
    expression: "mid-laugh",
    gaze: "direct to camera",
    pose: "leaning in",
    framing: "medium",
    composition_side: "left",
  };
  const p1 = buildCoverPrompt(d, 1);
  assert.ok(p1.includes("the same woman, in the same room, with the same lighting and the same wardrobe"));
  assert.ok(p1.includes("mid-laugh"));
  assert.ok(p1.includes("medium shot"));
  assert.ok(p1.includes("toward the left"));
  assert.ok(p1.includes("center 3:4 region"));
  const p2 = buildCoverPrompt(d, 2);
  assert.notEqual(p1, p2);
  assert.ok(p2.includes("IDENTICAL to the reference"));
});

test("gemini: throws loudly when GEMINI_API_KEY is missing", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      () => generateGeminiCover({ referenceImage: Buffer.from("x"), prompt: "p" }),
      /GEMINI_API_KEY missing/,
    );
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

// ── qa ───────────────────────────────────────────────────────────────────

const DIRECTIVE: CoverDirective = {
  expression: "soft genuine smile, eyes relaxed",
  gaze: "direct to camera",
  pose: "leaning in",
  framing: "close_up",
  composition_side: "center",
};
const IMG = { mediaType: "image/png" as const, data: "aGk=" };

function visionStub(result: Record<string, unknown>) {
  return (async () => ({
    result,
    usage: { input_tokens: 100, output_tokens: 50, retried: false },
  })) as any;
}

test("qaCover: identity >= threshold + scene match → PASS", async () => {
  const report = await qaCover(
    { coverImage: IMG, referenceImage: IMG, directive: DIRECTIVE, previousCover: null },
    visionStub({
      identity_score: 4,
      identity_notes: "same person",
      location_match: true,
      wardrobe_match: true,
      lighting_match: true,
      scene_notes: "same kitchen",
    }),
  );
  assert.equal(report.verdict, "PASS");
  assert.equal(report.identity.pass, true);
  assert.equal(report.scene_continuity.pass, true);
});

test("qaCover: identity below threshold → FAIL (fallback trigger)", async () => {
  const report = await qaCover(
    { coverImage: IMG, referenceImage: IMG, directive: DIRECTIVE, previousCover: null },
    visionStub({
      identity_score: IDENTITY_PASS_THRESHOLD - 1,
      identity_notes: "drifted",
      location_match: true,
      wardrobe_match: true,
      lighting_match: true,
      scene_notes: "",
    }),
  );
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.identity.pass, false);
});

test("qaCover: scene-continuity mismatch (wardrobe) → FAIL", async () => {
  const report = await qaCover(
    { coverImage: IMG, referenceImage: IMG, directive: DIRECTIVE, previousCover: null },
    visionStub({
      identity_score: 5,
      identity_notes: "",
      location_match: true,
      wardrobe_match: false,
      lighting_match: true,
      scene_notes: "different sweater",
    }),
  );
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.scene_continuity.pass, false);
});

test("qaCover: vision failure → unmeasured dimensions, fail closed", async () => {
  const report = await qaCover(
    { coverImage: IMG, referenceImage: IMG, directive: DIRECTIVE, previousCover: null },
    visionStub({ error: "boom" }),
  );
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.identity.score, "unmeasured");
  assert.equal(report.scene_continuity.location_match, "unmeasured");
});

test("checkSameness: flags an expression/framing repeat of the previous cover", () => {
  const prev: RecentCover = {
    expression: DIRECTIVE.expression,
    framing: DIRECTIVE.framing,
    composition_side: "left",
  };
  assert.equal(checkSameness(DIRECTIVE, prev).flagged, true);
  assert.equal(checkSameness(DIRECTIVE, { ...prev, framing: "medium" }).flagged, false);
  assert.equal(checkSameness(DIRECTIVE, null).flagged, false);
});

test("parseRecentCovers: skips malformed rows, caps at 5", () => {
  const good = { metadata: { cover: { expression: "e", framing: "medium", composition_side: "left" } } };
  const rows = [
    { metadata: null },
    { metadata: { cover: { expression: "e", framing: "extreme_wide", composition_side: "left" } } },
    { metadata: { cover: { framing: "medium", composition_side: "left" } } },
    ...Array(7).fill(good),
  ];
  const parsed = parseRecentCovers(rows);
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].expression, "e");
});

// ── fallback chain ───────────────────────────────────────────────────────

function passQa(): CoverQaReport {
  return {
    verdict: "PASS",
    identity: { score: 5, threshold: IDENTITY_PASS_THRESHOLD, pass: true, notes: "" },
    scene_continuity: { location_match: true, wardrobe_match: true, lighting_match: true, pass: true, notes: "" },
    sameness: { flagged: false },
    cost_usd: 0.01,
  };
}
function failQa(): CoverQaReport {
  return { ...passQa(), verdict: "FAIL", identity: { score: 1, threshold: IDENTITY_PASS_THRESHOLD, pass: false, notes: "drift" } };
}

function chainDeps(over: Partial<CoverChainDeps> = {}): { deps: CoverChainDeps; prompts: string[] } {
  const prompts: string[] = [];
  const deps: CoverChainDeps = {
    generateImage: async (prompt) => {
      prompts.push(prompt);
      return Buffer.from("png");
    },
    qa: async () => passQa(),
    buildDirective: async () => ({
      directive: { ...TONE_DIRECTIVES.warm, framing: "medium", composition_side: "center" },
      derivedVia: "tone",
      cost_usd: 0,
    }),
    ...over,
  };
  return { deps, prompts };
}

const CHAIN_INPUT = {
  hook: "h",
  scriptSummary: "s",
  tone: "warm",
  recentCovers: [],
  referenceImage: Buffer.from("ref"),
};

test("chain: tier 1 passes → source gemini, one attempt", async () => {
  const { deps } = chainDeps();
  const r = await runCoverChain(CHAIN_INPUT, deps);
  assert.equal(r.status, "PASS");
  if (r.status === "PASS") {
    assert.equal(r.source, "gemini");
    assert.equal(r.attempts.length, 1);
  }
});

test("chain: tier 1 fails QA, tier 2 passes with an ADJUSTED prompt → gemini_retry", async () => {
  let qaCalls = 0;
  const { deps, prompts } = chainDeps({ qa: async () => (++qaCalls === 1 ? failQa() : passQa()) });
  const r = await runCoverChain(CHAIN_INPUT, deps);
  assert.equal(r.status, "PASS");
  if (r.status === "PASS") {
    assert.equal(r.source, "gemini_retry");
    assert.equal(r.attempts.length, 2);
  }
  assert.equal(prompts.length, 2);
  assert.notEqual(prompts[0], prompts[1]); // retry prompt is adjusted, not a re-roll
});

test("chain: both Gemini tiers fail QA → NEEDS_SOUL_FALLBACK (tier 3 is session-driven)", async () => {
  const { deps } = chainDeps({ qa: async () => failQa() });
  const r = await runCoverChain(CHAIN_INPUT, deps);
  assert.equal(r.status, "NEEDS_SOUL_FALLBACK");
  if (r.status === "NEEDS_SOUL_FALLBACK") assert.equal(r.attempts.length, 2);
});

test("chain: Gemini unavailable (throws) → NEEDS_SOUL_FALLBACK with zero QA'd attempts", async () => {
  const { deps } = chainDeps({
    generateImage: async () => {
      throw new Error("GEMINI_API_KEY missing");
    },
  });
  const r = await runCoverChain(CHAIN_INPUT, deps);
  assert.equal(r.status, "NEEDS_SOUL_FALLBACK");
  if (r.status === "NEEDS_SOUL_FALLBACK") assert.equal(r.attempts.length, 0);
});
