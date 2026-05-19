// lip_sync — UNMEASURED stub. The vision-based OPEN/PARTIAL/CLOSED
// heuristic returned 95.2% PASS on broken v1 audio (calibrated as too
// permissive). Real implementation is the spike at YAR-130: MFCC + mouth
// ROI cross-correlation. Until that lands, this dimension returns
// UNMEASURED with a clear pointer.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runLipSync(): Promise<DimensionResult> {
  return {
    name: "lip_sync",
    status: "UNMEASURED",
    details: "Lip-sync analysis requires signal-processing (MFCC + mouth ROI cross-correlation). Vision-based heuristics returned 95.2% PASS on broken v1 audio and are not usable. Implementation tracked under YAR-130. When the spike lands, this dimension flips from UNMEASURED → in_scope via a single SQL UPDATE on render_profiles.qa_rules.",
  };
}
