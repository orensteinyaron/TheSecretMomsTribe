/**
 * Background-consistency QA — guards against clips in an Avatar Full v5 render
 * NOT sharing the same background (decor present in some clips, cropped from
 * others).
 *
 * Root cause this guards against (2026-06-10, YAR-153): `normalize-clips`
 * originally scaled each clip by a DIFFERENT factor to equalize face size.
 * Because Seedance renders Rachel at different distances (YAR-137), that meant
 * a different zoom per clip — so background decor (e.g. the right-wall frames)
 * survived in the low-zoom clips and was cropped out of the high-zoom ones,
 * splitting the render into two visibly different backgrounds.
 *
 * Why this is a SCALE check, not a pixel check: every clip is rendered from the
 * same Soul start image, so background content is identical at generation time.
 * The ONLY way clips end up with different backgrounds is unequal post-process
 * zoom. Background consistency is therefore fully determined by the normalize
 * scale being uniform across clips — a deterministic invariant. A pixel/
 * histogram comparison of the output was measured to be unreliable here because
 * face SIZE now varies by design (option-1 fix), and the subject-size variance
 * dominates any region histogram (fixed render 0.35 vs buggy 0.39 — no
 * separation). The scale invariant has no such noise.
 *
 * Pure + transport-free so it is unit-testable.
 */

export interface BackgroundScaleReport {
  tolerance: number;
  min_scale: number;
  max_scale: number;
  ratio: number; // max/min; 1.0 = perfectly uniform
  verdict: "PASS" | "FAIL";
}

/**
 * Max allowed max/min scale ratio. 1.02 = scales must match within 2 %
 * (rounding / buffer slack). The bug had ratio ~1.49 (1.08→1.61); the uniform
 * fix has ratio 1.0.
 */
export const BACKGROUND_SCALE_RATIO_TOLERANCE = 1.02;

/**
 * Assert the per-clip normalize scales are uniform (within tolerance). FAIL ⇒
 * clips were zoomed differently ⇒ backgrounds will diverge (decor cropped from
 * some clips, kept in others).
 */
export function checkBackgroundScaleUniform(
  scales: number[],
  tolerance: number = BACKGROUND_SCALE_RATIO_TOLERANCE,
): BackgroundScaleReport {
  if (scales.length === 0) {
    return { tolerance, min_scale: 0, max_scale: 0, ratio: 1, verdict: "PASS" };
  }
  const min_scale = Math.min(...scales);
  const max_scale = Math.max(...scales);
  const ratio = min_scale > 0 ? max_scale / min_scale : Infinity;
  return {
    tolerance,
    min_scale,
    max_scale,
    ratio,
    verdict: ratio <= tolerance ? "PASS" : "FAIL",
  };
}
