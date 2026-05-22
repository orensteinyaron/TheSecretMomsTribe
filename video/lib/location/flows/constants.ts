/**
 * Constants + DI transport types for the location skill flows.
 *
 * The flows are tested via dependency injection: callers (typically the
 * location SKILL.md runtime) pass a transport function that wraps the
 * `mcp__78d93fcf-...__generate_image` Higgsfield MCP call with
 * `model_id: 'nano_banana_pro'`. Tests pass a mock transport.
 */

/** Number of Rachel-in-location canonical candidates to generate per bootstrap. */
export const LOCATION_BOOTSTRAP_CANDIDATES = 3;

/** Number of wardrobe-swap candidates to generate per anchored-still flow. */
export const ANCHORED_STILL_CANDIDATES = 3;

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
