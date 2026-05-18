// identity_markers — Haiku per-frame structured audit. Enumerate distinctive
// markers (scars, moles, freckles, asymmetries) on the reference, enumerate
// the same on each generated frame, compare the two sets for missing /
// hallucinated / drifted markers.
//
// Lifted from the existing qa-agent-avatar.ts IDENTITY_MARKERS_PROMPT —
// that prompt is calibrated and survives reuse. Demoted from Sonnet to
// Haiku per the cost split decision (structured-checklist prompts → Haiku).
//
// Aggregate score per clip is min across 3 frames (a single hallucinated
// feature kills the clip). Failing threshold: any clip aggregate < 3.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
  type ImagePart,
} from "../../../lib/qa-helpers.js";
import type { ClipFrames } from "./identity-consistency.js";

const PROMPT = `You are auditing identity preservation in an AI-generated video frame against the canonical character reference.

You will receive TWO images:
- IMAGE 1: the canonical reference still (ground truth for the character's identity).
- IMAGE 2: a frame extracted from a generated video clip.

STEP 1 — INSPECT THE REFERENCE.
Examine IMAGE 1. Enumerate every distinctive, persistent identity marker on the visible face and skin:
- Scars, cuts, stitches, or healed wounds.
- Moles, freckles, beauty marks.
- Birthmarks or pigmentation patches.
- Notable asymmetries (eye, brow, lip, nostril).
- Distinctive permanent features (chipped tooth, gap, dimple).
For each marker, record: region (anatomical area), approximate size, shape, orientation.
If a region has no markers, state "no markers in [region]."

STEP 2 — INSPECT THE GENERATED FRAME independently. Enumerate markers in IMAGE 2 the same way. Do not assume markers exist because they appeared in the reference; do not assume markers are absent because the reference lacked them. Examine IMAGE 2 on its own terms first.

STEP 3 — COMPARE per region (forehead, brow, cheeks, nose, lips, chin, neck):
- Markers in IMAGE 1 also present in IMAGE 2 (matching location/size/shape)?
- Regions empty in IMAGE 1 also empty in IMAGE 2?
- Any markers present in IMAGE 2 that are ABSENT from IMAGE 1 (hallucinations)?

Disagreement types: (a) missing — in reference, not in frame. (b) hallucinated — in frame, not in reference. (c) drifted — in both but different.

Return STRICT JSON:
{
  "reference_markers": [{"region": "...", "description": "..."}],
  "frame_markers":     [{"region": "...", "description": "..."}],
  "disagreements":     [{"type": "missing|hallucinated|drifted", "region": "...", "detail": "..."}],
  "score": 0-5,
  "reasoning": "one sentence"
}

Scoring rubric:
- 5 = perfect agreement.
- 4 = one minor drift.
- 3 = one missing OR one minor hallucination.
- 2 = multiple disagreements, core identity intact.
- 1 = major hallucination (prominent feature added) OR major loss.
- 0 = identity unrecognizable.

A hallucinated feature is treated as severely as a missing one.`;

type FrameAudit = {
  clip_id: string;
  frame_index: number;
  score: number;
  reasoning: string;
  disagreements: { type: string; region: string; detail: string }[];
  cost: number;
  retried: boolean;
};

export async function runIdentityMarkers(input: {
  reference_image_path: string;
  clip_frames: ClipFrames[];
}): Promise<DimensionResult> {
  if (input.clip_frames.length === 0) {
    return { name: "identity_markers", status: "UNMEASURED", details: "No clips provided." };
  }

  const refImg: ImagePart = imageFromFile(input.reference_image_path);

  // 3 frames per clip × N clips = up to 18 Haiku calls. Run in parallel.
  const auditPromises: Promise<FrameAudit>[] = [];
  for (const cf of input.clip_frames) {
    for (let i = 0; i < cf.frame_paths.length; i++) {
      const fp = cf.frame_paths[i];
      auditPromises.push((async () => {
        const { result, usage } = await claudeVisionJson<{
          score: number;
          reasoning: string;
          disagreements: { type: string; region: string; detail: string }[];
        }>([refImg, imageFromFile(fp)], PROMPT, { model: "haiku", maxTokens: 1200 });
        if ("error" in result) {
          return {
            clip_id: cf.clip_id,
            frame_index: i,
            score: 0,
            reasoning: `error: ${result.error}`,
            disagreements: [],
            cost: priceClaudeVisionCall("haiku", usage),
            retried: usage.retried,
          };
        }
        return {
          clip_id: cf.clip_id,
          frame_index: i,
          score: Number(result.score ?? 0),
          reasoning: String(result.reasoning ?? ""),
          disagreements: Array.isArray(result.disagreements) ? result.disagreements : [],
          cost: priceClaudeVisionCall("haiku", usage),
          retried: usage.retried,
        };
      })());
    }
  }
  const audits = await Promise.all(auditPromises);

  // Aggregate per clip: min score across 3 frames; surfaced as the clip's
  // marker score. Symmetric audit: a hallucinated feature in any one frame
  // is enough to fail the clip.
  const byClip = new Map<string, FrameAudit[]>();
  for (const a of audits) {
    const arr = byClip.get(a.clip_id) ?? [];
    arr.push(a);
    byClip.set(a.clip_id, arr);
  }
  const clipScores = Array.from(byClip.entries()).map(([id, frames]) => {
    const minScore = Math.min(...frames.map(f => f.score));
    return { clip_id: id, min_score: minScore, frames };
  });

  const failingClips = clipScores.filter(c => c.min_score < 3);
  const calls: DimensionCall[] = audits.map(a => ({
    service: "anthropic" as const,
    model: "claude-haiku-4-5",
    cost_usd: a.cost,
  }));

  const avgMin = clipScores.reduce((s, c) => s + c.min_score, 0) / Math.max(1, clipScores.length);
  return {
    name: "identity_markers",
    status: failingClips.length === 0 ? "PASS" : "FAIL",
    score: avgMin,
    details: failingClips.length === 0
      ? `All ${clipScores.length} clips score >= 3 on min-frame identity markers (avg min ${avgMin.toFixed(2)}/5). ${clipScores.map(c => `${c.clip_id}: ${c.min_score}/5`).join("; ")}`
      : `${failingClips.length}/${clipScores.length} clip(s) below 3 marker threshold. ${clipScores.map(c => `${c.clip_id}: ${c.min_score}/5${c.min_score < 3 ? " (FAIL — " + c.frames.filter(f => f.score < 3).flatMap(f => f.disagreements).map(d => `[${d.type}] ${d.region}: ${d.detail}`).join("; ") + ")" : ""}`).join("; ")}`,
    call_costs: calls,
  };
}
