// Static Image profile agent.
//
// Asset is a single PNG (1080×1920). 3 dims, all measured:
//   - watermark_compliance (pixel inspection)
//   - text_on_image_legibility (Haiku at thumbnail scale)
//   - layout_grid_compliance (Haiku layout check)

import type { QAInput } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport, CostSummary } from "../schemas/qa-report.js";
import { emptyCostSummary, accumulateCost, deriveVerdict } from "../schemas/qa-report.js";
import type { DimensionResult } from "../schemas/qa-dimension.js";

import { runWatermarkCompliance } from "../dimensions/base/watermark-compliance.js";
import { runTextOnImageLegibility } from "../dimensions/static-image/text-on-image-legibility.js";
import { runLayoutGridCompliance } from "../dimensions/static-image/layout-grid-compliance.js";

export async function runStaticImageQA(input: QAInput): Promise<QAReport> {
  const ranAt = new Date().toISOString();
  const rules = input.profile_config.qa_rules;
  const inScope = new Set(rules.in_scope_dimensions);

  const dimensions: DimensionResult[] = [];

  // The watermark dim treats the static image as a "frame" — same pixel
  // region check applies. The dim already accepts asset_path + workdir.
  const results = await Promise.all([
    inScope.has("watermark_compliance")
      ? runWatermarkCompliance({ asset_path: input.asset_path, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("text_on_image_legibility")
      ? runTextOnImageLegibility({ asset_path: input.asset_path, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("layout_grid_compliance")
      ? runLayoutGridCompliance({ asset_path: input.asset_path })
      : Promise.resolve(null),
  ]);
  for (const r of results) if (r) dimensions.push(r);

  // Gated remap (none on static-image today; logic kept for parity).
  const gated = new Set(rules.gated_dimensions ?? []);
  for (const d of dimensions) {
    if (d.status === "FAIL" && gated.has(d.name)) {
      d.details = `[GATED] ${d.details}`;
      d.status = "UNMEASURED";
    }
  }

  const cost: CostSummary = emptyCostSummary();
  for (const d of dimensions) {
    if (d.call_costs && d.call_costs.length > 0) accumulateCost(cost, d.name, d.call_costs);
  }

  return {
    asset_id: input.asset_id,
    asset_path: input.asset_path,
    render_profile_slug: input.profile_config.slug,
    render_profile_variant: input.variant,
    agent_version: AGENT_VERSION.static_image,
    ran_at: ranAt,
    dimensions,
    overall_verdict: deriveVerdict(dimensions),
    human_review_required: input.profile_config.qa_stability.state !== "decisional",
    unmeasured_dimensions: dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name),
    cost_summary: cost,
  };
}
