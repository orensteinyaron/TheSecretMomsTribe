// Pixel inspection of a named region of a frame. Used by
// watermark_compliance (does the bottom-right contain non-trivial content?)
// and potentially by hook-overlay color checks.

import sharp from "sharp";

export type Region = { x_pct: number; y_pct: number; w_pct: number; h_pct: number };

export type RegionStats = {
  mean_intensity: number; // 0-255
  pixel_variance: number; // per-channel variance averaged
  width_px: number;
  height_px: number;
};

export async function regionStats(framePath: string, region: Region): Promise<RegionStats> {
  const meta = await sharp(framePath).metadata();
  const fw = meta.width ?? 0;
  const fh = meta.height ?? 0;
  if (fw === 0 || fh === 0) throw new Error(`frame has no width/height: ${framePath}`);

  const x = Math.max(0, Math.floor((region.x_pct / 100) * fw));
  const y = Math.max(0, Math.floor((region.y_pct / 100) * fh));
  const w = Math.max(1, Math.min(fw - x, Math.floor((region.w_pct / 100) * fw)));
  const h = Math.max(1, Math.min(fh - y, Math.floor((region.h_pct / 100) * fh)));

  const { data, info } = await sharp(framePath)
    .extract({ left: x, top: y, width: w, height: h })
    .raw()
    .removeAlpha()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    sumSq += data[i] * data[i];
    n += 1;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return { mean_intensity: mean, pixel_variance: variance, width_px: w, height_px: h };
}

// Watermark presence heuristic: the SMT watermark is a small light mark in
// the bottom-right. A frame WITHOUT a watermark has bottom-right pixels
// matching the underlying video (typically darker, low-variance for skin /
// background). The watermark introduces high-variance bright pixels.
//
// Test: bottom-right region (last 10% width, last 8% height) must have
// pixel variance >= 200 (matches existing qa-agent.ts heuristic). Variance
// is a proxy for "this region contains an overlay shape", not "the right
// shape" — caught by hook_overlay_style as it lands.
export const WATERMARK_REGION: Region = {
  x_pct: 87,
  y_pct: 88,
  w_pct: 12,
  h_pct: 10,
};

export const WATERMARK_MIN_VARIANCE = 200;
