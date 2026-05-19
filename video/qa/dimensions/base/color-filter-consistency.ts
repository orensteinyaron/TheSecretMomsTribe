// color_filter_consistency — sample frames from a raw input clip and the
// composited output at matched timestamps, compute LAB stats per frame,
// and judge whether the declared filter_setting was actually applied.
//
// For Avatar Full v3 (declared filter_setting='none'): raw and composited
// must be near-identical (delta_B and delta_sat under tolerance).
// For Moving Images v2 (declared 'warm_light'): composited must be
// measurably warmer (delta_B negative, delta_sat positive).
//
// Requires at least one clip with both a raw path/url AND knowledge of
// where in the composited output it appears (clip.start_offset_in_final_s).

import path from "path";
import { existsSync } from "fs";
import type { DimensionResult } from "../../schemas/qa-dimension.js";
import type { RenderProfileConfig, ClipMeta } from "../../base/qa-contract.js";
import { downloadFile } from "../../../lib/qa-helpers.js";
import { extractFrameTo } from "../../base/helpers/frame-sampling.js";
import { labStats, judgeFilter } from "../../base/helpers/color-lab.js";

async function ensureLocal(clip: ClipMeta, workdir: string): Promise<string> {
  if (clip.local_path && existsSync(clip.local_path)) return clip.local_path;
  if (!clip.url) throw new Error(`clip ${clip.id} has neither local_path nor url`);
  const dest = path.join(workdir, `cf-raw-${clip.id}.mp4`);
  if (!existsSync(dest)) await downloadFile(clip.url, dest);
  return dest;
}

export async function runColorFilterConsistency(input: {
  asset_path: string;
  profile_config: RenderProfileConfig;
  clips?: ClipMeta[];
  workdir: string;
}): Promise<DimensionResult> {
  const declared = input.profile_config.output_spec.filter_setting;

  if (!input.clips || input.clips.length === 0) {
    return {
      name: "color_filter_consistency",
      status: "UNMEASURED",
      details: `No raw clips provided — dimension requires at least one raw input clip with start_offset_in_final_s to compare against composited output. Declared filter_setting=${declared}; cannot verify.`,
    };
  }

  // Pick a representative clip with both a raw source and a known offset.
  const sample = input.clips.find(c => (c.url || c.local_path) && typeof c.start_offset_in_final_s === "number");
  if (!sample) {
    return {
      name: "color_filter_consistency",
      status: "UNMEASURED",
      details: `Clips present but none has start_offset_in_final_s set. Cannot align raw vs composited frames.`,
    };
  }

  const rawLocal = await ensureLocal(sample, input.workdir);
  // Sample at the clip's mid-point in its own timeline.
  const rawMidT = sample.duration_s / 2;
  // Same content at composited's timeline: start_offset_in_final_s + rawMidT (less any crossfade overlap; the LAB metric is robust to small misalignment so we accept the simple sum).
  const compositedT = (sample.start_offset_in_final_s ?? 0) + rawMidT;

  const rawFrame = extractFrameTo(rawLocal, rawMidT, input.workdir, `cf-raw-${sample.id}`);
  const compositedFrame = extractFrameTo(input.asset_path, compositedT, input.workdir, `cf-comp-${sample.id}`);

  const [rawStats, compStats] = await Promise.all([
    labStats(rawFrame),
    labStats(compositedFrame),
  ]);

  const verdict = judgeFilter(rawStats, compStats, declared);

  return {
    name: "color_filter_consistency",
    status: verdict.pass ? "PASS" : "FAIL",
    details: verdict.reason,
    evidence: [
      `raw mean LAB: L=${rawStats.mean_L.toFixed(1)} A=${rawStats.mean_A.toFixed(1)} B=${rawStats.mean_B.toFixed(1)} sat=${rawStats.mean_sat.toFixed(1)}`,
      `composited mean LAB: L=${compStats.mean_L.toFixed(1)} A=${compStats.mean_A.toFixed(1)} B=${compStats.mean_B.toFixed(1)} sat=${compStats.mean_sat.toFixed(1)}`,
      `deltas: L=${verdict.delta_L.toFixed(1)} A=${verdict.delta_A.toFixed(1)} B=${verdict.delta_B.toFixed(1)} sat=${verdict.delta_sat.toFixed(1)}`,
      `declared filter_setting=${declared}`,
      rawFrame,
      compositedFrame,
    ],
  };
}
