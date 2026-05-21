import type { RachelLookStatus } from '../types.js';

/**
 * Decision (2026-05-21): floor=1 active still per (look_id, location_id) combo,
 * applied ONLY when retiring an active still and the combo's current active
 * count is 1. Retiring pending stills is always allowed. Uncached combos
 * (zero active stills ever) are NOT floor violations — handled by on-demand
 * generateStill at render time.
 */
export function assertCanRetireStill(
  stillStatus: RachelLookStatus,
  currentActiveStillsForCombo: number,
):
  | { ok: true }
  | { ok: false; reason: string } {
  // Retiring a pending or already-retired still is always OK.
  if (stillStatus !== 'active') return { ok: true };

  // Retiring an active still — refuse only if it's the last one for the combo.
  if (currentActiveStillsForCombo <= 1) {
    return {
      ok: false,
      reason:
        `cannot retire the last active still for this (look_id, location_id) combo. ` +
        `Run generateStill to mint a replacement first, then retire.`,
    };
  }
  return { ok: true };
}
