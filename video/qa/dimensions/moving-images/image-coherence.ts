// image_coherence — Sonnet gestalt check across all slide b-roll images.
// One vision call; the model judges whether the image set hangs together
// stylistically (consistent palette, lighting, treatment) or reads as a
// stock-photo grab bag.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
  type ImagePart,
} from "../../../lib/qa-helpers.js";
import type { SlideSegment } from "../../base/helpers/slide-segmentation.js";

const PROMPT = `You will see the b-roll background images from a single slideshow video, in order.

A well-produced slideshow has a coherent visual identity across slides — consistent palette (warm/cool/neutral), consistent lighting style, consistent subject treatment (lifestyle photos vs. flat-lay vs. abstract). A "stock-photo grab bag" has jarring shifts between styles that break the viewer's sense of one cohesive piece.

Return STRICT JSON only. No prose, no markdown fences:
{
  "palette_consistent": true | false,
  "lighting_consistent": true | false,
  "treatment_consistent": true | false,
  "overall_coherence": 1-5,
  "notes": "one sentence calling out the strongest break or the strongest unifier"
}

overall_coherence rubric:
- 5: visually unified, looks like one shoot or one curated set.
- 4: mostly unified, one minor outlier.
- 3: mixed but acceptable.
- 2: stylistic grab bag.
- 1: jarring, multiple mismatches.`;

const PASS_THRESHOLD = 3;

export async function runImageCoherence(input: {
  segments: SlideSegment[];
}): Promise<DimensionResult> {
  if (input.segments.length < 2) {
    return {
      name: "image_coherence",
      status: "UNMEASURED",
      details: `Need >= 2 slide segments for coherence check; got ${input.segments.length}.`,
    };
  }
  const images: ImagePart[] = input.segments.map(s => imageFromFile(s.representative_frame));
  const { result, usage } = await claudeVisionJson<{
    palette_consistent: boolean;
    lighting_consistent: boolean;
    treatment_consistent: boolean;
    overall_coherence: number;
    notes: string;
  }>(images, PROMPT, { model: "sonnet", maxTokens: 400 });
  const cost = priceClaudeVisionCall("sonnet", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-sonnet-4", cost_usd: cost }];

  if ("error" in result) {
    return {
      name: "image_coherence",
      status: "FAIL",
      details: `vision call failed: ${result.error}`,
      call_costs: calls,
    };
  }

  const score = Number(result.overall_coherence ?? 0);
  const pass = score >= PASS_THRESHOLD;
  return {
    name: "image_coherence",
    status: pass ? "PASS" : "FAIL",
    score,
    details: `coherence ${score}/5 (palette=${result.palette_consistent}, lighting=${result.lighting_consistent}, treatment=${result.treatment_consistent}). ${result.notes ?? ""}`,
    call_costs: calls,
  };
}
