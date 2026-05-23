/**
 * approveLocation — bootstrap completion: pending → active.
 *
 * Differs from the PR-A revision's approveLocation: this version REQUIRES
 * the chosen canonical's reference_image_url + reference_image_id, written
 * atomically alongside the status flip. An active location without a
 * reference image is forbidden (the anchored-still flow can't render).
 *
 * The reference is written BEFORE the status flip so that any reader who
 * sees status='active' is guaranteed to see reference_image_url set.
 *
 * Caveat: this is two sequential writes, not a real DB transaction. A
 * crash between the reference write and the status flip leaves the row
 * in (pending, reference_image_url set) — recoverable by re-running
 * approveLocation with the same arguments (idempotent on the reference
 * column, then flips status).
 *
 * @module flows/approve-location
 */

import type { RachelLocation } from '../../wardrobe-rotation/types.js';
import {
  getLocation,
  updateLocationStatus,
  updateLocationReferenceImage,
} from '../db.js';

// ── DI dependencies ───────────────────────────────────────────────────────────

export interface ApproveLocationDeps {
  getLocation: typeof getLocation;
  updateLocationStatus: typeof updateLocationStatus;
  updateLocationReferenceImage: typeof updateLocationReferenceImage;
}

const DEFAULT_DEPS: ApproveLocationDeps = {
  getLocation,
  updateLocationStatus,
  updateLocationReferenceImage,
};

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Approves a pending location by writing the chosen canonical reference
 * image + flipping status to 'active'.
 *
 * @param location_id - e.g. 'location_01'.
 * @param reference_image_url - HTTPS URL of the chosen canonical candidate.
 * @param reference_image_id - Higgsfield job_id of the chosen canonical.
 * @param deps - DI hooks. Defaults to real db.ts implementations.
 * @throws if reference_image_url is empty / not HTTPS.
 * @throws if reference_image_id is empty.
 * @throws if location_id is not found.
 * @throws if status is not 'pending'.
 */
export async function approveLocation(
  location_id: string,
  reference_image_url: string,
  reference_image_id: string,
  deps: ApproveLocationDeps = DEFAULT_DEPS,
): Promise<RachelLocation> {
  // 1. Validate URL.
  if (!reference_image_url || !reference_image_url.startsWith('https://')) {
    throw new Error(
      `approveLocation: reference_image_url must be a non-empty HTTPS URL (got '${reference_image_url}')`,
    );
  }
  if (!reference_image_id || reference_image_id.trim() === '') {
    throw new Error('approveLocation: reference_image_id must be a non-empty string');
  }

  // 2. Validate row.
  const row = await deps.getLocation(location_id);
  if (row === null) {
    throw new Error(`approveLocation: location_id '${location_id}' not found`);
  }
  if (row.status !== 'pending') {
    throw new Error(
      `approveLocation: refusing to approve location_id '${location_id}' — current status is '${row.status}', expected 'pending'`,
    );
  }

  // 3. Reference first, then status flip — any reader seeing 'active' is
  //    guaranteed to see reference_image_url set.
  await deps.updateLocationReferenceImage(location_id, reference_image_url, reference_image_id);
  return deps.updateLocationStatus(location_id, 'active');
}
