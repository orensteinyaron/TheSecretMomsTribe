// Frame sampling utilities. Wraps the existing ffmpeg helpers in
// video/lib/qa-helpers.ts and provides higher-level sampling patterns
// (3 frames per clip, N frames around a timestamp, etc.).

import path from "path";
import { extractFrame, probeDurationSeconds } from "../../../lib/qa-helpers.js";

export function clampTimestamp(t: number, durationS: number): number {
  return Math.max(0, Math.min(t, Math.max(0, durationS - 0.05)));
}

// Three frames per clip: start (0.5s), middle, end (-0.5s).
export function startMiddleEnd(durationS: number): [number, number, number] {
  return [
    clampTimestamp(0.5, durationS),
    clampTimestamp(durationS / 2, durationS),
    clampTimestamp(durationS - 0.5, durationS),
  ];
}

// N frames evenly spaced across a duration window.
export function evenlySpacedTimestamps(durationS: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [durationS / 2];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = durationS * (i + 0.5) / n;
    out.push(clampTimestamp(t, durationS));
  }
  return out;
}

// N frames around a timestamp at +/- (k - 1)/2 frame offsets. Used by
// transition-signature: at boundary t, sample t-2/fps, t-1/fps, t, t+1/fps, t+2/fps.
export function framesAroundTimestamp(t: number, n: number, fps: number, totalDurationS: number): number[] {
  const halfWindow = (n - 1) / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const offset = (i - halfWindow) / fps;
    out.push(clampTimestamp(t + offset, totalDurationS));
  }
  return out;
}

// Convenience: extract a frame to <workdir>/<prefix>-<timestamp>.jpg.
export function extractFrameTo(
  videoPath: string,
  timestampS: number,
  workdir: string,
  prefix: string,
): string {
  const outPath = path.join(workdir, `${prefix}-${timestampS.toFixed(3)}.jpg`);
  extractFrame(videoPath, timestampS, outPath);
  return outPath;
}

export { probeDurationSeconds };
