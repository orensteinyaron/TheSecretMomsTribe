// Carousel profile agent.
//
// Asset is a sequence of PNG slides (passed via input.carousel_slide_paths).
// 5 dims:
//   - watermark_compliance: pixel check on the first slide (every slide
//     should carry it, but checking one is enough for a PASS/FAIL signal).
//   - slide_narrative_coherence: Sonnet per consecutive pair.
//   - hook_slide_strength: Sonnet on first slide.
//   - cta_slide_presence: Haiku on last slide.
//   - text_on_image_legibility: Haiku at 200px thumbnail, per slide.

import type { QAInput } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport, CostSummary } from "../schemas/qa-report.js";
import { emptyCostSummary, accumulateCost, deriveVerdict } from "../schemas/qa-report.js";
import type { DimensionResult, DimensionCall } from "../schemas/qa-dimension.js";

import { runWatermarkCompliance } from "../dimensions/base/watermark-compliance.js";
import { runSlideNarrativeCoherence } from "../dimensions/carousel/slide-narrative-coherence.js";
import { runHookSlideStrength } from "../dimensions/carousel/hook-slide-strength.js";
import { runCtaSlidePresence } from "../dimensions/carousel/cta-slide-presence.js";
import { runTextOnImageLegibility } from "../dimensions/static-image/text-on-image-legibility.js";

export async function runCarouselQA(input: QAInput): Promise<QAReport> {
  const ranAt = new Date().toISOString();
  const rules = input.profile_config.qa_rules;
  const inScope = new Set(rules.in_scope_dimensions);

  const slidePaths = input.carousel_slide_paths ?? [];
  const haveSlides = slidePaths.length > 0;

  const dimensions: DimensionResult[] = [];

  // watermark — run on the first slide (input.asset_path is the carousel's
  // primary asset path — convention: the first slide).
  if (inScope.has("watermark_compliance")) {
    dimensions.push(await runWatermarkCompliance({ asset_path: input.asset_path, workdir: input.workdir }));
  }

  if (!haveSlides) {
    // Carousel dims need the full slide set. If only the primary asset
    // path is provided, surface that gap.
    for (const dim of ["slide_narrative_coherence", "hook_slide_strength", "cta_slide_presence", "text_on_image_legibility"]) {
      if (inScope.has(dim)) {
        dimensions.push({
          name: dim,
          status: "UNMEASURED",
          details: `Carousel slide paths not provided in QA input metadata (carousel_slide_paths is empty). The dim requires the full slide set.`,
        });
      }
    }
  } else {
    const parallel = await Promise.all([
      inScope.has("slide_narrative_coherence")
        ? runSlideNarrativeCoherence({ slide_paths: slidePaths })
        : Promise.resolve(null),
      inScope.has("hook_slide_strength")
        ? runHookSlideStrength({ hook_slide_path: slidePaths[0] })
        : Promise.resolve(null),
      inScope.has("cta_slide_presence")
        ? runCtaSlidePresence({ cta_slide_path: slidePaths[slidePaths.length - 1] })
        : Promise.resolve(null),
    ]);
    for (const r of parallel) if (r) dimensions.push(r);

    // text_on_image_legibility: run on every slide; PASS if every slide
    // passes individually.
    if (inScope.has("text_on_image_legibility")) {
      const perSlide = await Promise.all(slidePaths.map(p =>
        runTextOnImageLegibility({ asset_path: p, workdir: input.workdir }),
      ));
      const fails = perSlide.filter(r => r.status === "FAIL");
      const calls: DimensionCall[] = perSlide.flatMap(r => r.call_costs ?? []);
      dimensions.push({
        name: "text_on_image_legibility",
        status: fails.length === 0 ? "PASS" : "FAIL",
        details: fails.length === 0
          ? `All ${perSlide.length} slides have readable primary text at 200px thumbnail.`
          : `${fails.length}/${perSlide.length} slide(s) fail thumbnail-scale legibility.`,
        call_costs: calls,
        evidence: perSlide.flatMap(r => r.evidence ?? []),
      });
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
    agent_version: AGENT_VERSION.carousel,
    ran_at: ranAt,
    dimensions,
    overall_verdict: deriveVerdict(dimensions),
    human_review_required: input.profile_config.qa_stability.state !== "decisional",
    unmeasured_dimensions: dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name),
    cost_summary: cost,
  };
}
