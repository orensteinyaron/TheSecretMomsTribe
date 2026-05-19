import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { verifyAndRetry, type SubmitResult, type WhisperOutcome } from "../whisper-verifier.js";

const SCRIPT = "Most parents have no idea this is happening.";

// ─── Helpers ───────────────────────────────────────────────────────────

function makeSubmit(modes: Array<"std" | "fast"> = ["std", "fast"]) {
  const calls: Array<"std" | "fast"> = [];
  const fn = async (mode: "std" | "fast"): Promise<SubmitResult> => {
    calls.push(mode);
    return {
      job_id: `j-${calls.length}-${mode}`,
      video_url: `https://example.com/clip-${calls.length}-${mode}.mp4`,
      duration_s: 8,
      cost_credits: mode === "std" ? 50 : 35,
      cost_usd: mode === "std" ? 0.65 : 0.45,
      mode_used: mode,
    };
  };
  fn.modes = modes;
  fn.calls = calls;
  return fn;
}

// ─── PASS on first attempt ─────────────────────────────────────────────

test("PASS on first try when WER below threshold and coverage > 0.5", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v-${mode}.mp4`,
    duration_s: 8,
    cost_credits: 50,
    cost_usd: 0.65,
    mode_used: mode,
  }));
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => ({
    transcript: "Most parents have no idea this is happening",
    duration_s: 7.6,
    speech_coverage: 0.95,
  }));

  const r = await verifyAndRetry({
    clipId: "SCENE_01",
    expectedScript: SCRIPT,
    submitFn: submit,
    whisperFn: whisper,
  });

  assert.equal(r.passed, true);
  assert.equal(r.attempts, 1);
  assert.equal(submit.mock.callCount(), 1);
  assert.equal(submit.mock.calls[0].arguments[0], "std");
  assert.ok((r.final_wer ?? 1) < 0.15);
  assert.equal(r.per_attempt.length, 1);
  assert.equal(r.per_attempt[0].mode, "std");
  assert.equal(r.per_attempt[0].outcome, "PASS");
});

// ─── std fails (high WER) → fast retry → PASS ──────────────────────────

test("escalates std → fast on WER failure, passes on retry", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v-${mode}.mp4`,
    duration_s: 8,
    cost_credits: mode === "std" ? 50 : 35,
    cost_usd: mode === "std" ? 0.65 : 0.45,
    mode_used: mode,
  }));

  let whisperCallIndex = 0;
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => {
    whisperCallIndex++;
    if (whisperCallIndex === 1) {
      return { transcript: "completely different hallucinated speech", duration_s: 7.6, speech_coverage: 0.9 };
    }
    return { transcript: "Most parents have no idea this is happening", duration_s: 7.6, speech_coverage: 0.95 };
  });

  const r = await verifyAndRetry({
    clipId: "SCENE_02",
    expectedScript: SCRIPT,
    submitFn: submit,
    whisperFn: whisper,
  });

  assert.equal(r.passed, true);
  assert.equal(r.attempts, 2);
  assert.equal(submit.mock.callCount(), 2);
  assert.equal(submit.mock.calls[0].arguments[0], "std");
  assert.equal(submit.mock.calls[1].arguments[0], "fast");
  assert.equal(r.per_attempt[0].outcome, "FAIL_WER");
  assert.equal(r.per_attempt[1].outcome, "PASS");
});

// ─── std + fast both fail → surface to human ────────────────────────────

test("surfaces to human after std AND fast both fail WER", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v-${mode}.mp4`,
    duration_s: 8,
    cost_credits: mode === "std" ? 50 : 35,
    cost_usd: mode === "std" ? 0.65 : 0.45,
    mode_used: mode,
  }));
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => ({
    transcript: "garbage speech that does not match",
    duration_s: 7.6,
    speech_coverage: 0.9,
  }));

  const r = await verifyAndRetry({
    clipId: "SCENE_03",
    expectedScript: SCRIPT,
    submitFn: submit,
    whisperFn: whisper,
  });

  assert.equal(r.passed, false);
  assert.equal(r.attempts, 2);
  assert.equal(r.reason, "surface_to_human");
  assert.equal(submit.mock.callCount(), 2);
});

// ─── Coverage gate (Finding 5: v2 5a 3s-speech-in-8s defect) ────────────

test("FAIL when WER is fine but speech coverage < 0.5 (hallucinated-audio short-speech defect)", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v-${mode}.mp4`,
    duration_s: 8,
    cost_credits: 50,
    cost_usd: 0.65,
    mode_used: mode,
  }));
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => ({
    transcript: "Most parents have no idea this is happening", // perfect WER
    duration_s: 3.0,
    speech_coverage: 0.3, // but only 30% of clip duration
  }));

  const r = await verifyAndRetry({
    clipId: "SCENE_04",
    expectedScript: SCRIPT,
    submitFn: submit,
    whisperFn: whisper,
  });

  assert.equal(r.passed, false);
  assert.equal(r.per_attempt[0].outcome, "FAIL_COVERAGE");
});

