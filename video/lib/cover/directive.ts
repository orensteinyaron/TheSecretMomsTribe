// Cover expression directive: maps {hook, script summary, tone} to
// {expression, gaze, pose, framing, composition_side}.
//
// Deterministic path: when the concept brief carries tone metadata
// (content_queue.avatar_config.tone ?? metadata.tone), the directive comes
// from TONE_DIRECTIVES — no LLM call. Otherwise one cheap Haiku call maps
// {hook, script summary} → the same small JSON.
//
// Variance is enforced AFTER the base directive: framing rotates
// close_up → medium → three_quarter and composition drifts off-center, and
// any {expression, framing, composition_side} combination used in the last
// 5 covers is excluded (pure function, tested).

import { claudeVisionJson, priceClaudeVisionCall } from "../qa-helpers.js";
import type { CompositionSide, CoverDirective, CoverFraming, RecentCover } from "./types.js";

// Framing leads with medium/three-quarter (body + hands visible) so covers
// read as in-action, not tight static portraits — see lessons 2026-06-23.
export const FRAMING_ROTATION: CoverFraming[] = ["medium", "three_quarter", "close_up"];
export const COMPOSITION_ROTATION: CompositionSide[] = ["center", "left", "right"];

/**
 * Deterministic tone → directive base (framing/side filled by variance).
 * Keys are lowercase; lookup is case-insensitive and tolerant of suffixes
 * (e.g. "concerned_insider" matches "concerned").
 *
 * Every pose is IN-ACTION (mid-gesture, hands visible, candid, caught
 * mid-sentence) so the grid cover differs from the wall of calm frontal
 * thumbnails — never a still, hands-out-of-frame portrait (lessons 2026-06-23,
 * Yaron correction).
 */
export const TONE_DIRECTIVES: Record<string, Pick<CoverDirective, "expression" | "gaze" | "pose">> = {
  warm:       { expression: "warm genuine smile caught mid-conversation", gaze: "direct to camera", pose: "one hand open mid-gesture near her chest, leaning in like talking to a friend" },
  concerned:  { expression: "earnest, brow softly furrowed, caught mid-sentence", gaze: "direct to camera", pose: "both hands open mid-gesture, leaning toward camera" },
  excited:    { expression: "bright open-mouth laugh, eyebrows lifted", gaze: "direct to camera", pose: "hands animated mid-gesture, shoulders turned, energetic" },
  playful:    { expression: "conspiratorial grin mid-laugh", gaze: "glancing just off-lens", pose: "one hand near her face, shoulder dipped, caught mid-gesture" },
  reassuring: { expression: "warm reassuring half-smile, soft engaged eyes, caught mid-sentence", gaze: "direct to camera", pose: "one hand open over her heart mid-gesture, leaning in gently" },
  urgent:     { expression: "serious and focused, caught mid-sentence", gaze: "direct to camera", pose: "one hand raised mid-point, leaning forward, squared shoulders" },
  curious:    { expression: "intrigued, hint of a smile, caught mid-thought", gaze: "glancing just off-lens", pose: "head turned, one hand lifted as if about to make a point" },
};

export function directiveFromTone(tone: string): Pick<CoverDirective, "expression" | "gaze" | "pose"> | null {
  const t = tone.trim().toLowerCase();
  if (TONE_DIRECTIVES[t]) return TONE_DIRECTIVES[t];
  for (const key of Object.keys(TONE_DIRECTIVES)) {
    if (t.startsWith(key) || t.includes(key)) return TONE_DIRECTIVES[key];
  }
  return null;
}

const DIRECTIVE_PROMPT = (hook: string, scriptSummary: string) => `You are casting the facial direction for a short-form video COVER IMAGE (the image moms see on the Instagram grid). The video's hook and summary are below.

Return STRICT JSON with exactly these string fields:
{"expression": "...", "gaze": "...", "pose": "..."}

Rules:
- expression: the emotional energy of the face (e.g. "mid-laugh", "earnest concern", "raised-eyebrow surprise"). Match the hook's emotional register, but pick the version with the most stopping power on a crowded grid.
- gaze: where she looks (e.g. "direct to camera", "glancing just off-lens").
- pose: upper-body language in a sentence fragment.
- NEVER describe physical facial features (face shape, skin, hair, age, etc.) — identity comes from a reference image, not from you.

HOOK: ${hook}
SUMMARY: ${scriptSummary}`;

