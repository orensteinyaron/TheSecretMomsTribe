/**
 * bootstrapLocation — generate 3 Rachel-in-location canonical candidates for a
 * canon-defined location slot via Higgsfield nano_banana_pro.
 *
 * Human entry point: call this when Yaron wants to introduce (or regenerate
 * candidates for) a canonical location reference image. The aesthetic
 * reference URL is provided by Yaron at call time — it anchors the room style
 * via the `medias[]` slot on nano_banana_pro. The canonical-bootstrap-prompt
 * locks Rachel's position + framing on top of that aesthetic.
 *
 * Candidates are TRANSIENT: this flow returns them in-memory for Yaron's
 * review. The selected candidate is persisted later by approveLocation (C8),
 * which sets reference_image_url + reference_image_id on the row.
 *
 * Ordering invariant (fail-fast, no partial DB writes):
 *   1. Validate location_number ∈ canon set.
 *   2. Lookup canon brief from CANON_LOCATIONS.
 *   3. Validate aesthetic_reference_url is non-empty HTTPS.
 *   4. DB idempotency check via getLocation:
 *        - active+reference set → refuse (use updateLocationReference()).
 *        - pending (pre-seeded)  → proceed, no insert.
 *        - missing (defensive)   → insertLocation pending row.
 *   5. Assemble canonical-bootstrap prompt (may throw on forbidden term).
 *   6. ONE nano_banana_pro call with count=3.
 *   7. Return candidates. No persistence of candidates.
 *
 * Transport: DI — callers pass `generateNanoBananaPro` assembled via the
 * Higgsfield MCP tool from within the location SKILL. Tests pass a mock.
 *
 * @module flows/bootstrap-location
 */

import type { BootstrapLocationInput, BootstrapLocationResult } from '../types.js';
import type { NanoBananaProFn } from './constants.js';
import { LOCATION_BOOTSTRAP_CANDIDATES } from './constants.js';
import { CANON_LOCATIONS, CANON_LOCATION_NUMBERS_DEFINED } from '../canon/canon-locations.js';
import { assembleCanonicalBootstrapPrompt } from '../prompt/canonical-bootstrap-prompt.js';
import {
  getLocation as defaultGetLocation,
  insertLocation as defaultInsertLocation,
} from '../db.js';

// ── DI dependencies ───────────────────────────────────────────────────────────

/**
 * DB dependencies for bootstrapLocation. Defaults to the real Supabase-backed
 * implementations in ../db.js; tests inject stubs to avoid touching Supabase.
 */
export interface BootstrapLocationDeps {
  getLocation: typeof defaultGetLocation;
  insertLocation: typeof defaultInsertLocation;
}

const DEFAULT_DEPS: BootstrapLocationDeps = {
  getLocation: defaultGetLocation,
  insertLocation: defaultInsertLocation,
};

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap a Rachel-in-location canonical via nano_banana_pro.
 *
 * @param input - { location_number, aesthetic_reference_url }
 * @param generateNanoBananaPro - DI transport for Higgsfield nano_banana_pro.
 *   Called once with count=LOCATION_BOOTSTRAP_CANDIDATES (3).
 * @param deps - DB DI hooks. Defaults to the real db.ts functions.
 * @returns { location_id, candidate_canonicals } — candidates are transient.
 * @throws if location_number is not in CANON_LOCATION_NUMBERS_DEFINED.
 * @throws if the canon brief for that slot is missing (defensive).
 * @throws if aesthetic_reference_url is not a non-empty HTTPS URL.
 * @throws if the location row is already active with a reference image set.
 * @throws if assembleCanonicalBootstrapPrompt detects a forbidden identity term.
 */
export async function bootstrapLocation(
  input: BootstrapLocationInput,
  generateNanoBananaPro: NanoBananaProFn,
  deps: BootstrapLocationDeps = DEFAULT_DEPS,
): Promise<BootstrapLocationResult> {
  const { location_number, aesthetic_reference_url } = input;

  // 1. Validate canon slot.
  if (!(CANON_LOCATION_NUMBERS_DEFINED as readonly number[]).includes(location_number)) {
    throw new Error(
      `bootstrapLocation: location_number ${location_number} is not defined in canon. ` +
        `Defined slots: ${[...CANON_LOCATION_NUMBERS_DEFINED].join(', ')}.`,
    );
  }

  // 2. Resolve canon brief.
  const location_id = `location_${String(location_number).padStart(2, '0')}`;
  const brief = CANON_LOCATIONS[location_id];
  if (!brief) {
    // Defensive — unreachable if CANON_LOCATION_NUMBERS_DEFINED is in sync with CANON_LOCATIONS.
    throw new Error(`bootstrapLocation: missing canon brief for ${location_id}`);
  }

  // 3. Validate aesthetic_reference_url. Non-empty + HTTPS only.
  if (
    typeof aesthetic_reference_url !== 'string' ||
    aesthetic_reference_url.length === 0 ||
    !aesthetic_reference_url.startsWith('https://')
  ) {
    throw new Error(
      `bootstrapLocation: aesthetic_reference_url must be HTTPS (got: ${JSON.stringify(
        aesthetic_reference_url,
      )}). Use a public https:// URL to the reference image.`,
    );
  }

  // 4. DB idempotency check.
  const existing = await deps.getLocation(location_id);
  if (existing) {
    if (existing.status === 'active' && existing.reference_image_url !== null) {
      throw new Error(
        `bootstrapLocation: location_id '${location_id}' is already active with a reference image. ` +
          `Use updateLocationReference() to regenerate.`,
      );
    }
    // Pending row exists (pre-seeded by migration) — proceed without inserting.
  } else {
    // Defensive — pre-seed should have created pending rows for location_01 / location_02.
    // If a row is missing, create it as pending so the flow remains idempotent.
    await deps.insertLocation({
      location_id,
      name: brief.name,
      camera_angle: brief.camera_angle,
      camera_distance: brief.camera_distance,
      rachel_position: brief.rachel_position,
      background_composition: brief.background_composition,
      lighting_setup: brief.lighting_setup,
      props: [...brief.props],
      wall_color: brief.wall_color,
      floor_material: brief.floor_material,
      tier: brief.tier,
      reference_image_url: null,
      reference_image_id: null,
      notes: `Canon Location #${location_number}. Best for: ${brief.best_for}`,
      status: 'pending',
      created_by: 'skill_v1',
      source: 'canon_seed',
    });
  }

  // 5. Assemble prompt. May throw on forbidden identity term.
  const prompt = assembleCanonicalBootstrapPrompt(brief);

  // 6. One nano_banana_pro call with count=3.
  const candidates = await generateNanoBananaPro({
    prompt,
    count: LOCATION_BOOTSTRAP_CANDIDATES,
    aspect_ratio: '9:16',
    resolution: '2k',
    medias: [{ value: aesthetic_reference_url, role: 'image' }],
  });

  // 7. Return transient candidates. No DB writes for the candidates themselves.
  return {
    location_id,
    candidate_canonicals: candidates.map(c => ({ job_id: c.job_id, url: c.url })),
  };
}
