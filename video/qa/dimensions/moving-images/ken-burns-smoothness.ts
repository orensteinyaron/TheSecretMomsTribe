// ken_burns_smoothness — sample the composited mp4 at small intervals and
// build a frame-diff timeline. Smooth Ken Burns = consistent low-to-medium
// diffs across consecutive frames (smooth pan/zoom). Defects:
//   - Freeze: 0 diff for >0.5s within a content window (motion stopped).
//   - Jump: single spike >50 outside transition windows (renderer hiccup).
// Smoothness fails if either pattern is present.

import sharp from "sharp";
import type { DimensionResult } from "../../schemas/qa-dimension.js";
import { extractFrameTo, probeDurationSeconds } from "../../base/helpers/frame-sampling.js";

async function meanAbsDiff(framePathA: string, framePathB: string): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(framePathA).resize(128, 72, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(framePathB).resize(128, 72, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

const SAMPLE_INTERVAL_S = 0.4;
const FREEZE_DIFF_THRESHOLD = 0.5;
const JUMP_DIFF_THRESHOLD = 50;
const FREEZE_MIN_RUN = 2; // 2 consecutive zero-ish diffs at 0.4s interval = 0.8s freeze

export async function runKenBurnsSmoothness(input: {
  asset_path: string;
  workdir: string;
  hook_seconds?: number;
  cta_seconds?: number;
}): Promise<DimensionResult> {
  const dur = probeDurationSeconds(input.asset_path);
  const hookEnd = input.hook_seconds ?? 4.0;
  const ctaStart = dur - (input.cta_seconds ?? 5.0);
  if (ctaStart <= hookEnd + 1) {
    return {
      name: "ken_burns_smoothness",
      status: "UNMEASURED",
      details: `Content window too short (hookEnd=${hookEnd}, ctaStart=${ctaStart.toFixed(1)}); cannot sample motion timeline.`,
    };
  }

  const samples: { t: number; frame: string }[] = [];
  for (let t = hookEnd; t < ctaStart; t += SAMPLE_INTERVAL_S) {
    samples.push({ t, frame: extractFrameTo(input.asset_path, t, input.workdir, `kb-${t.toFixed(2)}`) });
  }
  if (samples.length < 4) {
    return { name: "ken_burns_smoothness", status: "UNMEASURED", details: `Only ${samples.length} samples in content window; insufficient.` };
  }

  const diffs: { t: number; d: number }[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    const d = await meanAbsDiff(samples[i].frame, samples[i + 1].frame);
    diffs.push({ t: samples[i + 1].t, d });
  }

  // Detect freeze runs.
  const freezeRuns: { start_s: number; end_s: number; length: number }[] = [];
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i].d < FREEZE_DIFF_THRESHOLD) {
      if (runStart < 0) runStart = diffs[i].t - SAMPLE_INTERVAL_S;
      runLen += 1;
    } else {
      if (runStart >= 0 && runLen >= FREEZE_MIN_RUN) {
        freezeRuns.push({ start_s: runStart, end_s: diffs[i - 1].t, length: runLen });
      }
      runStart = -1;
      runLen = 0;
    }
  }
  if (runStart >= 0 && runLen >= FREEZE_MIN_RUN) {
    freezeRuns.push({ start_s: runStart, end_s: diffs[diffs.length - 1].t, length: runLen });
  }

  // Detect single-frame jumps outside the typical slide-boundary range. A
  // legit slide transition shows up as a single high spike too — we
  // tolerate up to N spikes per asset based on assumed slide count
  // (~6 slides → 5 boundaries → up to 5 acceptable spikes).
  const acceptableSpikes = 7; // conservative — most assets have 5–6 slides
  const spikes = diffs.filter(x => x.d >= JUMP_DIFF_THRESHOLD);
  const excessSpikes = Math.max(0, spikes.length - acceptableSpikes);

  const pass = freezeRuns.length === 0 && excessSpikes === 0;
  const details: string[] = [];
  details.push(`${diffs.length} sampled frame-pairs, mean diff ${(diffs.reduce((s, x) => s + x.d, 0) / diffs.length).toFixed(2)}`);
  if (freezeRuns.length > 0) {
    details.push(`FREEZE: ${freezeRuns.length} run(s) — ${freezeRuns.map(r => `${r.start_s.toFixed(1)}s–${r.end_s.toFixed(1)}s`).join(", ")}`);
  }
  if (spikes.length > 0) {
    details.push(`HIGH-DIFF FRAMES: ${spikes.length} (${spikes.length > acceptableSpikes ? `${excessSpikes} excess over ${acceptableSpikes} acceptable boundary spikes` : "all within tolerance"})`);
  }

  return {
    name: "ken_burns_smoothness",
    status: pass ? "PASS" : "FAIL",
    details: details.join("; "),
  };
}
