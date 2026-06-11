// Deterministic band-color guard for SMT thumbnails / covers.
//
// Why this exists: the hook band must be BRAND_PURPLE #63246a (the plum used by
// SMTHookOverlay and the cover banner). On 2026-06-11 a thumbnail shipped with
// the WRONG purple (the bright carousel BRAND_PRIMARY #7941EA) and nothing
// caught it — the cover QA scores identity/scene/sameness, not band color, so
// it reached the live IG grid. This guard samples the band region of a
// generated PNG and fails loudly when the band isn't plum.
//
// It assumes a hook band is present (the pipeline contract puts a hook overlay
// on every avatar piece). Pure + injectable: no network, sharp only.

import sharp from "sharp";

export const BRAND_PURPLE_HEX = "#63246a";
export const BRAND_PURPLE_RGB: RGB = { r: 0x63, g: 0x24, b: 0x6a }; // 99, 36, 106
/** The wrong purple we are guarding against (cover BRAND_PRIMARY). For docs/tests. */
export const BRAND_PRIMARY_HEX = "#7941EA";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface BandRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

// A horizontal strip that sits inside BOTH band variants for ANY hook length on
// a 1080×1920 canvas: the cover banner (rows 1340..1620, fixed) and the
// SMTHookOverlay thumbnail band (top ≈1306; even a short 1-line hook reaches
// ~1485). Rows 1360..1440 are inside both, above where a 1-line band ends, and
// stay inside under the ±14px shift from the -2° rotation. Off-white hook text
// in this strip is excluded by detectBandColor, leaving the band fill.
export const DEFAULT_BAND_REGION: BandRegion = { left: 150, top: 1360, width: 780, height: 80 };

/** Max-channel tolerance. #7941EA vs #63246a differ by 128 on blue, so 28 cleanly separates them while absorbing H264/PNG compression drift on a correct band. */
export const DEFAULT_TOLERANCE = 28;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

export function maxChannelDistance(a: RGB, b: RGB): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/**
 * Median color of the band region, excluding near-white (the off-white hook
 * text) and near-black pixels. Returns null when no band-fill pixels remain.
 */
export async function detectBandColor(png: Buffer, region: BandRegion = DEFAULT_BAND_REGION): Promise<RGB | null> {
  const { data, info } = await sharp(png).extract(region).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i + 2 < data.length; i += ch) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 200 && g > 200 && b > 200) continue; // near-white text
    if (r < 30 && g < 30 && b < 30) continue; // near-black
    rs.push(r);
    gs.push(g);
    bs.push(b);
  }
  if (rs.length === 0) return null;
  return { r: median(rs), g: median(gs), b: median(bs) };
}

export interface BandColorCheck {
  ok: boolean;
  detected: RGB | null;
  distance: number | null;
  expected: RGB;
  tolerance: number;
}

export async function checkBandColor(
  png: Buffer,
  opts: { region?: BandRegion; tolerance?: number } = {},
): Promise<BandColorCheck> {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const detected = await detectBandColor(png, opts.region);
  if (!detected) return { ok: false, detected: null, distance: null, expected: BRAND_PURPLE_RGB, tolerance };
  const distance = maxChannelDistance(detected, BRAND_PURPLE_RGB);
  return { ok: distance <= tolerance, detected, distance, expected: BRAND_PURPLE_RGB, tolerance };
}

/** Throw unless the band region reads as BRAND_PURPLE #63246a. */
export async function assertBandIsBrandPurple(
  png: Buffer,
  opts: { region?: BandRegion; tolerance?: number; label?: string } = {},
): Promise<void> {
  const res = await checkBandColor(png, opts);
  if (res.ok) return;
  const seen = res.detected ? `rgb(${res.detected.r},${res.detected.g},${res.detected.b})` : "no band pixels detected";
  throw new Error(
    `[band-color] ${opts.label ?? "thumbnail"} hook band is not BRAND_PURPLE ${BRAND_PURPLE_HEX} ` +
      `(detected ${seen}, max-channel distance ${res.distance ?? "n/a"} > tolerance ${res.tolerance}). ` +
      `Thumbnails/title cards must use SMTHookOverlay / generate-hook-card (plum #63246a), ` +
      `NOT the cover BRAND_PRIMARY ${BRAND_PRIMARY_HEX}.`,
  );
}
