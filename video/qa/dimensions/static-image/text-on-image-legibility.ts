// text_on_image_legibility — for a static image asset (PNG, 1080×1920),
// resize to thumbnail width (200px) and Haiku-judge whether the primary
// text is still readable at that scale. Captures the "scroll past at
// thumbnail size" failure mode that hurts feed engagement.

import path from "path";
import sharp from "sharp";
import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You see a static social-media image rendered at thumbnail width (200px wide). This is how the post would appear in a feed before a user taps.

Answer in strict JSON. No prose, no fences.

{
  "primary_text_readable": true | false,
  "primary_text_content": "what the primary headline text says (best read)",
  "notes": "one sentence on legibility — contrast, font size, layout"
}

primary_text_readable: at this scale, can the dominant headline text be read clearly (not just sensed as text)?
primary_text_content: your best transcription of the largest/most prominent text.`;

export async function runTextOnImageLegibility(input: {
  asset_path: string;
  workdir: string;
}): Promise<DimensionResult> {
  const thumb = path.join(input.workdir, "thumb-200w.png");
  await sharp(input.asset_path).resize({ width: 200 }).toFile(thumb);

  const { result, usage } = await claudeVisionJson<{
    primary_text_readable: boolean;
    primary_text_content: string;
    notes: string;
  }>([imageFromFile(thumb)], PROMPT, { model: "haiku", maxTokens: 250 });
  const cost = priceClaudeVisionCall("haiku", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-haiku-4-5", cost_usd: cost }];

  if ("error" in result) {
    return { name: "text_on_image_legibility", status: "FAIL", details: `vision error: ${result.error}`, call_costs: calls };
  }

  const pass = Boolean(result.primary_text_readable);
  return {
    name: "text_on_image_legibility",
    status: pass ? "PASS" : "FAIL",
    details: pass
      ? `Primary text readable at 200px thumbnail scale: "${result.primary_text_content}". ${result.notes ?? ""}`
      : `Primary text NOT readable at 200px thumbnail. Best-read attempt: "${result.primary_text_content}". ${result.notes ?? ""}`,
    evidence: [thumb],
    call_costs: calls,
  };
}
