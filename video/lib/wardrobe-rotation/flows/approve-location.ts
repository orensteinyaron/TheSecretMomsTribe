import type { RachelLocation } from '../types.js';
import { getLocation, updateLocationStatus } from '../db.js';

/**
 * Transitions a location from 'pending' → 'active'.
 * Throws if not pending or not found.
 */
export async function approveLocation(location_id: string): Promise<RachelLocation> {
  const row = await getLocation(location_id);
  if (row === null) {
    throw new Error(`approveLocation: location_id '${location_id}' not found`);
  }
  if (row.status !== 'pending') {
    throw new Error(
      `approveLocation: refusing to approve location_id '${location_id}' — current status is '${row.status}', expected 'pending'`,
    );
  }
  return updateLocationStatus(location_id, 'active');
}
