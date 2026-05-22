import type { RachelLook } from '../types.js';
import { getLook, updateLookStatus } from '../db.js';

/**
 * Transitions a look from 'pending' → 'active'.
 * Throws if not pending or not found.
 */
export async function approveLook(look_id: string): Promise<RachelLook> {
  const row = await getLook(look_id);
  if (row === null) {
    throw new Error(`approveLook: look_id '${look_id}' not found`);
  }
  if (row.status !== 'pending') {
    throw new Error(
      `approveLook: refusing to approve look_id '${look_id}' — current status is '${row.status}', expected 'pending'`,
    );
  }
  return updateLookStatus(look_id, 'active');
}
