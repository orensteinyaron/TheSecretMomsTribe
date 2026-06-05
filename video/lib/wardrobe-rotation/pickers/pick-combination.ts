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
  /**
   * Pre-pinned look_id (YAR-146). When provided, the look LRU pick is SKIPPED
   * and this id is used verbatim — it must exist in `activeLooks` or this
   * throws. Used for controlled e2e renders that pin one axis while letting the
   * other rotate.
   */
  pinnedLookId?: string;
  /** Pre-pinned location_id (YAR-146). Same semantics as pinnedLookId, validated against `activeLocations`. */
  pinnedLocationId?: string;
}

export type PickCombinationResult =
  | { look_id: string; location_id: string; still_id: string; needs_generation: false }
  | { look_id: string; location_id: string; still_id: null; needs_generation: true };

export function pickCombination(input: PickCombinationInput): PickCombinationResult {
  // Truthiness guard (not `!== undefined`): a JSON `null` or `""` in
  // avatar_config means "not pinned → LRU fills it", not an error. Only a
  // real non-empty string pin is honored / validated against the active set.
  let look_id: string;
  if (input.pinnedLookId) {
    if (!input.activeLooks.some((l) => l.look_id === input.pinnedLookId)) {
      throw new Error(`pinned look_id ${input.pinnedLookId} is not an active look`);
    }
    look_id = input.pinnedLookId;
  } else {
    look_id = pickLook(
      input.activeLooks.map((l) => l.look_id),
      input.recentLookPicks,
    );
  }

  let location_id: string;
  if (input.pinnedLocationId) {
    if (!input.activeLocations.some((l) => l.location_id === input.pinnedLocationId)) {
      throw new Error(`pinned location_id ${input.pinnedLocationId} is not an active location`);
    }
    location_id = input.pinnedLocationId;
  } else {
    location_id = pickLocation(input.activeLocations, input.recentLocationPicks);
  }

  // Find still where both look_id and location_id match and status is active
  const still = input.activeStills.find(
    (s) => s.look_id === look_id && s.location_id === location_id && s.status === 'active',
  );

  if (still) {
    return { look_id, location_id, still_id: still.still_id, needs_generation: false };
  }
  return { look_id, location_id, still_id: null, needs_generation: true };
}
