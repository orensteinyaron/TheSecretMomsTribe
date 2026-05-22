import type { RachelLocation } from '../types.js';
import { getLocation, updateLocationStatus, listActiveLocations } from '../db.js';
import { assertCanRetireLocation } from '../guards/assert-can-retire-location.js';

/**
 * Transitions a location from 'active' → 'retired'.
 * Floor=2 guard (at least 2 active locations must remain).
 * Primary-floor guard: at least 1 active primary location must remain.
 */
export async function retireLocation(location_id: string): Promise<RachelLocation> {
  const row = await getLocation(location_id);
  if (row === null) {
    throw new Error(`retireLocation: location_id '${location_id}' not found`);
  }
  if (row.status !== 'active') {
    throw new Error(
      `retireLocation: refusing to retire location_id '${location_id}' — current status is '${row.status}', expected 'active'`,
    );
  }
  const activeLocations = await listActiveLocations();
  const primaryCount = activeLocations.filter(l => l.tier === 'primary').length;
  const decision = assertCanRetireLocation(activeLocations.length, primaryCount, row.tier);
  if (!decision.ok) {
    throw new Error(`retireLocation: refusing to retire location_id '${location_id}' — ${decision.reason}`);
  }
  return updateLocationStatus(location_id, 'retired');
}
