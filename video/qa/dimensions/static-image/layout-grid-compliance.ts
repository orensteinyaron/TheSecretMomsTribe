// layout_grid_compliance — Haiku judges whether the static image follows
// SMT's visual layout conventions (consistent vertical anchoring, safe-area
// margins, text not clipping edges).
//
// Until a formal grid spec is committed to `visual_design_guide.md`, this
// dimension uses a soft Haiku check on standard mobile-feed layout norms:
//   - Text is not within 5% of any edge (mobile safe area)
//   - Primary element occupies the visual center mass
//   - Watermark / branding is in the bottom corner per FACE_OF_SMT V1
//
// Graduates to a deterministic pixel-position check when the formal grid
// spec ships (flip via single SQL UPDATE to add fixture / coords).

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You see an SMT brand static image (1080×1920 portrait, designed for IG / TT static slots).

Check the layout against mobile-feed safe-area norms:
1. Is any text within ~5% of any edge of the image? (Safe-area violation = clipping risk in feed crops.)
2. Does the primary visual element (headline + key visual) sit in the visually-centered mass of the frame, not lopsided?
3. Is the SMT watermark visible in a corner (typically bottom-right)?

Return STRICT JSON only. No prose, no fences:
{
  "text_inside_safe_area": true | false,
  "primary_element_centered": true | false,
  "watermark_visible": true | false,
  "notes": "one sentence"
}`;

export async function runLayoutGridCompliance(input: {
  asset_path: string;
}): Promise<DimensionResult> {
  const { result, usage } = await claudeVisionJson<{
    text_inside_safe_area: boolean;
    primary_element_centered: boolean;
    watermark_visible: boolean;
    notes: string;
  }>([imageFromFile(input.asset_path)], PROMPT, { model: "haiku", maxTokens: 250 });
  const cost = priceClaudeVisionCall("haiku", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-haiku-4-5", cost_usd: cost }];

  if ("error" in result) {
    return { name: "layout_grid_compliance", status: "FAIL", details: `vision error: ${result.error}`, call_costs: calls };
  }

  const passes = [
    { check: "text_inside_safe_area", v: result.text_inside_safe_area },
    { check: "primary_element_centered", v: result.primary_element_centered },
    { check: "watermark_visible", v: result.watermark_visible },
  ];
  const fails = passes.filter(p => !p.v);
  return {
    name: "layout_grid_compliance",
    status: fails.length === 0 ? "PASS" : "FAIL",
    details: fails.length === 0
      ? `All layout checks pass. ${result.notes ?? ""}`
      : `${fails.length} layout check(s) failed: ${fails.map(p => p.check).join(", ")}. ${result.notes ?? ""}`,
    call_costs: calls,
  };
}
