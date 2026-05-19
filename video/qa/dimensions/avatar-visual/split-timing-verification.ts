// split_timing_verification — Avatar+Visual format renders with a
// declared avatar-to-visual time ratio (typically 50/50). The dim verifies
// the actual durations match the declared ratio within tolerance.
//
// Currently UNMEASURED — avatar_config does not yet carry a
// split_ratio field, and the clip-segmentation metadata for which clips
// are "avatar" vs "visual" is not persisted. Graduates when both ship.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runSplitTimingVerification(): Promise<DimensionResult> {
  return {
    name: "split_timing_verification",
    status: "UNMEASURED",
    details: "Avatar+Visual split timing requires avatar_config.split_ratio + per-clip role tags (avatar | visual) in the QA input metadata. Neither is persisted by the current Avatar+Visual pipeline. Graduates from UNMEASURED via a single SQL UPDATE on render_profiles.qa_rules once the upstream metadata ships.",
  };
}
