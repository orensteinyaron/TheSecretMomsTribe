// identity_consistency — Sonnet vision call per clip. Compare ref + 3 frames
// of the clip on identity dimensions only (face shape, eyes, nose, mouth).
// Hair / framing / background / lighting drift are covered by
// wardrobe_setting_continuity + cross_clip_drift, not here.
//
// PASS threshold: every clip averages >= 4.0 on identity score (0-5).

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
  type ImagePart,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You are a strict QA reviewer for AI-generated avatar video content.

You will see 4 images:
- IMAGE 1: REFERENCE — the approved canonical face/identity for this character.
- IMAGES 2-4: Three frames sampled from a single video clip (start, middle, end).

Score IDENTITY ONLY on 0-5 (5 = perfect match to reference, 0 = totally different person).
Focus on: face shape (jaw, cheekbones), eye shape and color, nose shape, mouth shape and size,
ear shape. Skin tone too if it diverges noticeably. Do NOT score hair, framing, background,
or lighting — those are covered elsewhere. Be ruthless. If unsure, score lower.

Return STRICT JSON only:

{
  "score": 0-5,
  "notes": "specific observations about face shape, eyes, nose, mouth across the 3 frames",
  "hard_fail": true | false
}

hard_fail = true if you would call this "not the same person" by any reasonable judgment.`;

export type ClipFrames = {
  clip_id: string;
  frame_paths: [string, string, string]; // start, middle, end
};

type ClipScore = { clip_id: string; score: number; notes: string; hard_fail: boolean; cost: number; retried: boolean };

export async function runIdentityConsistency(input: {
  reference_image_path: string;
  clip_frames: ClipFrames[];
}): Promise<DimensionResult> {
  if (input.clip_frames.length === 0) {
    return {
      name: "identity_consistency",
      status: "UNMEASURED",
      details: "No clips provided.",
    };
  }

  const refImg: ImagePart = imageFromFile(input.reference_image_path);
  const results = await Promise.all(input.clip_frames.map(async (cf): Promise<ClipScore> => {
    const images: ImagePart[] = [refImg, ...cf.frame_paths.map(imageFromFile)];
    const { result, usage } = await claudeVisionJson<{ score: number; notes: string; hard_fail: boolean }>(
      images, PROMPT, { model: "sonnet", maxTokens: 500 },
    );
    if ("error" in result) {
      return { clip_id: cf.clip_id, score: 0, notes: `error: ${result.error}`, hard_fail: true, cost: priceClaudeVisionCall("sonnet", usage), retried: usage.retried };
    }
    return {
      clip_id: cf.clip_id,
      score: Number(result.score ?? 0),
      notes: String(result.notes ?? ""),
      hard_fail: Boolean(result.hard_fail),
      cost: priceClaudeVisionCall("sonnet", usage),
      retried: usage.retried,
    };
  }));

  const failingClips = results.filter(r => r.hard_fail || r.score < 4.0);
  const calls: DimensionCall[] = results.map(r => ({
    service: "anthropic" as const,
    model: "claude-sonnet-4",
    cost_usd: r.cost,
  }));

  const avg = results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length);
  return {
    name: "identity_consistency",
    status: failingClips.length === 0 ? "PASS" : "FAIL",
    score: avg,
    details: failingClips.length === 0
      ? `All ${results.length} clips score >= 4.0 on identity (avg ${avg.toFixed(2)}/5). ${results.map(r => `${r.clip_id}: ${r.score}/5`).join("; ")}`
      : `${failingClips.length}/${results.length} clip(s) below 4.0 identity threshold or hard-fail. ${results.map(r => `${r.clip_id}: ${r.score}/5${r.hard_fail ? " (HARD FAIL)" : ""} — ${r.notes}`).join("; ")}`,
    call_costs: calls,
  };
}