// ─── Custom threshold + coverage knob ──────────────────────────────────

test("respects custom werThreshold and coverageFloor", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v.mp4`,
    duration_s: 8,
    cost_credits: 50,
    cost_usd: 0.65,
    mode_used: mode,
  }));
  // Construct a transcript that gives WER ~0.20 (e.g., one word swap in 5 words).
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => ({
    transcript: "Most parents have no clue this is happening", // "idea" → "clue"
    duration_s: 7.6,
    speech_coverage: 0.95,
  }));

  // Strict threshold rejects 0.20 WER on first try (and on retry, since the
  // same whisper fn fires again) → surface.
  const strict = await verifyAndRetry({
    clipId: "S5", expectedScript: SCRIPT, submitFn: submit, whisperFn: whisper, werThreshold: 0.10,
  });
  assert.equal(strict.passed, false);

  // Looser threshold accepts on first try.
  submit.mock.resetCalls();
  whisper.mock.resetCalls();
  const loose = await verifyAndRetry({
    clipId: "S5", expectedScript: SCRIPT, submitFn: submit, whisperFn: whisper, werThreshold: 0.30,
  });
  assert.equal(loose.passed, true);
});

// ─── Surfacing transport / hallucination errors (no retry past 2) ──────

test("returns surface result if submitFn throws on both attempts", async () => {
  let callIdx = 0;
  const submit = mock.fn(async (_mode: "std" | "fast"): Promise<SubmitResult> => {
    callIdx++;
    throw new Error(`transport failure ${callIdx}`);
  });
  const whisper = mock.fn(async (): Promise<WhisperOutcome> => ({
    transcript: "", duration_s: 0, speech_coverage: 0,
  }));

  const r = await verifyAndRetry({
    clipId: "S6", expectedScript: SCRIPT, submitFn: submit, whisperFn: whisper,
  });

  assert.equal(r.passed, false);
  assert.equal(r.reason, "surface_to_human");
  assert.equal(r.attempts, 2);
  assert.equal(r.per_attempt[0].outcome, "FAIL_SUBMIT");
  assert.equal(r.per_attempt[1].outcome, "FAIL_SUBMIT");
  assert.ok(r.per_attempt[0].error?.includes("transport failure"));
});

// ─── Cost aggregation ──────────────────────────────────────────────────

test("aggregates total credits + USD across attempts", async () => {
  const submit = mock.fn(async (mode: "std" | "fast"): Promise<SubmitResult> => ({
    job_id: `j-${mode}`,
    video_url: `https://example.com/v.mp4`,
    duration_s: 8,
    cost_credits: mode === "std" ? 50 : 35,
    cost_usd: mode === "std" ? 0.65 : 0.45,
    mode_used: mode,
  }));
  // First WER fails, second passes → both attempts billed.
  let i = 0;
  const whisper = mock.fn(async (): Promise<WhisperOutcome> =>
    ++i === 1
      ? { transcript: "garbage", duration_s: 7, speech_coverage: 0.8 }
      : { transcript: "Most parents have no idea this is happening", duration_s: 7.6, speech_coverage: 0.95 },
  );

  const r = await verifyAndRetry({
    clipId: "S7", expectedScript: SCRIPT, submitFn: submit, whisperFn: whisper,
  });

  assert.equal(r.passed, true);
  assert.equal(r.total_credits, 85);
  assert.ok(Math.abs(r.total_usd - 1.10) < 0.001);
});
