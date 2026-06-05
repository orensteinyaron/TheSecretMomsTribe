import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEEDANCE_MAX_CLIP_S,
  CHARS_PER_SECOND,
  CLIP_TAIL_S,
  MAX_AUDIO_S,
  TRIM_TOLERANCE_S,
  estimateAudioSeconds,
  seedanceDurationForAudio,
  splitScriptToFit,
  needsSilenceTrim,
} from "../clip-duration.js";

// ── constants ────────────────────────────────────────────────────────────

test("constants match eleven_v3 calibration + Seedance limits", () => {
  assert.equal(SEEDANCE_MAX_CLIP_S, 15);
  assert.equal(CHARS_PER_SECOND, 14);
  assert.equal(CLIP_TAIL_S, 1);
  assert.equal(MAX_AUDIO_S, 13.5);
  assert.equal(TRIM_TOLERANCE_S, 1.0);
});

// ── estimateAudioSeconds ─────────────────────────────────────────────────

test("estimateAudioSeconds: 140 chars ≈ 10s", () => {
  const text = "x".repeat(140);
  assert.equal(estimateAudioSeconds(text), 10);
});

test("estimateAudioSeconds: collapses internal whitespace before counting", () => {
  // "a b c" visible = 5 chars; padded with runs of whitespace must collapse
  const messy = "  a    b\n\nc  ";
  const clean = "a b c";
  assert.equal(estimateAudioSeconds(messy), estimateAudioSeconds(clean));
  assert.equal(estimateAudioSeconds(clean), 5 / CHARS_PER_SECOND);
});

test("estimateAudioSeconds: empty / whitespace-only → 0", () => {
  assert.equal(estimateAudioSeconds(""), 0);
  assert.equal(estimateAudioSeconds("   \n\t  "), 0);
});

test("estimateAudioSeconds: returns unrounded seconds", () => {
  // 125 chars / 14 = 8.928571...
  assert.equal(estimateAudioSeconds("y".repeat(125)), 125 / 14);
});

// ── seedanceDurationForAudio ─────────────────────────────────────────────

test("seedanceDurationForAudio: ceil(audio)+tail, capped at 15", () => {
  assert.equal(seedanceDurationForAudio(8.96), 10); // ceil 9 + 1
  assert.equal(seedanceDurationForAudio(13.68), 15); // ceil 14 + 1
  assert.equal(seedanceDurationForAudio(2.48), 4); // ceil 3 + 1
  assert.equal(seedanceDurationForAudio(14.5), 15); // ceil 15 + 1 = 16 → cap 15
  assert.equal(seedanceDurationForAudio(13.0), 14); // ceil 13 + 1
});

test("seedanceDurationForAudio: never exceeds the ceiling", () => {
  for (const a of [0, 5, 13.4, 13.5, 14, 15, 20, 100]) {
    assert.ok(seedanceDurationForAudio(a) <= SEEDANCE_MAX_CLIP_S);
  }
});

// ── splitScriptToFit ─────────────────────────────────────────────────────

// Helper: assert the safety property + word-preservation invariant.
//
// Clause splitting drops the boundary delimiter itself (" - ", ", ", " — "),
// which by design removes standalone punctuation tokens. So word-preservation
// is checked on REAL words — alphanumeric-bearing tokens — not lone dashes.
function realWords(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .filter((t) => /[A-Za-z0-9]/.test(t)) // drop lone-punctuation tokens (delimiters)
    .map((t) => t.replace(/[.,!?;:—-]+$/g, "")) // normalize trailing punctuation a delimiter may strip
    .filter(Boolean);
}

function assertSplitInvariants(original: string, chunks: string[], maxSeconds = MAX_AUDIO_S) {
  // Never empty strings.
  for (const c of chunks) assert.ok(c.length > 0, `empty chunk in ${JSON.stringify(chunks)}`);
  // Safety property: no chunk exceeds the budget by estimate (single
  // indivisible over-budget tokens are the only documented exception).
  for (const c of chunks) {
    const single = c.split(/\s+/).filter(Boolean).length === 1;
    if (single) continue;
    assert.ok(
      estimateAudioSeconds(c) <= maxSeconds,
      `chunk over max: ${estimateAudioSeconds(c)}s — ${JSON.stringify(c)}`,
    );
  }
  // Word preservation: joined chunks contain all original real words in order.
  assert.deepEqual(realWords(chunks.join(" ")), realWords(original));
}

