// Cover-image stage types (Avatar Full v5 --phase=cover).
//
// The cover is a SECOND visual deliverable next to the video: a
// purpose-generated 9:16 image with the same atmosphere as the reel (same
// look, location, lighting — identity anchored to the render's Soul still as
// a REFERENCE IMAGE, never described in text) but different energy in the
// face and frame, so the IG grid doesn't read as N identical frontal Rachels.
//
// Generation is EXTERNAL to Higgsfield by design (cost reduction / future
// migration): primary tier is Gemini Nano Banana called directly with
// GEMINI_API_KEY; Soul 2.0 via Higgsfield is the registered last-resort
// fallback (services table: gemini_nano_banana → higgsfield_soul).

export type CoverFraming = "close_up" | "medium" | "three_quarter";
export type CompositionSide = "left" | "center" | "right";

/** Which tier of the fallback chain produced the final cover. */
export type CoverSource = "gemini" | "gemini_retry" | "soul_higgsfield";

/**
 * What changes between the reel's opening frame and the cover: expression,
 * gaze, pose, framing, and a slight off-center composition. Everything else
 * (woman, room, lighting, wardrobe) is held to the reference image.
 */
export interface CoverDirective {
  /** e.g. "soft conspiratorial smile", "mid-laugh", "raised-eyebrow surprise" */
  expression: string;
  /** e.g. "direct to camera", "glancing just off-lens" */
  gaze: string;
  /** e.g. "leaning slightly toward camera", "arms loosely crossed" */
  pose: string;
  framing: CoverFraming;
  composition_side: CompositionSide;
}

/** The variance-relevant slice of a previously generated cover. */
export interface RecentCover {
  expression: string;
  framing: CoverFraming;
  composition_side: CompositionSide;
}

/** Identity is scored as "matches reference" (never feature-presence). */
export interface CoverIdentityCheck {
  /** 1–5 match-to-reference score, or "unmeasured" when the vision call failed. */
  score: number | "unmeasured";
  threshold: number;
  pass: boolean;
  notes: string;
}

export interface CoverSceneContinuityCheck {
  location_match: boolean | "unmeasured";
  wardrobe_match: boolean | "unmeasured";
  lighting_match: boolean | "unmeasured";
  pass: boolean;
  notes: string;
}

export interface CoverSamenessCheck {
  /** true when the expression/framing combo matches the previous cover. */
  flagged: boolean;
  reason?: string;
}

export interface CoverQaReport {
  verdict: "PASS" | "FAIL";
  identity: CoverIdentityCheck;
  scene_continuity: CoverSceneContinuityCheck;
  sameness: CoverSamenessCheck;
  cost_usd: number;
}

/** Persisted under content_queue.metadata.cover. */
export interface CoverMetadata {
  expression: string;
  gaze: string;
  pose: string;
  framing: CoverFraming;
  composition_side: CompositionSide;
  /** Which fallback tier produced the final cover. */
  source: CoverSource;
  model: string;
  qa: {
    verdict: "PASS" | "FAIL";
    identity_score: number | "unmeasured";
    scene_continuity_pass: boolean;
    sameness_flagged: boolean;
  };
  generated_at: string;
  cost_usd: number;
}

export interface CoverAttempt {
  tier: CoverSource;
  qa: CoverQaReport;
}

/** Result of the Gemini tiers (1 + 2). Tier 3 is session-driven (MCP). */
export type CoverGenerationResult =
  | {
      status: "PASS";
      source: CoverSource;
      directive: CoverDirective;
      /** Raw generated cover (pre-banner), PNG bytes. */
      rawCover: Buffer;
      qa: CoverQaReport;
      attempts: CoverAttempt[];
      cost_usd: number;
    }
  | {
      status: "NEEDS_SOUL_FALLBACK";
      directive: CoverDirective;
      attempts: CoverAttempt[];
      cost_usd: number;
    };
