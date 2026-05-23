import type { RachelStill } from '../types.js';
import {
  getStill, updateStillStatus, listStills,
  getLook, updateLookStatus,
} from '../db.js';
import { getLocation, updateLocationStatus } from '../../location/db.js';

/**
 * Transitions a still from 'pending' → 'active'. Also handles bootstrap:
 * if the still's parent look OR location is currently 'pending', auto-promote
 * the parent to 'active' in the same logical transaction.
 *
 * Plus: retires OTHER pending stills for the same (look, location) combo —
 * during bootstrap, 6 candidate stills are inserted and only one gets approved;
 * the other 5 are auto-retired here.
 *
 * Caveat: this is a multi-statement sequence, NOT a real DB transaction. If
 * a later statement fails, the earlier ones have already committed.
 *
 * Statement order (designed for idempotent retry):
 *   1. Auto-promote parent look if pending
 *   2. Auto-promote parent location if pending
 *   3. Promote the still (pending → active)
 *   4. Retire sibling pending stills for the same (look_id, location_id) combo
 *
 * Why this order: if step 3 fails after 1+2 succeeded, the still is still
 * pending; retrying approveStill(same id) repeats steps 1-2 as no-ops (parents
 * already active) and completes step 3. If step 4 partially fails, the next
 * retry re-lists pending siblings (now fewer) and retires them. No orphan
 * states require manual SQL recovery.
 */
export async function approveStill(still_id: string): Promise<RachelStill> {
  const still = await getStill(still_id);
  if (still === null) {
    throw new Error(`approveStill: still_id '${still_id}' not found`);
  }
  if (still.status !== 'pending') {
    throw new Error(
      `approveStill: refusing to approve still_id '${still_id}' — current status is '${still.status}', expected 'pending'`,
    );
  }

  // 1. If parent look is pending, auto-promote it. (Idempotent: skipped if already active.)
  const parentLook = await getLook(still.look_id);
  if (parentLook && parentLook.status === 'pending') {
    await updateLookStatus(still.look_id, 'active');
  }

  // 2. If parent location is pending, auto-promote it. (Idempotent: skipped if already active.)
  const parentLocation = await getLocation(still.location_id);
  if (parentLocation && parentLocation.status === 'pending') {
    await updateLocationStatus(still.location_id, 'active');
  }

  // 3. Promote the still itself.
  const approvedStill = await updateStillStatus(still_id, 'active');

  // 4. Retire OTHER pending stills for the same (look_id, location_id) combo.
  const siblingPending = await listStills({
    look_id: still.look_id,
    location_id: still.location_id,
    status: 'pending',
  });
  for (const sibling of siblingPending) {
    if (sibling.still_id !== still_id) {
      await updateStillStatus(sibling.still_id, 'retired');
    }
  }

  return approvedStill;
}
