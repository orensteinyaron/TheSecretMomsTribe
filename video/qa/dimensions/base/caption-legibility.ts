// caption_legibility — sample frames where captions are expected to render
// (per profile's output_spec.caption_region) and ask Haiku vision: "is
// readable text present in this region, and is it not obscuring the subject?"
//
// Profile-config-driven: the caption_region rectangle comes from the
// render_profile output_spec, not hardcoded. Avatar Full uses bottom band;
// Moving Images uses the middle/karaoke band. Static-image and carousel
// don't have a caption region — they short-circuit to UNMEASURED.

import path from "path";
import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import type { RenderProfileConfig } from "../../base/qa-contract.js";
import {
  imageFromFile,
  claudeVisionJson,
  priceClaudeVisionCall,
} from "../../../lib/qa-helpers.js";
import { extractFrameTo, probeDurationSeconds, evenlySpacedTimestamps } from "../../base/helpers/frame-sampling.js";

const CAPTION_PROMPT = `You are checking a single frame of a 9:16 vertical video for caption legibility.

The video is from a parenting brand. Captions are short on-screen text (1–4 words at a time, sometimes word-by-word karaoke) rendered in the region described below.

Region of interest (as percentages of the frame's height, top-down): top {top_pct}%, bottom {bottom_pct}%.

Check three things and respond in strict JSON. No prose, no markdown fences.

{
  "text_present_in_region": true | false,
  "text_readable": true | false,
  "text_obscures_face": true | false,
  "notes": "one sentence"
}

text_present_in_region: any caption-like overlay text visible inside the named horizontal band.
text_readable: if text is present, is it legible (contrast sufficient, not blurred, font large enough on a phone screen)?
text_obscures_face: if a person's face is visible in this frame, does the text overlap the face (eyes, mouth, nose)?

If no text is present, set text_readable and text_obscures_face to false and explain in notes.`;

const PASS_RATIO = 0.8; // 80%+ sampled frames must have readable, non-obscuring captions

type FrameVerdict = {
  frame: string;
  text_present_in_region: boolean;
  text_readable: boolean;
  text_obscures_face: boolean;
  notes: string;
  call_cost: number;
  retried: boolean;
};

export async function runCaptionLegibility(input: {
  asset_path: string;
  profile_config: RenderProfileConfig;
  workdir: string;
}): Promise<DimensionResult> {
  const region = input.profile_config.output_spec.caption_region;
  if (!region) {
    return {
      name: "caption_legibility",
      status: "UNMEASURED",
      details: `Profile ${input.profile_config.slug} has no caption_region declared in output_spec — dimension not applicable.`,
    };
  }

  const dur = probeDurationSeconds(input.asset_path);
  // Skip the first 2s (hook overlay window) and last 1s (CTA) to avoid
  // false-fail on the hook/CTA card frames.
  const sampleStart = Math.min(2.0, Math.max(0, dur - 5));
  const sampleEnd = Math.max(sampleStart + 0.5, dur - 1.0);
  const stamps = evenlySpacedTimestamps(sampleEnd - sampleStart, 5).map(t => t + sampleStart);
  const frames = stamps.map((t, i) => extractFrameTo(input.asset_path, t, input.workdir, `cap-${i}`));

  const prompt = CAPTION_PROMPT
    .replace("{top_pct}", String(region.top_pct))
    .replace("{bottom_pct}", String(region.bottom_pct));

  const results = await Promise.all(frames.map(async (f): Promise<FrameVerdict> => {
    const { result, usage } = await claudeVisionJson<{
      text_present_in_region: boolean;
      text_readable: boolean;
      text_obscures_face: boolean;
      notes: string;
    }>([imageFromFile(f)], prompt, { model: "haiku", maxTokens: 300 });
    if ("error" in result) {
      return {
        frame: f,
        text_present_in_region: false,
        text_readable: false,
        text_obscures_face: false,
        notes: `vision error: ${result.error}`,
        call_cost: priceClaudeVisionCall("haiku", usage),
        retried: usage.retried,
      };
    }
    return {
      frame: f,
      text_present_in_region: result.text_present_in_region,
      text_readable: result.text_readable,
      text_obscures_face: result.text_obscures_face,
      notes: result.notes ?? "",
      call_cost: priceClaudeVisionCall("haiku", usage),
      retried: usage.retried,
    };
  }));

  // Pass = text present in region AND readable AND not obscuring face.
  const passing = results.filter(r => r.text_present_in_region && r.text_readable && !r.text_obscures_face);
  const ratio = passing.length / Math.max(1, results.length);

  const calls: DimensionCall[] = results.map(r => ({
    service: "anthropic" as const,
    model: "claude-haiku-4-5",
    cost_usd: r.call_cost,
  }));

  return {
    name: "caption_legibility",
    status: ratio >= PASS_RATIO ? "PASS" : "FAIL",
    score: Math.round(ratio * 100),
    details: ratio >= PASS_RATIO
      ? `${passing.length}/${results.length} sampled frames have readable captions in the declared region (>= ${PASS_RATIO * 100}% threshold).`
      : `Only ${passing.length}/${results.length} sampled frames pass (need >= ${PASS_RATIO * 100}%). Details: ${results.map(r => `frame ${path.basename(r.frame)}: present=${r.text_present_in_region}, readable=${r.text_readable}, obscures_face=${r.text_obscures_face} (${r.notes})`).join("; ")}`,
    evidence: results.map(r => r.frame),
    call_costs: calls,
  };
}
