// watermark_compliance — does the bottom-right of the final video contain
// the SMT watermark? Deterministic pixel check (variance proxy), no LLM call.

import type { DimensionResult } from "../../schemas/qa-dimension.js";
import {
  regionStats,
  WATERMARK_REGION,
  WATERMARK_MIN_VARIANCE,
} from "../../base/helpers/pixel-region-check.js";
import { extractFrameTo, probeDurationSeconds, clampTimestamp } from "../../base/helpers/frame-sampling.js";

export async function runWatermarkCompliance(input: {
  asset_path: string;
  workdir: string;
}): Promise<DimensionResult> {
  const dur = probeDurationSeconds(input.asset_path);
  // Sample the last second of the video; watermark is meant to be visible
  // through the entire piece and the final second is a defensible probe.
  const t = clampTimestamp(dur - 0.5, dur);
  const frame = extractFrameTo(input.asset_path, t, input.workdir, "wm");
  const stats = await regionStats(frame, WATERMARK_REGION);

  const pass = stats.pixel_variance >= WATERMARK_MIN_VARIANCE;
  return {
    name: "watermark_compliance",
    status: pass ? "PASS" : "FAIL",
    details: pass
      ? `bottom-right pixel variance ${stats.pixel_variance.toFixed(0)} >= ${WATERMARK_MIN_VARIANCE} — watermark layer present`
      : `bottom-right pixel variance ${stats.pixel_variance.toFixed(0)} < ${WATERMARK_MIN_VARIANCE} — no detectable watermark in expected region`,
    evidence: [frame],
  };
}
