// cta_slide_presence — Haiku judges whether the last slide of the carousel
// has a clear call-to-action (save / share / tag / follow / etc.).

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You see the FINAL slide of a social-media carousel.

A carousel should end with a clear call to action: "save this", "share with a friend", "tag a mom", "follow for more", or similar. Generic sign-off ("the end", "that's it!") does not count as a CTA.

Return STRICT JSON. No prose, no fences:
{
  "cta_present": true | false,
  "cta_type": "save | share | tag | follow | comment | other | none",
  "notes": "one sentence"
}`;

export async function runCtaSlidePresence(input: {
  cta_slide_path: string;
}): Promise<DimensionResult> {
  const { result, usage } = await claudeVisionJson<{
    cta_present: boolean;
    cta_type: string;
    notes: string;
  }>([imageFromFile(input.cta_slide_path)], PROMPT, { model: "haiku", maxTokens: 200 });
  const cost = priceClaudeVisionCall("haiku", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-haiku-4-5", cost_usd: cost }];

  if ("error" in result) {
    return { name: "cta_slide_presence", status: "FAIL", details: `vision error: ${result.error}`, call_costs: calls };
  }

  const pass = Boolean(result.cta_present);
  return {
    name: "cta_slide_presence",
    status: pass ? "PASS" : "FAIL",
    details: pass
      ? `CTA present (${result.cta_type}). ${result.notes ?? ""}`
      : `No clear CTA detected on final slide. ${result.notes ?? ""}`,
    evidence: [input.cta_slide_path],
    call_costs: calls,
  };
}
