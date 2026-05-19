// Avatar+Visual variant agent. Inherits the Avatar Full baseline + adds
// split_timing_verification and visual_segment_relevance per the
// qa_rules.variants.avatar_visual.add_to_in_scope[] declaration on the
// avatar-v1 row (migration 20260519120000).
//
// Strategy: synthesize an "effective" in_scope_dimensions set by merging
// baseline + variant additions, then delegate to runAvatarFullQA with a
// patched profile_config view. The avatar-full agent doesn't need to know
// about the variant; it just runs whatever's in_scope.

import type { QAInput, RenderProfileConfig } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport } from "../schemas/qa-report.js";
import type { DimensionResult } from "../schemas/qa-dimension.js";
import { runAvatarFullQA } from "./avatar-full.js";
import { runSplitTimingVerification } from "../dimensions/avatar-visual/split-timing-verification.js";
import { runVisualSegmentRelevance } from "../dimensions/avatar-visual/visual-segment-relevance.js";

function applyVariantOverrides(cfg: RenderProfileConfig, variantKey: string): RenderProfileConfig {
  const variant = cfg.qa_rules.variants?.[variantKey];
  if (!variant) return cfg;
  const additions = variant.add_to_in_scope ?? [];
  // Move dims from out_of_scope into in_scope. Keep gated/unmeasured untouched.
  const newInScope = Array.from(new Set([...cfg.qa_rules.in_scope_dimensions, ...additions]));
  const newOutOfScope = cfg.qa_rules.out_of_scope_dimensions.filter(d => !additions.includes(d));
  return {
    ...cfg,
    qa_rules: {
      ...cfg.qa_rules,
      in_scope_dimensions: newInScope,
      out_of_scope_dimensions: newOutOfScope,
    },
  };
}

export async function runAvatarVisualQA(input: QAInput): Promise<QAReport> {
  // Run the avatar-full baseline with variant overrides applied. Then
  // layer the variant-specific dims on top.
  const patchedConfig = applyVariantOverrides(input.profile_config, "avatar_visual");
  const baseline = await runAvatarFullQA({ ...input, profile_config: patchedConfig, variant: "avatar_visual" });

  // The avatar-full agent doesn't know about split_timing_verification or
  // visual_segment_relevance — those live here. Run them and merge.
  const variantDims: DimensionResult[] = [];
  if (patchedConfig.qa_rules.in_scope_dimensions.includes("split_timing_verification")) {
    variantDims.push(await runSplitTimingVerification());
  }
  if (patchedConfig.qa_rules.in_scope_dimensions.includes("visual_segment_relevance")) {
    variantDims.push(await runVisualSegmentRelevance());
  }

  // Rebuild the report with variant dims appended + verdict recomputed.
  const dimensions = [...baseline.dimensions, ...variantDims];
  const { deriveVerdict } = await import("../schemas/qa-report.js");
  return {
    ...baseline,
    agent_version: AGENT_VERSION.avatar_visual,
    dimensions,
    overall_verdict: deriveVerdict(dimensions),
    unmeasured_dimensions: dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name),
  };
}
