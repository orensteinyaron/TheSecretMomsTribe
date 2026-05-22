import type {
  RachelLook,
  RachelLocation,
  RachelStill,
  RecentLookPick,
  RecentLocationPick,
} from '../types.js';
import { pickLook } from './pick-look.js';
import { pickLocation } from './pick-location.js';

export interface PickCombinationInput {
  activeLooks: RachelLook[];
  activeLocations: RachelLocation[];
  activeStills: RachelStill[];
  recentLookPicks: RecentLookPick[];
  recentLocationPicks: RecentLocationPick[];
}

export type PickCombinationResult =
  | { look_id: string; location_id: string; still_id: string; needs_generation: false }
  | { look_id: string; location_id: string; still_id: null; needs_generation: true };

export function pickCombination(input: PickCombinationInput): PickCombinationResult {
  const look_id = pickLook(
    input.activeLooks.map((l) => l.look_id),
    input.recentLookPicks,
  );
  const location_id = pickLocation(input.activeLocations, input.recentLocationPicks);

  // Find still where both look_id and location_id match and status is active
  const still = input.activeStills.find(
    (s) => s.look_id === look_id && s.location_id === location_id && s.status === 'active',
  );

  if (still) {
    return { look_id, location_id, still_id: still.still_id, needs_generation: false };
  }
  return { look_id, location_id, still_id: null, needs_generation: true };
}
