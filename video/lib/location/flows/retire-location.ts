/**
 * retireLocation — transitions a location from 'active' → 'retired'.
 *
 * Mirrors the PR-A revision semantics exactly:
 *   - Floor=2: at least LOCATION_POOL_FLOOR (=2) active locations must
 *     remain after retirement.
 *   - Primary floor: at least 1 active primary must remain.
 *
 * The retire-guard logic lives in
 * wardrobe-rotation/guards/assert-can-retire-location.ts and is imported
 * here verbatim — no duplication. The guard is pure (no DB), so the only
 * DB calls in this flow are getLocation, listActiveLocations, and the
 * updateLocationStatus write.
 *
 * @module flows/retire-location
 */

import type { RachelLocation } from '../../wardrobe-rotation/types.js';
import {
  getLocation,
  updateLocationStatus,
  listActiveLocations,
} from '../db.js';
import { assertCanRetireLocation } from '../../wardrobe-rotation/guards/assert-can-retire-location.js';

// ── DI dependencies ───────────────────────────────────────────────────────────

export interface RetireLocationDeps {
  getLocation: typeof getLocation;
  updateLocationStatus: typeof updateLocationStatus;
  listActiveLocations: typeof listActiveLocations;
}

const DEFAULT_DEPS: RetireLocationDeps = {
  getLocation,
  updateLocationStatus,
  listActiveLocations,
};

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Retires an active location after enforcing the pool-floor + primary-floor
 * invariants.
 *
 * @param location_id - e.g. 'location_01'.
 * @param deps - DI hooks. Defaults to real db.ts implementations.
 * @throws if location_id is not found.
 * @throws if status is not 'active'.
 * @throws if retiring would drop the active count to ≤ LOCATION_POOL_FLOOR.
 * @throws if retiring would leave 0 active primary locations.
 */
export async function retireLocation(
  location_id: string,
  deps: RetireLocationDeps = DEFAULT_DEPS,
): Promise<RachelLocation> {
  const row = await deps.getLocation(location_id);
  if (row === null) {
    throw new Error(`retireLocation: location_id '${location_id}' not found`);
  }
  if (row.status !== 'active') {
    throw new Error(
      `retireLocation: refusing to retire location_id '${location_id}' — current status is '${row.status}', expected 'active'`,
    );
  }
  const actives = await deps.listActiveLocations();
  const primaryCount = actives.filter(l => l.tier === 'primary').length;
  const decision = assertCanRetireLocation(actives.length, primaryCount, row.tier);
  if (!decision.ok) {
    throw new Error(
      `retireLocation: refusing to retire location_id '${location_id}' — ${decision.reason}`,
    );
  }
  return deps.updateLocationStatus(location_id, 'retired');
}
