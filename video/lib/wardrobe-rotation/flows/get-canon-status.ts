import type { RachelLookStatus } from '../types.js';
import { CANON_LOOKS } from '../canon/canon-looks.js';
import { CANON_LOCATIONS } from '../canon/canon-locations.js';
import { listLooks, listLocations, listStills } from '../db.js';

export interface CanonSlotStatus {
  id: string;
  defined_in_canon: boolean;
  db_status: RachelLookStatus | 'missing';
}

export interface CanonStatus {
  looks: CanonSlotStatus[];
  locations: CanonSlotStatus[];
  combinations: Array<{
    look_id: string;
    location_id: string;
    has_active_still: boolean;
  }>;
  active_look_count: number;
  active_location_count: number;
  active_still_count: number;
}

/**
 * Surfaces the current pool state for human inspection.
 * Use to answer "what's the wardrobe state", "which canon slots are missing",
 * "show me the pool" type questions from the skill.
 */
export async function getCanonStatus(): Promise<CanonStatus> {
  const [allLooks, allLocations, allStills] = await Promise.all([
    listLooks(),
    listLocations(),
    listStills({ status: 'active' }),
  ]);

  const lookDbMap = new Map(allLooks.map(l => [l.look_id, l.status]));
  const locationDbMap = new Map(allLocations.map(l => [l.location_id, l.status]));

  // Combine canon-defined slots with DB-present slots (union).
  const allLookIds = new Set<string>([
    ...Object.keys(CANON_LOOKS),
    ...allLooks.map(l => l.look_id),
  ]);
  const allLocationIds = new Set<string>([
    ...Object.keys(CANON_LOCATIONS),
    ...allLocations.map(l => l.location_id),
  ]);

  const lookStatuses: CanonSlotStatus[] = Array.from(allLookIds).sort().map(id => ({
    id,
    defined_in_canon: id in CANON_LOOKS,
    db_status: lookDbMap.get(id) ?? 'missing',
  }));

  const locationStatuses: CanonSlotStatus[] = Array.from(allLocationIds).sort().map(id => ({
    id,
    defined_in_canon: id in CANON_LOCATIONS,
    db_status: locationDbMap.get(id) ?? 'missing',
  }));

  // Combinations from active stills only.
  const combinations = allStills.map(s => ({
    look_id: s.look_id,
    location_id: s.location_id,
    has_active_still: true,
  }));

  return {
    looks: lookStatuses,
    locations: locationStatuses,
    combinations,
    active_look_count: allLooks.filter(l => l.status === 'active').length,
    active_location_count: allLocations.filter(l => l.status === 'active').length,
    active_still_count: allStills.length,
  };
}
