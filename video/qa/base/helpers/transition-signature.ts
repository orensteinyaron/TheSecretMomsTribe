// Frame-diff signatures for transition_style_verification dimension.
//
// At a declared transition boundary, sample 5 frames at +/- 2 frame offsets
// (relative to the video's fps). Compute mean absolute pixel diff between
// consecutive pairs. The pattern of those 4 diffs reveals the transition
// style:
//
//   HARD CUT     — one large spike at the boundary pair, neighbors small.
//                  Pattern: [low, low, HIGH, low, low] — i.e. one diff
//                  dominates by a factor of >= 3x.
//
//   CROSSFADE    — a span of medium diffs gradually rising then falling.
//                  Pattern: all 4 diffs roughly comparable, no single
//                  dominant spike. Crossfade duration determines the span.

import sharp from "sharp";

export type TransitionSignature = {
  diffs: number[]; // length N-1 where N = sampled frames
  peak_ratio: number; // peak_diff / mean_of_others
  shape: "hard_cut" | "crossfade" | "ambiguous";
};

// Mean abs pixel diff between two same-size frames, downscaled to 128x72
// for speed. Returns value in [0, 255].
async function meanAbsDiff(framePathA: string, framePathB: string): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(framePathA).resize(128, 72, { fit: "fill" }).raw().removeAlpha().toBuffer({ resolveWithObject: true }),
    sharp(framePathB).resize(128, 72, { fit: "fill" }).raw().removeAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.data.length !== b.data.length) {
    throw new Error(`frame size mismatch: ${a.data.length} vs ${b.data.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

export async function computeTransitionSignature(framePaths: string[]): Promise<TransitionSignature> {
  if (framePaths.length < 3) {
    throw new Error(`transition signature needs >= 3 frames, got ${framePaths.length}`);
  }
  const diffs: number[] = [];
  for (let i = 0; i + 1 < framePaths.length; i++) {
    diffs.push(await meanAbsDiff(framePaths[i], framePaths[i + 1]));
  }
  const sorted = [...diffs].sort((a, b) => b - a);
  const peak = sorted[0];
  const otherMean = sorted.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, sorted.length - 1);
  const peakRatio = otherMean > 0.5 ? peak / otherMean : peak / 0.5;

  // Hard cut signature: one diff dominates by 3x+; absolute peak > 8 to
  // avoid classifying low-motion crossfades as "ambiguous cuts".
  // Crossfade signature: peak ratio < 2.5 AND mean of others > 1
  //   (i.e. there's real motion across multiple frames, not all near-zero).
  let shape: TransitionSignature["shape"];
  if (peakRatio >= 3 && peak >= 8) shape = "hard_cut";
  else if (peakRatio < 2.5 && otherMean > 1) shape = "crossfade";
  else shape = "ambiguous";

  return { diffs, peak_ratio: peakRatio, shape };
}

export type TransitionMismatch = {
  match: boolean;
  declared: "hard_cut" | "crossfade" | "not_applicable";
  observed: "hard_cut" | "crossfade" | "ambiguous";
  reason: string;
};

export function judgeTransition(
  signature: TransitionSignature,
  declared: "hard_cut" | "crossfade" | "not_applicable",
): TransitionMismatch {
  if (declared === "not_applicable") {
    return { match: true, declared, observed: signature.shape, reason: "transition_style not applicable to this profile" };
  }
  const match = signature.shape === declared;
  return {
    match,
    declared,
    observed: signature.shape,
    reason: match
      ? `observed ${signature.shape} matches declared ${declared} (peak_ratio=${signature.peak_ratio.toFixed(2)}, diffs=${signature.diffs.map(d => d.toFixed(1)).join(", ")})`
      : `observed ${signature.shape} but declared ${declared} (peak_ratio=${signature.peak_ratio.toFixed(2)}, diffs=${signature.diffs.map(d => d.toFixed(1)).join(", ")})`,
  };
}
