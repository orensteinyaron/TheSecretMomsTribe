// Two-axis types for the wardrobe-rotation system.
//
// Look (styling axis) and Location (setting axis) are independent. A Still
// is the cached Higgsfield Soul 2.0 output for a specific (look, location)
// combination. Picked at render time by pickCombination.

export type RachelLookStatus = 'pending' | 'active' | 'retired';
export type LocationTier = 'primary' | 'secondary';
export type Source = 'canon_seed' | 'skill_v1';

export interface RachelLook {
  look_id: string;             // 'look_01', 'look_12', ...
  wardrobe: string;
  hair: string;
  accessories: string | null;
  notes: string | null;
  status: RachelLookStatus;
  created_at: string;
  approved_at: string | null;
  retired_at: string | null;
  created_by: string;
  source: Source;
}

export interface RachelLocation {
  location_id: string;               // 'location_01', 'location_02', ...
  name: string;                      // 'kitchen', 'home_studio'
  camera_angle: string;
  camera_distance: string;
  rachel_position: string;
  background_composition: string;
  lighting_setup: string;
  props: string[];
  wall_color: string;
  floor_material: string;
  reference_image_url: string | null; // NULL until bootstrap approval
  reference_image_id: string | null;
  tier: LocationTier;
  notes: string | null;
  status: RachelLookStatus;           // same lifecycle as looks
  created_at: string;
  approved_at: string | null;
  retired_at: string | null;
  created_by: string;
  source: Source;
}

export interface RachelStill {
  still_id: string;                   // uuid
  look_id: string;
  location_id: string;
  soul_still_id: string;
  soul_still_url: string;
  reference_image_url_used: string;   // snapshot of location.reference_image_url at generation time
  status: RachelLookStatus;
  created_at: string;
  approved_at: string | null;
  retired_at: string | null;
  created_by: string;
}

export interface RecentLookPick {
  look_id: string;
  used_at: string;
}

export interface RecentLocationPick {
  location_id: string;
  tier: LocationTier;
  used_at: string;
}

export interface CanonLookBrief {
  wardrobe: string;
  hair: string;
  accessories: string | null;
  best_for: string;
}

// CanonLocationBrief has moved to video/lib/location/types.ts
