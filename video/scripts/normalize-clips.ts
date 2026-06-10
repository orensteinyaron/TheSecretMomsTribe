// Post-process normalization spike — Avatar Full v5 Phase 9 P9.4.
//
// Takes the existing 7 verified Seedance clips and applies per-clip
// ffmpeg scale+crop to bring all faces to a uniform position + size in
// the output frame. Audio passthrough preserved (`-c:a copy`).
//
// Strategy (UNIFORM scale — YAR-153 background-consistency fix, 2026-06-10):
//   1. UNIFORM_SCALE = one scale for ALL clips = smallest scale that lets every
//      clip's eye-line + face-center alignment fit inside the scaled frame
//      (×1.04 buffer). NOT per-clip face-size equalization — see below.
//   2. For each clip (same scale):
//        scaled = (1080 × S, 1920 × S)
//        crop_x = clip.face_x × S - 540   (center face_x at frame center)
//        crop_y = clip.eye_y × S - 600    (eyeline lands at y=600 ≈ 1/3 from top)
//        ffmpeg scale=W:H, crop=1080:1920:cropX:cropY, -c:a copy
//   3. Backup originals to clips/orig/ before overwriting.
//
// Why uniform (not per-clip face-size equalization): equalizing face_h zoomed
// each clip differently (Seedance renders Rachel at different distances —
// YAR-137), so background decor was cropped from the zoomed clips and kept in
// the wide ones → two visibly different backgrounds. A single scale keeps the
// background zoom identical across clips; only the face is re-positioned by
// crop translation. Face SIZE varies slightly by design (natural for UGC).
//
// Limitations:
//   - Face SIZE is not normalized (intentional); only position is.
//   - Static crop based on START frame; intra-clip face drift NOT corrected.
//   - Re-encodes video (h264 CRF 18) — small generational quality loss.
//   - Eye-line alignment shifts the background vertically up to the frame
//     margin between clips (subject locked, background moves) — far less
//     jarring than decor appearing/disappearing.
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
import { checkBackgroundScaleUniform } from "../lib/background-consistency-check.js";
import { findTailTrimSeconds } from "../lib/tail-trim.js";

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

// UNIFORM scale across all clips (YAR-153 background-consistency fix,
// 2026-06-10). Per-clip scaling (the old `target_face_h / face_h`) equalized
// FACE SIZE but, because Seedance renders Rachel at different distances
// (YAR-137), it zoomed each clip differently — so background decor (e.g. the
// right-wall frames) survived in the low-zoom clips and was cropped out of the
// high-zoom ones, splitting the render into two visibly different backgrounds.
//
// Fix: one scale for EVERY clip → identical background zoom → the same decor is
// present in every clip. Face size is intentionally NOT equalized (a slightly
// closer/further Rachel reads natural for UGC). Only eye-line (vertical) and
// face center (horizontal) are aligned, by per-clip crop TRANSLATION within the
// uniformly-scaled frame. The single scale is the smallest that lets every
// clip's face_x→center / eye_y→target alignment fit inside the scaled frame,
// plus a small safety buffer.
const ALIGN_BUFFER = 1.04;
function minUniformScale(m: { eye_y: number; face_x: number }): number {
  const sEyeTop = TARGET_EYE_Y_OUT / m.eye_y; // cropY ≥ 0
  const sEyeBot = (FRAME_H - TARGET_EYE_Y_OUT) / (FRAME_H - m.eye_y); // cropY ≤ sH-FRAME_H
  const sxL = TARGET_FACE_X_OUT / m.face_x; // cropX ≥ 0
  const sxR = (FRAME_W - TARGET_FACE_X_OUT) / (FRAME_W - m.face_x); // cropX ≤ sW-FRAME_W
  return Math.max(1, sEyeTop, sEyeBot, sxL, sxR);
}
const UNIFORM_SCALE =
  Math.max(...passClips.map((c) => minUniformScale(state.face_metrics![c.id]!.start!))) * ALIGN_BUFFER;
console.log(
  `uniform scale = ${UNIFORM_SCALE.toFixed(3)} — identical background zoom across all clips; ` +
    `face size NOT equalized, eye-line aligned by crop translation`,
);
console.log("");
console.log("clip       scale  scaled_W  scaled_H  crop_x  crop_y  face_h_out");

