import type { LocationTier } from '../wardrobe-rotation/types.js';

/**
 * Canonical brief for a location — used by the bootstrap prompt assembler to
 * generate the Rachel-in-location canonical. Mirrors the structured fields in
 * rachel_locations table (minus lifecycle/audit columns).
 */
export interface CanonLocationBrief {
  name: string;                  // 'kitchen', 'home_studio'
  tier: LocationTier;
  camera_angle: string;          // 'eye level, straight on'
  camera_distance: string;       // 'medium shot, chest up'
  rachel_position: string;       // 'standing just behind the kitchen island, hands resting on the marble surface'
  background_composition: string;
  lighting_setup: string;
  props: readonly string[];
  wall_color: string;
  floor_material: string;
  best_for: string;              // editorial guidance, NOT used in the generation prompt
}

/**
 * Input shape for bootstrapLocation flow.
 */
export interface BootstrapLocationInput {
  location_number: number;          // 1, 2, ... — must be in CANON_LOCATION_NUMBERS_DEFINED
  aesthetic_reference_url: string;  // Public HTTPS URL to the desired location aesthetic
}

/**
 * Result shape for bootstrapLocation flow. Candidates are transient
 * (not persisted to DB until approveLocation is called).
 */
export interface BootstrapLocationResult {
  location_id: string;              // 'location_01', 'location_02', ...
  candidate_canonicals: ReadonlyArray<{
    job_id: string;
    url: string;
  }>;
}

/**
 * Result shape for generateAnchoredStill flow.
 */
export interface GenerateAnchoredStillResult {
  still_id: string;                      // uuid of the auto-approved active still
  soul_still_id: string;
  soul_still_url: string;
  reference_image_url_used: string;
  retired_still_ids: readonly string[];  // the 2 auto-retired candidates
}
