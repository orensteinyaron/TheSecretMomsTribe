/**
 * getLocationReference — thin wrapper over getLocationReferenceImage.
 *
 * Used by external callers + the location SKILL.md sub-flow C. Returns the
 * locked canonical reference_image_url, or null if the location has not
 * yet been bootstrapped.
 *
 * @module flows/get-location-reference
 */

import { getLocationReferenceImage } from '../db.js';

// ── DI dependencies ───────────────────────────────────────────────────────────

export interface GetLocationReferenceDeps {
  getLocationReferenceImage: typeof getLocationReferenceImage;
}

const DEFAULT_DEPS: GetLocationReferenceDeps = {
  getLocationReferenceImage,
};

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Returns the locked reference_image_url for a location, or null if not
 * yet bootstrapped.
 *
 * @param location_id - e.g. 'location_01'.
 * @param deps - DI hooks. Defaults to real db.ts implementations.
 */
export async function getLocationReference(
  location_id: string,
  deps: GetLocationReferenceDeps = DEFAULT_DEPS,
): Promise<string | null> {
  return deps.getLocationReferenceImage(location_id);
}
