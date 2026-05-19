// hook_slide_strength — Sonnet judges whether the first slide has a
// scroll-stopping visual hook. Composition judgment.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You see the first slide of a social-media carousel. A mom is scrolling her feed; this is the still that has to stop her thumb.

Judge whether this slide has a strong scroll-stopping visual hook:
- Bold, immediately-readable headline (no squinting).
- Visual element that creates curiosity or surprise (not stock-y or generic).
- Composition draws the eye to the hook text (not lost in the background).

Return STRICT JSON. No prose, no fences:
{
  "scroll_stopping": true | false,
  "headline_legibility": "high | medium | low",
  "visual_interest": "high | medium | low",
  "notes": "one sentence"
}`;

export async function runHookSlideStrength(input: {
  hook_slide_path: string;
}): Promise<DimensionResult> {
  const { result, usage } = await claudeVisionJson<{
    scroll_stopping: boolean;
    headline_legibility: string;
    visual_interest: string;
    notes: string;
  }>([imageFromFile(input.hook_slide_path)], PROMPT, { model: "sonnet", maxTokens: 250 });
  const cost = priceClaudeVisionCall("sonnet", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-sonnet-4", cost_usd: cost }];

  if ("error" in result) {
    return { name: "hook_slide_strength", status: "FAIL", details: `vision error: ${result.error}`, call_costs: calls };
  }

  const pass = Boolean(result.scroll_stopping);
  return {
    name: "hook_slide_strength",
    status: pass ? "PASS" : "FAIL",
    details: `scroll_stopping=${result.scroll_stopping}; headline_legibility=${result.headline_legibility}; visual_interest=${result.visual_interest}. ${result.notes ?? ""}`,
    evidence: [input.hook_slide_path],
    call_costs: calls,
  };
}