const appliedScales: number[] = [];
for (const clip of passClips) {
  const m = state.face_metrics![clip.id]!.start!;
  const scale = UNIFORM_SCALE;
  appliedScales.push(scale);
  const sW = Math.round(FRAME_W * scale);
  const sH = Math.round(FRAME_H * scale);
  let cropX = Math.round(m.face_x * scale) - TARGET_FACE_X_OUT;
  let cropY = Math.round(m.eye_y * scale) - TARGET_EYE_Y_OUT;
  cropX = Math.max(0, Math.min(sW - FRAME_W, cropX));
  cropY = Math.max(0, Math.min(sH - FRAME_H, cropY));
  console.log(`${clip.id.padEnd(10)} ${scale.toFixed(3)}  ${String(sW).padStart(8)}  ${String(sH).padStart(8)}  ${String(cropX).padStart(6)}  ${String(cropY).padStart(6)}  ${String(Math.round(m.face_h * scale)).padStart(10)}`);

  const inPath = path.join(clipsDir, `${clip.id}.mp4`);
  const backupPath = path.join(origDir, `${clip.id}.mp4`);
  if (!fs.existsSync(backupPath)) fs.copyFileSync(inPath, backupPath);

  // Decode mono PCM once — used for the silence-aware tail trim and the clip
  // duration.
  const pcmTmp = path.join(clipsDir, `${clip.id}.tail.f32`);
  execFileSync("ffmpeg", ["-y", "-i", backupPath, "-ac", "1", "-ar", "48000", "-f", "f32le", pcmTmp], { stdio: ["pipe", "pipe", "pipe"] });
  const buf = fs.readFileSync(pcmTmp);
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  fs.rmSync(pcmTmp, { force: true });
  const clipDur = pcm.length / 48000;

  // Silence-aware tail trim (Finding 9 / YAR-156): Seedance often appends a
  // transient (mouth click / breath) AFTER the last word, in the trailing
  // silence; stitched, it lands in the gap and is heard as a click at the cut.
  // Snap the cut to the trailing-silence onset after the last word.
  const words = clip.whisper_words ?? [];
  const lastWordEnd = words.length ? words[words.length - 1]!.end : 0;
  let trimTo = clipDur;
  if (lastWordEnd > 0) {
    const t = findTailTrimSeconds(pcm, 48000, lastWordEnd, { minS: lastWordEnd, maxS: clipDur });
    if (t < clipDur - 0.005) {
      trimTo = t;
      console.log(`  ${clip.id} tail-trim: cut at ${t.toFixed(3)}s (last word ${lastWordEnd.toFixed(3)}s, was ${clipDur.toFixed(3)}s)`);
    }
  }
  clip.whisper_duration_s = trimTo; // mounted length = (possibly trimmed) clip length

  // Bake a SAMPLE-ACCURATE audio cross-fade into each clip edge (YAR-156).
  // A Remotion per-frame `volume` envelope steps at frame boundaries → clicks;
  // ffmpeg afade is per-sample and smooth. Fade-out (120 ms) guarantees the clip
  // ends at zero so the splice/overlap has no step; tiny fade-in (20 ms) guards a
  // non-zero first sample. The 4-frame Sequence overlap cross-fades these edges.
  const fadeOutSt = Math.max(0, trimTo - 0.12);
  const afade = `afade=t=in:st=0:d=0.02,afade=t=out:st=${fadeOutSt.toFixed(3)}:d=0.12`;

  const tmpOut = path.join(clipsDir, `${clip.id}.norm.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-i", backupPath,
    "-t", trimTo.toFixed(3),
    "-filter:v", `scale=${sW}:${sH},crop=${FRAME_W}:${FRAME_H}:${cropX}:${cropY}`,
    "-af", afade,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    tmpOut,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  fs.renameSync(tmpOut, inPath);
}

// Background-consistency gate (YAR-153): all clips MUST share one scale, else
// they get different zoom → decor cropped from some clips and not others.
const bgScale = checkBackgroundScaleUniform(appliedScales);
console.log(
  `\nbackground-scale QA: ${bgScale.verdict} (ratio ${bgScale.ratio.toFixed(4)} ≤ ${bgScale.tolerance}; ` +
    `scales ${bgScale.min_scale.toFixed(3)}–${bgScale.max_scale.toFixed(3)})`,
);
if (bgScale.verdict === "FAIL") {
  console.error(
    `[normalize] ⚠ BACKGROUND-SCALE QA FAILED — clips were scaled non-uniformly ` +
      `(ratio ${bgScale.ratio.toFixed(3)}). This causes inconsistent backgrounds (decor cropped from ` +
      `high-zoom clips). normalize must apply a single uniform scale. Aborting.`,
  );
  process.exit(3);
}

// Wipe face_metrics + manifest so the next --phase=face-metrics run
// re-measures the normalized clips and the manifest reflects the new
// (much smaller) deltas.
delete state.face_metrics;
delete state.transitions_manifest;
saveState(state);
console.log(`\nnormalized ${passClips.length} clips; cleared face_metrics + transitions_manifest in state`);
console.log("next: --phase=face-metrics --phase=manifest --phase=compose --phase=upload --phase=summary");
