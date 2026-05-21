import type { RachelStill } from '../types.js';
import { getStill, updateStillStatus, countActiveStillsForCombo } from '../db.js';
import { assertCanRetireStill } from '../guards/assert-can-retire-still.js';

/**
 * Transitions a still from active or pending → retired.
 * Floor-1 guard: refuse retire of the last active still for its combo
 * (would leave the combo with no active still). Pending stills can be
 * retired freely.
 */
export async function retireStill(still_id: string): Promise<RachelStill> {
  const row = await getStill(still_id);
  if (row === null) {
    throw new Error(`retireStill: still_id '${still_id}' not found`);
  }
  if (row.status === 'retired') {
    throw new Error(
      `retireStill: refusing to retire still_id '${still_id}' — already retired`,
    );
  }
  const activeCountForCombo = await countActiveStillsForCombo(row.look_id, row.location_id);
  const decision = assertCanRetireStill(row.status, activeCountForCombo);
  if (!decision.ok) {
    throw new Error(`retireStill: refusing to retire still_id '${still_id}' — ${decision.reason}`);
  }
  return updateStillStatus(still_id, 'retired');
}
