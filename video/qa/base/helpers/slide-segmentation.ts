// Slide-boundary detection + spoken-text-per-segment for Moving Images
// dimensions. Reconstructs per-slide segments from the final composited
// mp4 + Whisper transcript without requiring the render pipeline to
// persist slide metadata.
//
// Approach:
//   1. Sample frames every N seconds across the full duration.
//   2. Compute mean abs pixel diff between consecutive sampled frames.
//   3. Peaks (diffs > threshold OR > 3x neighbor median) are slide
//      boundaries.
//   4. Each segment = [boundary_i, boundary_i+1]. Spoken text = Whisper
//      words whose start timestamp falls in the segment window.

import path from "path";
import sharp from "sharp";
import type { WhisperWord } from "../../../lib/qa-helpers.js";
import { extractFrameTo } from "./frame-sampling.js";

export type SlideSegment = {
  index: number;
  start_s: number;
  end_s: number;
  duration_s: number;
  spoken_text: string;
  word_count: number;
  representative_frame: string; // mid-segment frame
};

async function meanAbsDiff(framePathA: string, framePathB: string): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(framePathA).resize(128, 72, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(framePathB).resize(128, 72, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

export async function detectSlideSegments(opts: {
  asset_path: string;
  duration_s: number;
  whisper_words: WhisperWord[];
  workdir: string;
  sample_interval_s?: number;
  hook_seconds?: number; // skip first N seconds (the hook overlay)
  cta_seconds?: number; // skip last N seconds (the CTA card)
}): Promise<SlideSegment[]> {
  const interval = opts.sample_interval_s ?? 0.5;
  const hookEnd = opts.hook_seconds ?? 4.0;
  const ctaStart = opts.duration_s - (opts.cta_seconds ?? 5.0);

  // Sample frames inside the content window (skip hook + cta).
  const samples: { t: number; frame: string }[] = [];
  for (let t = hookEnd; t < ctaStart - 0.001; t += interval) {
    const frame = extractFrameTo(opts.asset_path, t, opts.workdir, `seg-${t.toFixed(2)}`);
    samples.push({ t, frame });
  }
  if (samples.length < 2) return [];

  // Pairwise diffs.
  const diffs: number[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    diffs.push(await meanAbsDiff(samples[i].frame, samples[i + 1].frame));
  }
  // Boundary = diff > median * 3 AND > 8 (absolute floor to ignore noise).
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(8, median * 3);

  // Boundary indices in the diffs array; the boundary timestamp is the
  // start of samples[i+1].
  const boundaryTimes: number[] = [hookEnd];
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] >= threshold) boundaryTimes.push(samples[i + 1].t);
  }
  boundaryTimes.push(ctaStart);

  // De-dup boundaries that are within 1s of each other (transition windows
  // can have multiple sampled frames marked as boundary).
  const dedup: number[] = [];
  for (const t of boundaryTimes) {
    if (dedup.length === 0 || t - dedup[dedup.length - 1] >= 1.0) dedup.push(t);
  }
  // Ensure last boundary is ctaStart.
  if (dedup[dedup.length - 1] !== ctaStart) dedup.push(ctaStart);

  // Build segments + assign Whisper words.
  const segments: SlideSegment[] = [];
  for (let i = 0; i + 1 < dedup.length; i++) {
    const startS = dedup[i];
    const endS = dedup[i + 1];
    const midS = (startS + endS) / 2;
    const words = opts.whisper_words.filter(w => w.start >= startS && w.start < endS);
    const spokenText = words.map(w => w.word).join(" ").trim();
    const representativeFrame = extractFrameTo(opts.asset_path, midS, opts.workdir, `seg-mid-${i}`);
    segments.push({
      index: i,
      start_s: startS,
      end_s: endS,
      duration_s: endS - startS,
      spoken_text: spokenText,
      word_count: words.length,
      representative_frame: representativeFrame,
    });
  }
  return segments;
}
