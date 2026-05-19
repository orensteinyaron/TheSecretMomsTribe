import type { RachelLook } from './types.js';
import { getLook, updateLookStatus, listActiveLooks } from './db.js';

/**
 * Transitions a look from 'active' → 'retired'.
 *
 * Guards:
 * - Look must exist.
 * - Look must currently be 'active'.
 * - Floor-3 guard: retiring must not drop the active pool below 3.
 *   Retire is allowed only when there are at least 4 active looks (post-retire ≥ 3).
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

  if (activeLooks.length <= 3) {
    throw new Error(
      `retireLook: refusing to retire look_id '${look_id}' — only ${activeLooks.length} active looks remain; pool floor is 3`,
    );
  }

  return updateLookStatus(look_id, 'retired');
}
