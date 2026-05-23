// Post-process normalization spike — Avatar Full v5 Phase 9 P9.4.
//
// Takes the existing 7 verified Seedance clips and applies per-clip
// ffmpeg scale+crop to bring all faces to a uniform position + size in
// the output frame. Audio passthrough preserved (`-c:a copy`).
//
// Strategy:
//   1. target_face_h = max(face_h across clips) × 1.08 — ensures every
//      clip scales UP, so cropping never letterboxes.
//   2. For each clip:
//        scale = target_face_h / clip.face_h
//        scaled = (1080 × scale, 1920 × scale)
//        crop_x = clip.face_x × scale - 540   (center face_x at frame center)
//        crop_y = clip.eye_y × scale - 600    (eyeline lands at y=600 ≈ 1/3 from top)
//        ffmpeg scale=W:H, crop=1080:1920:cropX:cropY, -c:a copy
//   3. Backup originals to clips/orig/ before overwriting.
//
// Limitations:
//   - Static crop based on START frame; intra-clip face drift NOT corrected.
//   - Re-encodes video (h264 CRF 18) — small generational quality loss.
//   - Loses ~10-25 % of horizontal/vertical content depending on scale.
//
// Usage:
//   npx tsx scripts/normalize-clips.ts <workdir>
//
// Assumes:
//   - workdir/clips/<id>.mp4 exists for each PASS clip in state
//   - workdir/v5-state.json has face_metrics for each clip (run --phase=face-metrics first)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadState, saveState } from "../lib/v5-state.js";

const FRAME_W = 1080;
const FRAME_H = 1920;
const TARGET_EYE_Y_OUT = 600;   // ~1/3 from top, matches the distance-lock prompt
const TARGET_FACE_X_OUT = 540;  // horizontal center

const workdir = process.argv[2];
if (!workdir) {
  console.error("usage: normalize-clips.ts <workdir>");
  process.exit(2);
}

const state = loadState(workdir);
if (!state.face_metrics) {
  console.error("face_metrics missing — run --phase=face-metrics first");
  process.exit(2);
}

const passClips = state.clips.filter((c) => c.verify_status === "PASS");
const clipsDir = path.join(workdir, "clips");
const origDir = path.join(clipsDir, "orig");
fs.mkdirSync(origDir, { recursive: true });

// Choose target face_h ≥ max so every clip scales up (no letterbox margin).
const maxFaceH = Math.max(...passClips.map((c) => state.face_metrics![c.id]!.start!.face_h));
const TARGET_FACE_H = Math.round(maxFaceH * 1.08);
console.log(`target face_h = ${TARGET_FACE_H} (max ${maxFaceH} × 1.08)`);
console.log("");
console.log("clip       scale  scaled_W  scaled_H  crop_x  crop_y");

for (const clip of passClips) {
  const m = state.face_metrics![clip.id]!.start!;
  const scale = TARGET_FACE_H / m.face_h;
  const sW = Math.round(FRAME_W * scale);
  const sH = Math.round(FRAME_H * scale);
  let cropX = Math.round(m.face_x * scale) - TARGET_FACE_X_OUT;
  let cropY = Math.round(m.eye_y * scale) - TARGET_EYE_Y_OUT;
  cropX = Math.max(0, Math.min(sW - FRAME_W, cropX));
  cropY = Math.max(0, Math.min(sH - FRAME_H, cropY));
  console.log(`${clip.id.padEnd(10)} ${scale.toFixed(3)}  ${String(sW).padStart(8)}  ${String(sH).padStart(8)}  ${String(cropX).padStart(6)}  ${String(cropY).padStart(6)}`);

  const inPath = path.join(clipsDir, `${clip.id}.mp4`);
  const backupPath = path.join(origDir, `${clip.id}.mp4`);
  if (!fs.existsSync(backupPath)) fs.copyFileSync(inPath, backupPath);

  const tmpOut = path.join(clipsDir, `${clip.id}.norm.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-i", backupPath,
    "-filter:v", `scale=${sW}:${sH},crop=${FRAME_W}:${FRAME_H}:${cropX}:${cropY}`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-c:a", "copy",
    "-movflags", "+faststart",
    tmpOut,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  fs.renameSync(tmpOut, inPath);
}

// Wipe face_metrics + manifest so the next --phase=face-metrics run
// re-measures the normalized clips and the manifest reflects the new
// (much smaller) deltas.
delete state.face_metrics;
delete state.transitions_manifest;
saveState(state);
console.log("\nnormalized 7 clips; cleared face_metrics + transitions_manifest in state");
console.log("next: --phase=face-metrics --phase=manifest --phase=compose --phase=upload --phase=summary");
