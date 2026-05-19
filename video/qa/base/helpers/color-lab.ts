// LAB-space color statistics for filter-consistency dimension.
//
// Raw RGB histograms + KL divergence are brittle to compression-level
// luminance shifts. LAB is perceptually uniform: deltaB tracks warm/cool
// shift directly, and saturation can be approximated from A/B magnitude.
//
// We compare a sampled frame from the raw input clip against a frame from
// the composited output at a matched timestamp, and judge whether the
// declared filter (none / warm_light / warm_golden) actually got applied.

import sharp from "sharp";

export type LabStats = {
  mean_L: number;
  mean_A: number;
  mean_B: number;
  mean_sat: number; // sqrt(A^2 + B^2) averaged across pixels (in LAB-distance units)
  width: number;
  height: number;
};

// sRGB -> linear RGB (gamma decode)
function srgbToLinear(c: number): number {
  const cn = c / 255;
  return cn <= 0.04045 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
}

// CIE D65 reference white in XYZ
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

// One pixel: sRGB triplet -> LAB
function pixelToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  // sRGB D65 -> XYZ
  const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const A = 500 * (fx - fy);
  const B = 200 * (fy - fz);
  return [L, A, B];
}

// Compute LAB stats by downscaling the frame to a small thumbnail (cheap,
// retains color distribution) and averaging per channel.
export async function labStats(framePath: string): Promise<LabStats> {
  const { data, info } = await sharp(framePath)
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumSat = 0;
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const [L, A, B] = pixelToLab(data[i], data[i + 1], data[i + 2]);
    sumL += L;
    sumA += A;
    sumB += B;
    sumSat += Math.sqrt(A * A + B * B);
    n += 1;
  }
  return {
    mean_L: sumL / n,
    mean_A: sumA / n,
    mean_B: sumB / n,
    mean_sat: sumSat / n,
    width: info.width,
    height: info.height,
  };
}

export type FilterVerdict = {
  pass: boolean;
  reason: string;
  delta_L: number;
  delta_A: number;
  delta_B: number;
  delta_sat: number;
};

// Compare raw vs composited LAB stats against declared filter setting.
//
// Thresholds calibrated against the v1 (warm filter) and v3 (no filter)
// proof loop output. None -> deltaB and deltaSat must both be near-zero.
// Warm filter -> composited must be measurably warmer (B-channel drops,
// saturation rises).
export function judgeFilter(
  raw: LabStats,
  composited: LabStats,
  declared: "none" | "warm_light" | "warm_golden",
): FilterVerdict {
  const dL = composited.mean_L - raw.mean_L;
  const dA = composited.mean_A - raw.mean_A;
  const dB = composited.mean_B - raw.mean_B;
  const dSat = composited.mean_sat - raw.mean_sat;

  if (declared === "none") {
    const pass = Math.abs(dB) < 5 && Math.abs(dSat) < 5;
    return {
      pass,
      reason: pass
        ? `delta_B=${dB.toFixed(2)}, delta_sat=${dSat.toFixed(2)} — within tolerance for filter_setting=none`
        : `delta_B=${dB.toFixed(2)} or delta_sat=${dSat.toFixed(2)} exceeds tolerance for filter_setting=none — a filter appears to have been applied`,
      delta_L: dL, delta_A: dA, delta_B: dB, delta_sat: dSat,
    };
  }

  // warm_light or warm_golden: composited should be measurably warmer
  // (HIGHER B = more yellow in LAB) and more saturated than raw. Sign of
  // delta_B for "warmer than raw" is POSITIVE in LAB (B: blue- → yellow+).
  const minDeltaB = declared === "warm_golden" ? 8 : 3;
  const minDeltaSat = declared === "warm_golden" ? 4 : 2;
  const pass = dB >= minDeltaB && dSat >= minDeltaSat;
  return {
    pass,
    reason: pass
      ? `delta_B=${dB.toFixed(2)}, delta_sat=${dSat.toFixed(2)} — composited measurably warmer than raw per filter_setting=${declared}`
      : `delta_B=${dB.toFixed(2)} (need ≥${minDeltaB}) or delta_sat=${dSat.toFixed(2)} (need ≥${minDeltaSat}) — declared filter_setting=${declared} but composited is NOT measurably warmer than raw`,
    delta_L: dL, delta_A: dA, delta_B: dB, delta_sat: dSat,
  };
}
