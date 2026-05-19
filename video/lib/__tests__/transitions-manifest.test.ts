import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTransitionsManifest,
  DEFAULT_THRESHOLDS,
  type ClipMetrics,
} from "../transitions-manifest.js";

const FRAME_W = 1080;

// ─── Per-cut delta math ─────────────────────────────────────────────────

test("computes eye_line_delta_px and face_center_delta_pct per cut", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 560, face_x: 600 }, end: { eye_y: 555, face_x: 600 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions.length, 1);
  assert.equal(m.transitions[0].cut_index, 0);
  assert.equal(m.transitions[0].from_clip_id, "c1");
  assert.equal(m.transitions[0].to_clip_id, "c2");
  assert.equal(m.transitions[0].eye_line_delta_px, 50); // |510 - 560|
  // |540 - 600| / 1080 ≈ 0.0556
  assert.ok(Math.abs(m.transitions[0].face_center_delta_pct - 60 / 1080) < 1e-9);
});

test("no transitions emitted for a single clip", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "only", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 500, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions.length, 0);
  assert.equal(m.crops.length, 1);
});

test("emits N-1 transitions for N clips, in order", () => {
  const clips: ClipMetrics[] = Array.from({ length: 6 }, (_, i) => ({
    clip_id: `c${i + 1}`,
    start: { eye_y: 500, face_x: 540 },
    end: { eye_y: 500, face_x: 540 },
  }));
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(m.transitions[i].cut_index, i);
    assert.equal(m.transitions[i].from_clip_id, `c${i + 1}`);
    assert.equal(m.transitions[i].to_clip_id, `c${i + 2}`);
  }
});

// ─── Motion-blur threshold gating ───────────────────────────────────────

test("needs_motion_blur=true when eye_line_delta_px > 40 (default threshold)", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 560, face_x: 540 }, end: { eye_y: 555, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions[0].eye_line_delta_px, 50);
  assert.equal(m.transitions[0].needs_motion_blur, true);
});

test("needs_motion_blur=true when face_center_delta_pct > 0.08 (default threshold)", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 505, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 510, face_x: 650 }, end: { eye_y: 510, face_x: 650 } }, // 110/1080 ≈ 0.102
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.ok(m.transitions[0].face_center_delta_pct > 0.08);
  assert.equal(m.transitions[0].needs_motion_blur, true);
});

test("needs_motion_blur=false when both deltas are below thresholds", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 505, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 515, face_x: 555 }, end: { eye_y: 510, face_x: 555 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions[0].eye_line_delta_px, 10);
  assert.ok(m.transitions[0].face_center_delta_pct < 0.02);
  assert.equal(m.transitions[0].needs_motion_blur, false);
});

test("default thresholds exported and equal to spec values", () => {
  assert.equal(DEFAULT_THRESHOLDS.eye_line_delta_px, 40);
  assert.equal(DEFAULT_THRESHOLDS.face_center_delta_pct, 0.08);
});

test("custom thresholds override defaults", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 525, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 550, face_x: 540 }, end: { eye_y: 550, face_x: 540 } },
  ];
  // eye_delta = 25
  const lenient = buildTransitionsManifest({
    clips, frame_width: FRAME_W,
    thresholds: { eye_line_delta_px: 30, face_center_delta_pct: 0.10 },
  });
  assert.equal(lenient.transitions[0].needs_motion_blur, false);

  const strict = buildTransitionsManifest({
    clips, frame_width: FRAME_W,
    thresholds: { eye_line_delta_px: 20, face_center_delta_pct: 0.10 },
  });
  assert.equal(strict.transitions[0].needs_motion_blur, true);
});

// ─── crop_offset_y normalization ────────────────────────────────────────

test("crop_offset_y normalizes each clip's start_eye_y to the median", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 500, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 510, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
    { clip_id: "c3", start: { eye_y: 520, face_x: 540 }, end: { eye_y: 520, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  // odd N: median = middle value = 510
  assert.equal(m.median_start_eye_y, 510);
  assert.equal(m.crops.find(c => c.clip_id === "c1")!.crop_offset_y, 10);
  assert.equal(m.crops.find(c => c.clip_id === "c2")!.crop_offset_y, 0);
  assert.equal(m.crops.find(c => c.clip_id === "c3")!.crop_offset_y, -10);
});

test("crop_offset_y uses upper-median for even N (deterministic tie-break)", () => {
  const clips: ClipMetrics[] = [
    { clip_id: "c1", start: { eye_y: 100, face_x: 540 }, end: { eye_y: 100, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 200, face_x: 540 }, end: { eye_y: 200, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  // Sorted: [100, 200]. Upper-median pick = 200 (index Math.floor(2/2) = 1).
  assert.equal(m.median_start_eye_y, 200);
});

test("crop_offset_y preserves clip order independent of input metric order", () => {
  // Same 3 clips, reordered as input — output crops array should still be
  // keyed by clip_id and the offsets should match.
  const clips: ClipMetrics[] = [
    { clip_id: "c3", start: { eye_y: 520, face_x: 540 }, end: { eye_y: 520, face_x: 540 } },
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 500, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 510, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  // crops[] should be in input order — c3 first.
  assert.equal(m.crops[0].clip_id, "c3");
  assert.equal(m.crops[0].crop_offset_y, -10);
  assert.equal(m.crops[1].clip_id, "c1");
  assert.equal(m.crops[1].crop_offset_y, 10);
});

// ─── Empty input ───────────────────────────────────────────────────────

test("empty clips input yields empty manifest", () => {
  const m = buildTransitionsManifest({ clips: [], frame_width: FRAME_W });
  assert.equal(m.transitions.length, 0);
  assert.equal(m.crops.length, 0);
  assert.equal(m.median_start_eye_y, 0);
});
