// hand_naturalism — Haiku per-frame structured check. The prompt enumerates
// each visible hand and counts fingers; hallucinated hands fail by
// structure rather than vibes. Sample 3 frames per clip in the
// "high-gesture window" (here approximated as the clip's middle third).

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";
import type { ClipFrames } from "./identity-consistency.js";

const PROMPT = `You are inspecting a video frame for anatomical hand artifacts. Frame is a 9:16 vertical from an AI-generated avatar video.

Enumerate every visible hand in the frame. For each hand:
- How many fingers do you count (including thumb)?
- Are any fingers fused, missing, or duplicated?
- Are any chains, rings, or watch straps on the hand clean (start and end where they should, not melting through the hand)?

Score each hand: NATURAL (anatomically correct, exactly 5 fingers, accessories clean) | SUSPECT (one ambiguous feature) | ARTIFACT (5+ fingers, melted, missing, or chain disappears).

Return STRICT JSON:
{
  "hands_visible": 0 | 1 | 2,
  "hand_1": "NATURAL | SUSPECT | ARTIFACT | NOT_VISIBLE",
  "hand_2": "NATURAL | SUSPECT | ARTIFACT | NOT_VISIBLE",
  "notes": "one sentence"
}

If no hands are visible (off-frame entirely), set hands_visible=0 and both hand_* to NOT_VISIBLE.`;

type FrameResult = {
  clip_id: string;
  frame_path: string;
  hands_visible: number;
  verdicts: string[];
  notes: string;
  cost: number;
};

export async function runHandNaturalism(input: {
  clip_frames: ClipFrames[];
}): Promise<DimensionResult> {
  if (input.clip_frames.length === 0) {
    return { name: "hand_naturalism", status: "UNMEASURED", details: "No clips provided." };
  }
  // Use middle frame per clip — that's the high-gesture window per the B5
  // reframe ("sample middle frame, not random — hands move").
  const results = await Promise.all(input.clip_frames.map(async (cf): Promise<FrameResult> => {
    const fp = cf.frame_paths[1]; // middle
    const { result, usage } = await claudeVisionJson<{
      hands_visible: number;
      hand_1: string;
      hand_2: string;
      notes: string;
    }>([imageFromFile(fp)], PROMPT, { model: "haiku", maxTokens: 300 });
    const cost = priceClaudeVisionCall("haiku", usage);
    if ("error" in result) {
      return { clip_id: cf.clip_id, frame_path: fp, hands_visible: 0, verdicts: ["ERROR"], notes: result.error, cost };
    }
    const verdicts = [result.hand_1, result.hand_2].filter(v => v !== "NOT_VISIBLE");
    return { clip_id: cf.clip_id, frame_path: fp, hands_visible: Number(result.hands_visible ?? 0), verdicts, notes: result.notes ?? "", cost };
  }));

  // Any hand verdict of ARTIFACT in ANY clip fails the dimension.
  const fails = results.filter(r => r.verdicts.some(v => v === "ARTIFACT"));
  const calls: DimensionCall[] = results.map(r => ({
    service: "anthropic" as const,
    model: "claude-haiku-4-5",
    cost_usd: r.cost,
  }));

  return {
    name: "hand_naturalism",
    status: fails.length === 0 ? "PASS" : "FAIL",
    details: fails.length === 0
      ? `${results.length}/${results.length} clip mid-frames show NATURAL or SUSPECT hands. No ARTIFACTs detected. ${results.map(r => `${r.clip_id}: ${r.verdicts.join("/") || "no hands visible"}`).join("; ")}`
      : `${fails.length}/${results.length} clip(s) show anatomical artifacts. ${fails.map(r => `${r.clip_id}: ${r.verdicts.join("/")} — ${r.notes}`).join("; ")}`,
    evidence: results.map(r => r.frame_path),
    call_costs: calls,
  };
}