export interface DirectiveLlmResult {
  base: Pick<CoverDirective, "expression" | "gaze" | "pose">;
  cost_usd: number;
}

/** One cheap Haiku call. Only used when no tone metadata exists. */
export async function deriveDirectiveLlm(hook: string, scriptSummary: string): Promise<DirectiveLlmResult> {
  const { result, usage } = await claudeVisionJson<{ expression: string; gaze: string; pose: string }>(
    [],
    DIRECTIVE_PROMPT(hook, scriptSummary),
    { model: "haiku", maxTokens: 300 },
  );
  const cost_usd = priceClaudeVisionCall("haiku", usage);
  if ("error" in result || !result.expression || !result.gaze || !result.pose) {
    // Fail soft to a neutral, on-brand base — the cover stage must not block
    // on a flaky directive call; variance still differentiates the frame.
    return { base: TONE_DIRECTIVES.warm, cost_usd };
  }
  return { base: { expression: result.expression, gaze: result.gaze, pose: result.pose }, cost_usd };
}

const comboKey = (expression: string, framing: CoverFraming, side: CompositionSide) =>
  `${expression.trim().toLowerCase()}|${framing}|${side}`;

/**
 * Enforce variance: pick the (framing, composition_side) pair, rotating
 * framing first, such that {expression, framing, side} was NOT used in the
 * last 5 covers. 9 candidate pairs vs ≤5 exclusions → always solvable.
 *
 * Rotation starts after the most recent cover's framing/side so consecutive
 * covers naturally cycle even when the exclusion set doesn't force it.
 */
export function applyVariance(
  base: Pick<CoverDirective, "expression" | "gaze" | "pose">,
  recent: RecentCover[],
): CoverDirective {
  const used = new Set(recent.slice(0, 5).map((r) => comboKey(r.expression, r.framing, r.composition_side)));
  const last = recent[0];
  const framingStart = last ? (FRAMING_ROTATION.indexOf(last.framing) + 1) % FRAMING_ROTATION.length : 0;
  const sideStart = last ? (COMPOSITION_ROTATION.indexOf(last.composition_side) + 1) % COMPOSITION_ROTATION.length : 0;

  for (let f = 0; f < FRAMING_ROTATION.length; f++) {
    for (let s = 0; s < COMPOSITION_ROTATION.length; s++) {
      const framing = FRAMING_ROTATION[(framingStart + f) % FRAMING_ROTATION.length];
      const side = COMPOSITION_ROTATION[(sideStart + s) % COMPOSITION_ROTATION.length];
      if (!used.has(comboKey(base.expression, framing, side))) {
        return { ...base, framing, composition_side: side };
      }
    }
  }
  // Unreachable (9 pairs > 5 exclusions), but never return undefined.
  return { ...base, framing: FRAMING_ROTATION[framingStart], composition_side: COMPOSITION_ROTATION[sideStart] };
}

export interface BuildDirectiveInput {
  hook: string;
  scriptSummary: string;
  /** Concept-brief tone (avatar_config.tone ?? metadata.tone), if present. */
  tone?: string | null;
  recentCovers: RecentCover[];
}

export interface BuildDirectiveResult {
  directive: CoverDirective;
  /** "tone" = deterministic, no LLM call made. */
  derivedVia: "tone" | "llm";
  cost_usd: number;
}

export async function buildCoverDirective(
  input: BuildDirectiveInput,
  llm: (hook: string, summary: string) => Promise<DirectiveLlmResult> = deriveDirectiveLlm,
): Promise<BuildDirectiveResult> {
  const fromTone = input.tone ? directiveFromTone(input.tone) : null;
  if (fromTone) {
    return { directive: applyVariance(fromTone, input.recentCovers), derivedVia: "tone", cost_usd: 0 };
  }
  const { base, cost_usd } = await llm(input.hook, input.scriptSummary);
  return { directive: applyVariance(base, input.recentCovers), derivedVia: "llm", cost_usd };
}
