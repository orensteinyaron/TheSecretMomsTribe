// visual_segment_relevance — same pattern as b_roll_relevance from
// Moving Images, but applied only to the visual (B-roll) segments of an
// Avatar+Visual piece (the segments that aren't Rachel's avatar).
//
// Currently UNMEASURED — clip metadata doesn't carry which segments are
// "visual" vs "avatar". Once avatar_config.format='avatar_visual' carries
// per-clip role tags + spoken script per visual segment, the dim graduates
// to a Haiku check identical to b_roll_relevance.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runVisualSegmentRelevance(): Promise<DimensionResult> {
  return {
    name: "visual_segment_relevance",
    status: "UNMEASURED",
    details: "Avatar+Visual visual-segment relevance requires per-clip role tags (which clip is avatar vs visual) + spoken-script-per-segment in QA input metadata. Neither is persisted by the current Avatar+Visual pipeline. Graduates from UNMEASURED via a single SQL UPDATE on render_profiles.qa_rules once the upstream metadata ships. Implementation pattern: identical to b_roll_relevance (Haiku per segment).",
  };
}