test("splitScriptToFit: short script → length 1 (trimmed)", () => {
  const text = "AI deepfakes are already inside your kid's school.";
  const out = splitScriptToFit(text);
  assert.equal(out.length, 1);
  assert.equal(out[0], text.trim());
  assertSplitInvariants(text, out);
});

test("splitScriptToFit: long multi-sentence (~30s) splits into ≥2 chunks", () => {
  // Five sentences, ~150 chars each ≈ ~10.7s each → must split.
  const sentence = (n: number) =>
    `Sentence number ${n} here has quite a lot of words packed into it to push the per chunk estimate well above a few seconds each ok.`;
  const text = [1, 2, 3, 4, 5].map(sentence).join(" ");
  assert.ok(estimateAudioSeconds(text) > 25, "fixture should estimate ~30s+");
  const out = splitScriptToFit(text);
  assert.ok(out.length >= 2, `expected ≥2 chunks, got ${out.length}`);
  assertSplitInvariants(text, out);
});

test("splitScriptToFit: packs greedily into fewest chunks", () => {
  // Two ~6s sentences fit together (~12s ≤ 13.5); a third forces a new chunk.
  const s = "This sentence is sized to be about six seconds of speech roughly here ok.";
  assert.ok(estimateAudioSeconds(s) < MAX_AUDIO_S / 2);
  const text = `${s} ${s} ${s}`;
  const out = splitScriptToFit(text);
  // 3 × ~6s = ~18s → 2 chunks (6+6 then 6).
  assert.equal(out.length, 2);
  assertSplitInvariants(text, out);
});

test("splitScriptToFit: single giant sentence forces clause/word splitting", () => {
  // One sentence, no terminal punctuation until the very end, way over max.
  const text =
    "When a deepfake video of your child starts circulating in a group chat - and trust me it happens faster than you think - you need a calm plan, a screenshot, a report to the school, and a conversation that does not blame your kid for any of this whatsoever today.";
  assert.ok(estimateAudioSeconds(text) > MAX_AUDIO_S, "fixture must exceed max");
  const out = splitScriptToFit(text);
  assert.ok(out.length >= 2);
  assertSplitInvariants(text, out);
});

test("splitScriptToFit: single word longer than max still never exceeds (degenerate)", () => {
  // A pathological 300-char single token: hard word-split cannot help a single
  // token, but we still must not crash and must preserve the token.
  const giant = "z".repeat(300);
  const out = splitScriptToFit(giant);
  assert.deepEqual(out.join(" ").split(/\s+/).filter(Boolean), [giant]);
  // Single indivisible token: returned as-is (documented edge case).
  assert.deepEqual(out, [giant]);
});

test("splitScriptToFit: custom maxSeconds is honored", () => {
  const text = "One two three four five six. Seven eight nine ten eleven twelve.";
  const out = splitScriptToFit(text, 2.0);
  for (const c of out) {
    if (c.split(/\s+/).filter(Boolean).length > 1) {
      assert.ok(estimateAudioSeconds(c) <= 2.0);
    }
  }
  assertSplitInvariants(text, out, 2.0);
});

// ── needsSilenceTrim ─────────────────────────────────────────────────────

test("needsSilenceTrim: at/below max → fits", () => {
  const r = needsSilenceTrim(MAX_AUDIO_S);
  assert.deepEqual(r, { fits: true, trimmable: false, mustSplit: false });
});

test("needsSilenceTrim: small miss → trimmable", () => {
  const r = needsSilenceTrim(MAX_AUDIO_S + 0.5);
  assert.deepEqual(r, { fits: false, trimmable: true, mustSplit: false });
});

test("needsSilenceTrim: at the trim boundary (max + tolerance) → trimmable", () => {
  const r = needsSilenceTrim(MAX_AUDIO_S + TRIM_TOLERANCE_S);
  assert.deepEqual(r, { fits: false, trimmable: true, mustSplit: false });
});

test("needsSilenceTrim: large miss → mustSplit", () => {
  const r = needsSilenceTrim(MAX_AUDIO_S + 1.5);
  assert.deepEqual(r, { fits: false, trimmable: false, mustSplit: true });
});

test("needsSilenceTrim: exactly one classification is always true", () => {
  for (const a of [0, 5, MAX_AUDIO_S, MAX_AUDIO_S + 0.5, MAX_AUDIO_S + 1, MAX_AUDIO_S + 1.5, 50]) {
    const r = needsSilenceTrim(a);
    const count = Number(r.fits) + Number(r.trimmable) + Number(r.mustSplit);
    assert.equal(count, 1, `audio=${a} produced ${count} true flags`);
  }
});
