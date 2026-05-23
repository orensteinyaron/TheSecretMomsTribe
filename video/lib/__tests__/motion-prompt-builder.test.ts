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

// ─── YAR-129 Finding 3: bounded-motion, NOT pose-lock ──────────────────

test("every register includes bounded-motion language", () => {
  for (const register of ALL_REGISTERS) {
    const p = buildMotionPrompt({ register, script_excerpt: "x" });
    assert.match(p, /subtle natural motion within a small envelope/i, `${register}: missing bounded-motion phrase`);
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
