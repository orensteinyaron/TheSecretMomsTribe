// b_roll_relevance — for each slide segment, vision-judge whether the
// representative image visually represents the spoken line during that
// segment. Score 1–5 per segment; fail if any segment scores < 3.
//
// Haiku per the cost-split decision: this is a structured "does this
// image semantically match this line" check, not deep composition
// judgment.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";
import type { SlideSegment } from "../../base/helpers/slide-segmentation.js";

const PROMPT = `You are checking whether a slideshow's b-roll image fits the spoken line shown over it.

You will see one image (the slide's background photo) and a spoken line (the voiceover during this slide's display window). Score how well the image visually represents the spoken line.

Scoring rubric:
- 5: image is a near-perfect literal or strongly evocative match.
- 4: image clearly relates to the spoken topic (same subject area, same emotional register).
- 3: image is loosely related — same broad theme but not specific to the line.
- 2: image is generic / stock-y and doesn't match the line.
- 1: image actively conflicts with or contradicts the line.

Return STRICT JSON. No prose, no fences:
{
  "score": 1-5,
  "match_type": "literal | evocative | thematic | generic | conflicting",
  "notes": "one sentence"
}`;

type SegmentResult = { segment_index: number; spoken_text: string; score: number; match_type: string; notes: string; cost: number; frame: string };

export async function runBRollRelevance(input: {
  segments: SlideSegment[];
}): Promise<DimensionResult> {
  if (input.segments.length === 0) {
    return {
      name: "b_roll_relevance",
      status: "UNMEASURED",
      details: "No slide segments detected — the slide-boundary detector returned zero segments. Either the asset has no slide content (just hook + CTA) or detection thresholds need calibration.",
    };
  }
  // Skip segments with no spoken words (e.g. between-slide silence).
  const measurable = input.segments.filter(s => s.word_count >= 2);
  if (measurable.length === 0) {
    return {
      name: "b_roll_relevance",
      status: "UNMEASURED",
      details: `${input.segments.length} segments detected but none have >= 2 spoken words; cannot judge relevance.`,
    };
  }

  const results = await Promise.all(measurable.map(async (seg): Promise<SegmentResult> => {
    const prompt = `${PROMPT}\n\nSPOKEN LINE: "${seg.spoken_text}"`;
    const { result, usage } = await claudeVisionJson<{ score: number; match_type: string; notes: string }>(
      [imageFromFile(seg.representative_frame)], prompt, { model: "haiku", maxTokens: 200 },
    );
    const cost = priceClaudeVisionCall("haiku", usage);
    if ("error" in result) {
      return { segment_index: seg.index, spoken_text: seg.spoken_text, score: 0, match_type: "ERROR", notes: result.error, cost, frame: seg.representative_frame };
    }
    return {
      segment_index: seg.index,
      spoken_text: seg.spoken_text,
      score: Number(result.score ?? 0),
      match_type: String(result.match_type ?? ""),
      notes: String(result.notes ?? ""),
      cost,
      frame: seg.representative_frame,
    };
  }));

  const failing = results.filter(r => r.score < 3);
  const calls: DimensionCall[] = results.map(r => ({
    service: "anthropic" as const,
    model: "claude-haiku-4-5",
    cost_usd: r.cost,
  }));
  const avg = results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length);

  return {
    name: "b_roll_relevance",
    status: failing.length === 0 ? "PASS" : "FAIL",
    score: avg,
    details: failing.length === 0
      ? `All ${results.length} segments score >= 3 on b-roll relevance (avg ${avg.toFixed(2)}/5). ${results.map(r => `seg ${r.segment_index}: ${r.score}/5 (${r.match_type})`).join("; ")}`
      : `${failing.length}/${results.length} segments score < 3. ${failing.map(r => `seg ${r.segment_index} (${r.score}/5, ${r.match_type}): line="${r.spoken_text.slice(0, 60)}..." — ${r.notes}`).join("; ")}`,
    evidence: results.map(r => r.frame),
    call_costs: calls,
  };
}
