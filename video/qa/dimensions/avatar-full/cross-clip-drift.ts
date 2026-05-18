// cross_clip_drift — Sonnet composition judgment across the entire clip set.
// Sample one representative frame per clip + reference; ask Sonnet to
// identify drift in identity / hair / background / framing across the
// set (not against reference per dimension, but ACROSS clips). One call.
//
// Lifted from existing qa-agent-avatar.ts CROSS_CLIP_PROMPT pattern.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
  type ImagePart,
} from "../../../lib/qa-helpers.js";
import type { ClipFrames } from "./identity-consistency.js";

type DriftDimension = { severity: "none" | "minor" | "major" | "hard_fail"; which_clips: string[]; notes: string };

type DriftResult = {
  identity_drift: DriftDimension;
  hair_drift: DriftDimension;
  background_drift: DriftDimension;
  framing_drift: DriftDimension;
  overall_verdict: "PASS" | "CONDITIONAL" | "FAIL";
  verdict_reasoning: string;
};

export async function runCrossClipDrift(input: {
  reference_image_path: string;
  clip_frames: ClipFrames[];
}): Promise<DimensionResult> {
  if (input.clip_frames.length < 2) {
    return {
      name: "cross_clip_drift",
      status: "UNMEASURED",
      details: `Need at least 2 clips for cross-clip drift analysis; got ${input.clip_frames.length}.`,
    };
  }

  const labelList = input.clip_frames.map((cf, idx) => `  IMAGE ${idx + 2}: ${cf.clip_id}`).join("\n");
  const prompt = `You will see N+1 images:
- IMAGE 1: REFERENCE canonical character.
- IMAGES 2..N+1: One representative frame from each video clip, in this order:
${labelList}

Identify drift ACROSS the clips, not against reference. Where is the character inconsistent across the set?

Return STRICT JSON:
{
  "identity_drift":     { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "hair_drift":         { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "background_drift":   { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "framing_drift":      { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "overall_verdict":    "PASS | CONDITIONAL | FAIL",
  "verdict_reasoning":  "2-3 sentences"
}`;

  const refImg: ImagePart = imageFromFile(input.reference_image_path);
  const clipImages: ImagePart[] = input.clip_frames.map(cf => imageFromFile(cf.frame_paths[1])); // middle frame

  const { result, usage } = await claudeVisionJson<DriftResult>(
    [refImg, ...clipImages], prompt, { model: "sonnet", maxTokens: 1200 },
  );
  const cost = priceClaudeVisionCall("sonnet", usage);
  const calls: DimensionCall[] = [{ service: "anthropic", model: "claude-sonnet-4", cost_usd: cost }];

  if ("error" in result) {
    return {
      name: "cross_clip_drift",
      status: "FAIL",
      details: `Cross-clip drift vision call failed: ${result.error}`,
      call_costs: calls,
    };
  }

  const status: "PASS" | "FAIL" =
    result.overall_verdict === "PASS"
      ? "PASS"
      : result.overall_verdict === "CONDITIONAL"
        ? "PASS" // conditional doesn't fail at structural level — surfaced in details
        : "FAIL";

  const dims = ["identity_drift", "hair_drift", "background_drift", "framing_drift"] as const;
  const summary = dims.map(d => {
    const v = result[d];
    const which = v.which_clips?.length > 0 ? ` (clips: ${v.which_clips.join(", ")})` : "";
    return `${d}=${v.severity}${which}`;
  }).join("; ");

  return {
    name: "cross_clip_drift",
    status,
    details: `verdict=${result.overall_verdict}. ${summary}. Reasoning: ${result.verdict_reasoning ?? ""}`,
    call_costs: calls,
  };
}
