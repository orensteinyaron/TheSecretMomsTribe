/**
 * Constants + DI transport types for the location skill flows.
 *
 * The flows are tested via dependency injection: callers (typically the
 * location SKILL.md runtime) pass a transport function that wraps the
 * `mcp__78d93fcf-...__generate_image` Higgsfield MCP call with
 * `model_id: 'nano_banana_pro'`. Tests pass a mock transport.
 */

/**
 * Number of Rachel-in-location canonical candidates to generate per bootstrap.
 *
 * Set to 1 because Higgsfield's generate_image MCP silently caps batch_size
 * at 1 regardless of the count parameter (see "Known Higgsfield quirks"
 * below). Raising this without a Higgsfield fix would cause the
 * generate-anchored-still assertion to throw at runtime.
 */
export const LOCATION_BOOTSTRAP_CANDIDATES = 1;

/**
 * Number of wardrobe-swap candidates to generate per anchored-still flow.
 *
 * Set to 1 for the same Higgsfield count-cap reason as
 * LOCATION_BOOTSTRAP_CANDIDATES — see the "Known Higgsfield quirks" block.
 */
export const ANCHORED_STILL_CANDIDATES = 1;

// ── Known Higgsfield quirks (as of 2026-05-23) ──────────────────────────────
// 1. count=N is silently ignored. Higgsfield's generate_image MCP delivers
//    batch_size: 1 regardless of the count parameter — observed across every
//    PR-A revision + PR-C smoke. LOCATION_BOOTSTRAP_CANDIDATES /
//    ANCHORED_STILL_CANDIDATES are set to 1 to match this reality. Do not
//    raise them without confirming with a fresh Higgsfield support ticket.
//
// 2. show_generations history view displays `nano_banana_2` for requests
//    submitted with `model: 'nano_banana_pro'`. Unclear whether this is a
//    display-only quirk or a silent downgrade at submission time. Do NOT
//    rename the model name string in the SKILL runtime — both PR-A revision
//    and PR-C used this exact submission shape and produced acceptable
//    quality. Pending Higgsfield support ticket.

/** Higgsfield `medias` entry shape — currently only `image` role is supported. */
export interface MediasReference {
  value: string;     // Public URL to the reference image
  role: 'image';     // Only supported role at time of writing (see CLAUDE.md)
}

/** Input for the nano_banana_pro DI transport. */
export interface NanoBananaProInput {
  prompt: string;
  count: number;            // 1-4
  aspect_ratio: '9:16';
  resolution: '2k';
  medias: MediasReference[];
}

/** Output: one record per generated candidate. */
export interface NanoBananaProImage {
  job_id: string;
  url: string;
}

/** DI transport callable. */
export type NanoBananaProFn = (input: NanoBananaProInput) => Promise<NanoBananaProImage[]>;

/**
 * Input for the Higgsfield Soul 2.0 DI transport (`model: 'soul_2'`).
 *
 * Soul-pass-through (PR-B): after nano_banana_pro produces a wardrobe + location
 * composition anchor, we feed that anchor as `medias[role:image]` into Soul 2.0
 * with Rachel's locked `soul_id`. The output preserves composition but locks
 * the face to canonical Rachel. Validated empirically vs raw-nano start_image
 * — see /Users/yarono/.claude/plans/expressive-waddling-bee.md.
 *
 * Soul 2.0 internally applies `enhance_prompt: true`; we accept that because
 * the medias anchor carries enough composition signal to dominate the rewrite.
 */
export interface Soul2Input {
  prompt: string;
  soul_id: string;
  aspect_ratio: '9:16';
  medias: MediasReference[]; // exactly 1 image — the nano anchor
  count: 1;                  // always 1 — we want a single locked output
}

/** Output: one record (count is always 1). */
export interface Soul2Image {
  job_id: string;
  url: string;
}

/** DI transport callable. */
export type Soul2Fn = (input: Soul2Input) => Promise<Soul2Image[]>;
