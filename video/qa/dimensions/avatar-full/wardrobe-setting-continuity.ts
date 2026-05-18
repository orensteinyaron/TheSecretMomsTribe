// wardrobe_setting_continuity — Sonnet vision check. Compare each clip's
// first frame to clip 1's first frame on three dimensions: same wardrobe,
// same setting (background/room/lighting), same overall framing. Any mismatch
// is a continuity break.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
  type ImagePart,
} from "../../../lib/qa-helpers.js";
import type { ClipFrames } from "./identity-consistency.js";

const PROMPT = `You are comparing two frames from the same supposed continuous video shoot.

IMAGE 1: first frame of clip 1 (the reference clip in this video).
IMAGE 2: first frame of a later clip in the same video.

The character should be wearing the same outfit, in the same setting, under the same lighting,
at a roughly similar shot framing across these clips.

Return STRICT JSON:
{
  "same_wardrobe": true | false,
  "same_setting": true | false,
  "same_lighting": true | false,
  "same_framing_roughly": true | false,
  "notes": "specific observation if any mismatch"
}

same_wardrobe: same top / outerwear / jewelry. (Slight pose/wrinkle differences are still "same.")
same_setting: same background, same room/location, same furniture/objects roughly in same positions.
same_lighting: similar warmth and intensity; minor variation OK, full studio-to-natural shift not OK.
same_framing_roughly: medium / medium-close / close-up bucket matches (e.g. both medium-close).`;

type CompareResult = {
  clip_id: string;
  same_wardrobe: boolean;
  same_setting: boolean;
  same_lighting: boolean;
  same_framing_roughly: boolean;
  notes: string;
  cost: number;
};

export async function runWardrobeSettingContinuity(input: {
  clip_frames: ClipFrames[];
}): Promise<DimensionResult> {
  if (input.clip_frames.length < 2) {
    return {
      name: "wardrobe_setting_continuity",
      status: "UNMEASURED",
      details: `Need at least 2 clips for continuity check; got ${input.clip_frames.length}.`,
    };
  }
  const refImg: ImagePart = imageFromFile(input.clip_frames[0].frame_paths[0]); // clip 1, first frame
  const others = input.clip_frames.slice(1);

  const results = await Promise.all(others.map(async (cf): Promise<CompareResult> => {
    const { result, usage } = await claudeVisionJson<Omit<CompareResult, "clip_id" | "cost">>(
      [refImg, imageFromFile(cf.frame_paths[0])], PROMPT, { model: "sonnet", maxTokens: 400 },
    );
    const cost = priceClaudeVisionCall("sonnet", usage);
    if ("error" in result) {
      return { clip_id: cf.clip_id, same_wardrobe: false, same_setting: false, same_lighting: false, same_framing_roughly: false, notes: `error: ${result.error}`, cost };
    }
    return { clip_id: cf.clip_id, ...result, cost };
  }));

  const breaks = results.filter(r => !(r.same_wardrobe && r.same_setting && r.same_lighting));
  const calls: DimensionCall[] = results.map(r => ({
    service: "anthropic" as const,
    model: "claude-sonnet-4",
    cost_usd: r.cost,
  }));

  return {
    name: "wardrobe_setting_continuity",
    status: breaks.length === 0 ? "PASS" : "FAIL",
    details: breaks.length === 0
      ? `All ${results.length} non-first clips match clip 1 on wardrobe + setting + lighting.`
      : `${breaks.length}/${results.length} continuity break(s). ${breaks.map(r => `${r.clip_id}: wardrobe=${r.same_wardrobe} setting=${r.same_setting} lighting=${r.same_lighting} — ${r.notes}`).join("; ")}`,
    call_costs: calls,
  };
}
