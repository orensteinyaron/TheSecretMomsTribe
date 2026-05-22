import type { LocationTier } from '../types.js';

export const LOCATION_POOL_FLOOR = 2;
export const PRIMARY_LOCATION_MIN = 1;

export function assertCanRetireLocation(
  currentActiveCount: number,
  currentActivePrimaryCount: number,
  retiringLocationTier: LocationTier,
):
  | { ok: true }
  | { ok: false; reason: string } {
  if (currentActiveCount <= LOCATION_POOL_FLOOR) {
    return {
      ok: false,
      reason: `only ${currentActiveCount} active locations remain; pool floor is ${LOCATION_POOL_FLOOR}`,
    };
  }
  if (retiringLocationTier === 'primary' && currentActivePrimaryCount <= PRIMARY_LOCATION_MIN) {
    return {
      ok: false,
      reason: `cannot retire the last active primary location; at least ${PRIMARY_LOCATION_MIN} primary must remain`,
    };
  }
  return { ok: true };
}
