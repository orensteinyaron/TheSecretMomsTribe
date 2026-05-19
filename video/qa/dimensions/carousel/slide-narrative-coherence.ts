// slide_narrative_coherence — for each consecutive slide pair (slide N
// and N+1), Sonnet judges whether slide N+1 logically follows slide N in
// narrative flow. Composition judgment, so Sonnet, not Haiku.

import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import {
  claudeVisionJson,
  priceClaudeVisionCall,
  imageFromFile,
} from "../../../lib/qa-helpers.js";

const PROMPT = `You see two consecutive slides from a social-media carousel.

IMAGE 1: slide N (the slide a viewer just saw).
IMAGE 2: slide N+1 (the slide a viewer is about to see next).

A carousel works narratively when each slide builds on the previous — hook → setup → reveal → payoff → CTA, or some similar progression. Disjointed: slide N+1 introduces a totally new topic or breaks the visual rhythm.

Return STRICT JSON. No prose, no fences:
{
  "logically_follows": true | false,
  "transition_type": "build | reveal | reframe | recap | disjoint",
  "notes": "one sentence"
}`;

type PairResult = { pair_index: number; logically_follows: boolean; transition_type: string; notes: string; cost: number };

export async function runSlideNarrativeCoherence(input: {
  slide_paths: string[];
}): Promise<DimensionResult> {
  if (input.slide_paths.length < 2) {
    return {
      name: "slide_narrative_coherence",
      status: "UNMEASURED",
      details: `Need >= 2 slides; got ${input.slide_paths.length}.`,
    };
  }

  const pairs: { idx: number; a: string; b: string }[] = [];
  for (let i = 0; i + 1 < input.slide_paths.length; i++) {
    pairs.push({ idx: i, a: input.slide_paths[i], b: input.slide_paths[i + 1] });
  }

  const results = await Promise.all(pairs.map(async (p): Promise<PairResult> => {
    const { result, usage } = await claudeVisionJson<{ logically_follows: boolean; transition_type: string; notes: string }>(
      [imageFromFile(p.a), imageFromFile(p.b)], PROMPT, { model: "sonnet", maxTokens: 250 },
    );
    const cost = priceClaudeVisionCall("sonnet", usage);
    if ("error" in result) return { pair_index: p.idx, logically_follows: false, transition_type: "ERROR", notes: result.error, cost };
    return {
      pair_index: p.idx,
      logically_follows: Boolean(result.logically_follows),
      transition_type: String(result.transition_type ?? ""),
      notes: String(result.notes ?? ""),
      cost,
    };
  }));

  const disjoint = results.filter(r => !r.logically_follows);
  const calls: DimensionCall[] = results.map(r => ({ service: "anthropic" as const, model: "claude-sonnet-4", cost_usd: r.cost }));

  return {
    name: "slide_narrative_coherence",
    status: disjoint.length === 0 ? "PASS" : "FAIL",
    details: disjoint.length === 0
      ? `All ${results.length} slide pairs flow logically. ${results.map(r => `${r.pair_index}→${r.pair_index + 1}:${r.transition_type}`).join("; ")}`
      : `${disjoint.length}/${results.length} pair(s) disjoint. ${disjoint.map(r => `${r.pair_index}→${r.pair_index + 1}: ${r.notes}`).join("; ")}`,
    call_costs: calls,
  };
}
