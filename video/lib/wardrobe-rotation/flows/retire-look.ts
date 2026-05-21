import type { RachelLook } from '../types.js';
import { getLook, updateLookStatus, listActiveLooks } from '../db.js';
import { assertCanRetireLook } from '../guards/assert-can-retire-look.js';

/**
 * Transitions a look from 'active' → 'retired'.
 * Floor=4 guard (cooldown=3 picker requires ≥4 active to remain functional).
 * Emits a console.warn if active count after retire would equal 4 (the floor)
 * or if currently at the WARNING_THRESHOLD (5).
 */
export async function retireLook(look_id: string): Promise<RachelLook> {
  const row = await getLook(look_id);
  if (row === null) {
    throw new Error(`retireLook: look_id '${look_id}' not found`);
  }
  if (row.status !== 'active') {
    throw new Error(
      `retireLook: refusing to retire look_id '${look_id}' — current status is '${row.status}', expected 'active'`,
    );
  }
  const activeLooks = await listActiveLooks();
  const decision = assertCanRetireLook(activeLooks.length);
  if (!decision.ok) {
    throw new Error(`retireLook: refusing to retire look_id '${look_id}' — ${decision.reason}`);
  }
  if (decision.warning) {
    console.warn(`[retireLook] ${decision.warning}`);
  }
  return updateLookStatus(look_id, 'retired');
}
