import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initState, loadState, saveState, statePath } from "../v5-state.js";

// Hermetic tests for the v5 orchestrator CLI. We don't exercise the network-
// touching phases (tts, verify, face-metrics, compose, upload, qa) — those are
// integration-tested by Phase 9. These tests target the state mutation logic +
// the summary-phase bridge-timestamp math, which is the most-load-bearing piece
// of the human-review surface.

const SCRIPT = path.resolve(import.meta.dirname ?? __dirname, "..", "..", "scripts", "render-avatar-full-v5.ts");

function makeWorkdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v5-orchestrator-test-"));
}

function runCli(workdir: string, extraArgs: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, `--workdir=${workdir}`, ...extraArgs], { encoding: "utf-8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// PR-B added 4 required combination fields to initState (look_id, location_id,
// still_id, start_image_url) that phaseInit resolves via pickCombination. These
// orchestrator tests don't exercise that resolution — they target CLI dispatch,
// state mutation, and summary math — so they pass deterministic placeholders.
const TEST_COMBO = {
  look_id: "look_01",
  location_id: "location_01",
  still_id: "still_test",
  start_image_url: "https://example.com/test-still.png",
} as const;
function testInitState(opts: Parameters<typeof initState>[0]) {
  return initState({ ...TEST_COMBO, ...opts });
}

// ─── State helpers ──────────────────────────────────────────────────────

test("initState shape: clips have expected fields, no verify yet", () => {
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c1",
      workdir,
      hook_text: "hook",
      register: "concerned_insider",
      clips: [
        { id: "SCENE_01", expected_script: "line A", duration_target_s: 8 },
        { id: "SCENE_02", expected_script: "line B", duration_target_s: 8 },
      ],
    });
    assert.equal(s.clips.length, 2);
    assert.equal(s.clips[0].verify_status, undefined);
    assert.equal(s.total_higgsfield_credits, 0);
    saveState(s);
    const loaded = loadState(workdir);
    assert.deepEqual(loaded, s);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test("loadState throws when state file is missing", () => {
  const workdir = makeWorkdir();
  try {
    assert.throws(() => loadState(workdir), /v5-state\.json not found/);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

// ─── --phase=record: cost accounting + hard ceiling ─────────────────────

test("--phase=record accumulates credits and USD into state totals", () => {
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c1", workdir, hook_text: "h", register: "concerned_insider",
      clips: [{ id: "S1", expected_script: "x", duration_target_s: 8 }],
    });
    saveState(s);

    const r = runCli(workdir, [
      "--phase=record", "--clip-id=S1",
      "--job-id=j-1", "--video-url=https://x.com/c.mp4",
      "--cost-credits=50", "--cost-usd=0.65", "--mode=std",
    ]);
    assert.equal(r.status, 0, `record exited ${r.status}: ${r.stderr}`);
    const after = loadState(workdir);
    assert.equal(after.clips[0].seedance_job_id, "j-1");
    assert.equal(after.clips[0].seedance_cost_credits, 50);
    assert.equal(after.clips[0].verify_attempts, 1);
    assert.equal(after.total_higgsfield_credits, 50);
    assert.ok(Math.abs(after.total_usd! - 0.65) < 1e-9);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test("--phase=record aborts (exit 4) when cumulative > 700 credits", () => {
  // Hard ceiling sized against the ACTUAL clip_01 cost observed in
  // the deepfakes acceptance run (81cr at 1080p std). 7 × 81 = 567cr
  // base + 153cr YAR-137 spike margin = 720cr → ceiling 700cr. Revised
  // from 600cr during Phase 9 after the YAR-137 distance-lock spike
  // re-rendered clip_02 + clip_05b.
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c1", workdir, hook_text: "h", register: "concerned_insider",
      clips: [{ id: "S1", expected_script: "x", duration_target_s: 8 }],
    });
    s.total_higgsfield_credits = 650;
    s.total_usd = 8.45;
    saveState(s);

    const r = runCli(workdir, [
      "--phase=record", "--clip-id=S1",
      "--job-id=j-2", "--video-url=https://x.com/c.mp4",
      "--cost-credits=81", "--cost-usd=1.05", "--mode=fast",
    ]);
    assert.equal(r.status, 4, `expected exit 4 (ceiling abort), got ${r.status}. stderr: ${r.stderr}`);
    assert.match(r.stderr + r.stdout, /hard ceiling 700/);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

// ─── --phase=summary: bridge-timestamp math ─────────────────────────────

test("--phase=summary prints bridge timestamps at the correct moments", () => {
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c1", workdir, hook_text: "the hook", register: "concerned_insider",
      clips: [
        { id: "S1", expected_script: "a", duration_target_s: 9 },
        { id: "S2", expected_script: "b", duration_target_s: 8 },
        { id: "S3", expected_script: "c", duration_target_s: 8 },
      ],
    });
    // Mark all PASS with known whisper durations.
    s.clips[0] = { ...s.clips[0], verify_status: "PASS", verify_mode_used: "std", whisper_wer: 0.02, whisper_duration_s: 9.0 };
    s.clips[1] = { ...s.clips[1], verify_status: "PASS", verify_mode_used: "std", whisper_wer: 0.05, whisper_duration_s: 8.0 };
    s.clips[2] = { ...s.clips[2], verify_status: "PASS", verify_mode_used: "std", whisper_wer: 0.03, whisper_duration_s: 8.0 };
    s.transitions_manifest = {
      transitions: [
        { cut_index: 0, from_clip_id: "S1", to_clip_id: "S2", eye_line_delta_px: 52, face_center_delta_pct: 0.03, needs_motion_blur: true,  bridge_enabled: true },
        { cut_index: 1, from_clip_id: "S2", to_clip_id: "S3", eye_line_delta_px: 10, face_center_delta_pct: 0.02, needs_motion_blur: false, bridge_enabled: false },
      ],
      crops: [
        { clip_id: "S1", crop_offset_y: 0 },
        { clip_id: "S2", crop_offset_y: -10 },
        { clip_id: "S3", crop_offset_y: 5 },
      ],
      median_start_eye_y: 665,
    };
    s.total_higgsfield_credits = 165;
    s.total_usd = 2.15;
    saveState(s);

    const r = runCli(workdir, ["--phase=summary"]);
    assert.equal(r.status, 0, `summary exited ${r.status}: ${r.stderr}`);
    const out = r.stdout;

    // S1 → S2 bridged → at (9.0 - 4/30) ≈ 8.867s. Hexadecimal-precise compare on the formatted value.
    assert.match(out, /S1 → S2\s+at t=8\.867s\s+\[BRIDGE\]\s+\+ motion blur/, `missing S1→S2 bridge: ${out}`);
    // S2 → S3 HARD cut (bridge_enabled=false). S2 ends at 8.867 + 8.0 = 16.867s.
    assert.match(out, /S2 → S3\s+at t=16\.867s\s+\[HARD CUT\]/, `missing S2→S3 hard cut: ${out}`);
    // Cost summary present.
    assert.match(out, /165 Higgsfield credits/);
    // Phase 9 fallback hint present.
    assert.match(out, /bridge_enabled=false/);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

// ─── Unknown phase + missing args ───────────────────────────────────────

test("CLI rejects unknown --phase=", () => {
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c", workdir, hook_text: "h", register: "concerned_insider",
      clips: [{ id: "S1", expected_script: "x", duration_target_s: 8 }],
    });
    saveState(s);
    const r = runCli(workdir, ["--phase=bogus"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown --phase=bogus/);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI rejects missing required arg with clear error", () => {
  const workdir = makeWorkdir();
  try {
    const s = testInitState({
      content_id: "c", workdir, hook_text: "h", register: "concerned_insider",
      clips: [{ id: "S1", expected_script: "x", duration_target_s: 8 }],
    });
    saveState(s);
    const r = runCli(workdir, ["--phase=record"]); // missing --clip-id, --job-id, etc.
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /clip-id|--clip-id/);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
