import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMotionPrompt, type Register } from "../motion-prompt-builder.js";

const ALL_REGISTERS: Register[] = [
  "neutral_warm",
  "concerned_insider",
  "excited_discovery",
  "dry_reflective",
];

// ─── YAR-129 Finding 2: framing-lock ───────────────────────────────────

test("every register includes framing-lock language", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.match(p, /camera position is locked/i, `${register}: missing camera-lock`);
    assert.match(p, /no zoom/i, `${register}: missing no-zoom`);
    assert.match(p, /no pan/i, `${register}: missing no-pan`);
    assert.match(p, /medium close-up/i, `${register}: missing medium close-up framing`);
  }
});

// ─── Position-stability (cheap normalization), NOT pose-lock ───────────
// Replaces the old "bounded motion within a small envelope" instruction,
// which over-suppressed motion and made Rachel read as a frozen photo
// (2026-06-23 Yaron correction). We now bound POSITION DRIFT only.

test("every register bounds position drift for normalization", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.match(p, /position barely drifts/i, `${register}: missing position-stability phrase`);
  }
});

test("no register contains pose-lock or torso-lock language", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.doesNotMatch(p, /pose is locked/i, `${register}: pose-lock language must NOT appear`);
    assert.doesNotMatch(p, /torso position is locked/i, `${register}: torso-lock language must NOT appear`);
    assert.doesNotMatch(p, /\bfrozen\b/i, `${register}: "frozen" language must NOT appear`);
  }
});

// ─── 2026-06-23 ALIVENESS floor (Yaron: "make Rachel more live") ───────

test("every register includes the aliveness floor (blink + alive + engaged)", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.match(p, /\balive\b/i, `${register}: missing 'alive' language`);
    assert.match(p, /blinks?/i, `${register}: missing blink language`);
    assert.match(p, /never stiff or wooden/i, `${register}: missing not-stiff language`);
  }
});

test("aliveness floor is tone-safe: never mandates a smile (would break dry_reflective/urgent)", () => {
  // The floor must not force a positive smile; smile is register-controlled.
  // dry_reflective legitimately says "no smile" in its own marker — what must
  // NOT appear is a positive smile mandate leaking from the shared floor.
  const dry = buildMotionPrompt({ register: "dry_reflective", script_excerpt: "x" });
  assert.doesNotMatch(dry, /genuine smile|warm smile|smile (coming|breaking)/i, "no positive smile mandate may leak into dry_reflective");
  assert.match(dry, /no smile/i, "dry_reflective keeps its own 'no smile' marker");
});

// ─── 2026-06-23 subject-DISTANCE lock (Yaron: clip-3 "too much zoom") ──

test("every register locks subject distance / size in frame", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.match(p, /same size in frame/i, `${register}: missing size-in-frame lock`);
    assert.match(p, /no push-in/i, `${register}: missing no-push-in lock`);
  }
});

test("neutral_warm default now carries lively hand gestures", () => {
  const p = buildMotionPrompt({ register: "neutral_warm", script_excerpt: "x" });
  assert.match(p, /gestures?.*hands|hands.*gestures?/i, "neutral_warm should describe natural hand gestures");
});

// ─── Register-specific markers (YAR-129 Gap 1) ──────────────────────────

test("concerned_insider includes lean-in + lowered voice markers", () => {
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "warning beat" });
  assert.match(p, /lean[- ]in/i);
  assert.match(p, /lowered/i);
  // brow markers per YAR-129 register table
  assert.match(p, /brow.*furrow/i);
});

test("concerned_insider explicitly avoids preacher/declarative markers", () => {
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "x" });
  // Per YAR-129: "controlled and close to body — NOT declarative, NOT pointing"
  assert.match(p, /not declarative/i);
  assert.match(p, /not pointing/i);
});

test("excited_discovery has animated markers, not lean-in", () => {
  const p = buildMotionPrompt({ register: "excited_discovery", script_excerpt: "you NEED to try this" });
  assert.match(p, /animated/i);
  assert.doesNotMatch(p, /lean[- ]in/i);
});

test("dry_reflective has stiller-body markers", () => {
  const p = buildMotionPrompt({ register: "dry_reflective", script_excerpt: "burnout" });
  assert.match(p, /stiller body/i);
  assert.doesNotMatch(p, /animated hands/i);
});

test("neutral_warm is the open-posture default", () => {
  const p = buildMotionPrompt({ register: "neutral_warm", script_excerpt: "general parenting" });
  assert.match(p, /open posture/i);
  assert.doesNotMatch(p, /lean[- ]in/i);
});

// ─── Script integration ────────────────────────────────────────────────

test("embeds the script excerpt verbatim so Seedance reads the spoken line context", () => {
  const p = buildMotionPrompt({
    register: "concerned_insider",
    script_excerpt: "Most parents have no idea.",
  });
  assert.ok(p.includes('"Most parents have no idea."'));
});

test("escapes a double-quote in the script excerpt to keep prompt grammar intact", () => {
  const p = buildMotionPrompt({
    register: "concerned_insider",
    script_excerpt: 'she said "wait" and stopped',
  });
  // We don't dictate the exact escape form, but the prompt should not break grammatically.
  // Cheap proxy: the prompt should still mention the substring "wait".
  assert.match(p, /wait/);
  assert.ok(!p.includes('""'), "escape result should not produce stray empty quoted pairs");
});

// ─── YAR-147: FRAMING_LOCK must not mention any environment objects ──────

test("YAR-147: FRAMING_LOCK contains no environment nouns (scene carried by start_image only)", () => {
  // Use concerned_insider — an arbitrary valid register; the bug is in FRAMING_LOCK which
  // is shared across all registers. We check one register to pin the regression.
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "x" });

  const environmentWords = [
    /kitchen/i,
    /counter/i,
    /cabinet/i,
    /backsplash/i,
    /island/i,
    /\bwall\b/i,
    /\bfloor\b/i,
    /fridge/i,
    /stove/i,
    /window/i,
    /countertop/i,
  ];

  for (const re of environmentWords) {
    assert.doesNotMatch(p, re, `FRAMING_LOCK must not contain environment noun matching ${re}`);
  }

  // Framing intent must survive the fix.
  assert.match(p, /medium close-up/i, "framing: 'medium close-up' must remain");
  assert.match(p, /upper two-thirds/i, "framing: 'upper two-thirds' must remain");
  assert.match(p, /camera position is locked/i, "framing: 'camera position is locked' must remain");
});
