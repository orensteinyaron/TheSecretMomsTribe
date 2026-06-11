// Cover QA — a MANDATORY gate, not advisory. Reference-based generation
// (Gemini editing a still) drifts more than Soul, so every cover is checked
// before it is uploaded or persisted:
//
//   1. Identity     — scored as "matches reference" against the render's
//                     start_image (the same scoring philosophy as the avatar
//                     identity-markers QA: compare the two images, never
//                     feature-presence yes/no). Below threshold → the caller
//                     advances the fallback chain.
//   2. Scene        — location / wardrobe / lighting must match the
//      continuity    reference still (same room, same outfit, same light).
//   3. Sameness     — deterministic: flag if the expression/framing combo
//                     matches the previous cover.
//
// Unmeasurable dimensions return "unmeasured" (never a fabricated score);
// an unmeasured identity or scene dimension does NOT pass — the gate fails
// closed and the fallback chain advances.

import {
  claudeVisionJson,
  priceClaudeVisionCall,
  type ImagePart,
} from "../qa-helpers.js";
import type {
  CoverDirective,
  CoverQaReport,
  CoverSamenessCheck,
  RecentCover,
} from "./types.js";

/**
 * Same pass bar as the avatar identity-markers gate (full-avatar-profile
 * SKILL.md: a clip scoring <3 on identity-markers pauses the render).
 */
export const IDENTITY_PASS_THRESHOLD = 3;

const QA_PROMPT = `You are a strict visual QA agent. Image 1 is the REFERENCE (the canonical still of the woman in her set). Image 2 is a GENERATED cover candidate that is supposed to show the SAME woman in the SAME room with the SAME lighting and the SAME wardrobe, with only her expression/pose/framing changed.

Score by COMPARING the two images. Never score "is a feature present" in isolation — only "does it match the reference".

Return STRICT JSON:
{
  "identity_score": 1-5,        // 5 = unmistakably the same woman (same facial geometry, same identifying marks placed identically); 3 = plausibly the same; 1 = a different person
  "identity_notes": "...",
  "location_match": true|false, // same room, same background elements
  "wardrobe_match": true|false, // same outfit (colors, garment, neckline)
  "lighting_match": true|false, // same light direction, temperature, mood
  "scene_notes": "..."
}`;

export function checkSameness(directive: CoverDirective, previousCover: RecentCover | null): CoverSamenessCheck {
  if (!previousCover) return { flagged: false };
  const same =
    directive.expression.trim().toLowerCase() === previousCover.expression.trim().toLowerCase() &&
    directive.framing === previousCover.framing;
  return same
    ? {
        flagged: true,
        reason: `expression/framing combo ("${directive.expression}" / ${directive.framing}) matches the previous cover`,
      }
    : { flagged: false };
}

export type CoverVisionFn = typeof claudeVisionJson;

export interface QaCoverInput {
  /** Raw generated cover (pre-banner) — the banner would occlude the face/scene. */
  coverImage: ImagePart;
  referenceImage: ImagePart;
  directive: CoverDirective;
  previousCover: RecentCover | null;
}

export async function qaCover(
  input: QaCoverInput,
  vision: CoverVisionFn = claudeVisionJson,
): Promise<CoverQaReport> {
  const sameness = checkSameness(input.directive, input.previousCover);

  const { result, usage } = await vision<{
    identity_score: number;
    identity_notes: string;
    location_match: boolean;
    wardrobe_match: boolean;
    lighting_match: boolean;
    scene_notes: string;
  }>([input.referenceImage, input.coverImage], QA_PROMPT, { model: "sonnet", maxTokens: 800 });
  const cost_usd = priceClaudeVisionCall("sonnet", usage);

  if ("error" in result) {
    // Vision call failed → dimensions are unmeasured. Fail closed.
    return {
      verdict: "FAIL",
      identity: {
        score: "unmeasured",
        threshold: IDENTITY_PASS_THRESHOLD,
        pass: false,
        notes: `vision QA unavailable: ${result.error}`,
      },
      scene_continuity: {
        location_match: "unmeasured",
        wardrobe_match: "unmeasured",
        lighting_match: "unmeasured",
        pass: false,
        notes: "vision QA unavailable",
      },
      sameness,
      cost_usd,
    };
  }

  const identityScore = Number(result.identity_score);
  const identityMeasured = Number.isFinite(identityScore) && identityScore >= 1 && identityScore <= 5;
  const identityPass = identityMeasured && identityScore >= IDENTITY_PASS_THRESHOLD;
  const scenePass =
    result.location_match === true && result.wardrobe_match === true && result.lighting_match === true;

  return {
    verdict: identityPass && scenePass ? "PASS" : "FAIL",
    identity: {
      score: identityMeasured ? identityScore : "unmeasured",
      threshold: IDENTITY_PASS_THRESHOLD,
      pass: identityPass,
      notes: String(result.identity_notes ?? ""),
    },
    scene_continuity: {
      location_match: typeof result.location_match === "boolean" ? result.location_match : "unmeasured",
      wardrobe_match: typeof result.wardrobe_match === "boolean" ? result.wardrobe_match : "unmeasured",
      lighting_match: typeof result.lighting_match === "boolean" ? result.lighting_match : "unmeasured",
      pass: scenePass,
      notes: String(result.scene_notes ?? ""),
    },
    sameness,
    cost_usd,
  };
}
