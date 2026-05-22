/**
 * updateLocationReference — regenerates the canonical for an already-active
 * location, returning 3 candidates for Yaron's review (same shape as
 * bootstrapLocation). The chosen URL is then written via
 * confirmReferenceUpdate.
 *
 * Historical reference_image_url_used values on existing stills are
 * preserved (they live on rachel_stills, not on the location row).
 * Retiring stills generated against the old reference is out of scope
 * for PR-C.
 *
 * @module flows/update-location-reference
 */

import type {
  BootstrapLocationInput,
  BootstrapLocationResult,
} from '../types.js';
import type { NanoBananaProFn } from './constants.js';
import type { RachelLocation } from '../../wardrobe-rotation/types.js';
import { bootstrapLocation } from './bootstrap-location.js';
import { getLocation, updateLocationReferenceImage } from '../db.js';

// ── DI dependencies ───────────────────────────────────────────────────────────

export interface UpdateLocationReferenceDeps {
  getLocation: typeof getLocation;
  updateLocationReferenceImage: typeof updateLocationReferenceImage;
}

const DEFAULT_DEPS: UpdateLocationReferenceDeps = {
  getLocation,
  updateLocationReferenceImage,
};

// ── updateLocationReference ───────────────────────────────────────────────────

/**
 * Regenerates the locked canonical for an already-active location.
 *
 * Returns 3 candidate URLs for Yaron's review (same shape as
 * bootstrapLocation). The chosen URL is then written via
 * confirmReferenceUpdate.
 *
 * Implementation note: delegates to `bootstrapLocation` with a synthetic
 * deps object that masks `reference_image_url` as null on the active row.
 * This bypasses bootstrap's "already active + reference set" idempotency
 * refusal — which is the correct behaviour here, because we've already
 * verified the row IS active and we WANT to regenerate.
 *
 * @throws if the location is not in 'active' status (must be bootstrapped first).
 * @throws if the location row is not found.
 */
export async function updateLocationReference(
  input: BootstrapLocationInput,
  generateNanoBananaPro: NanoBananaProFn,
  deps: UpdateLocationReferenceDeps = DEFAULT_DEPS,
): Promise<BootstrapLocationResult> {
  const location_id = `location_${String(input.location_number).padStart(2, '0')}`;
  const row = await deps.getLocation(location_id);
  if (row === null) {
    throw new Error(`updateLocationReference: location_id '${location_id}' not found`);
  }
  if (row.status !== 'active') {
    throw new Error(
      `updateLocationReference: location_id '${location_id}' is '${row.status}', expected 'active'. ` +
        `Use bootstrapLocation for pending locations.`,
    );
  }
  // Delegate to bootstrapLocation with a row whose reference_image_url is
  // masked to null so bootstrap's idempotency check passes. insertLocation
  // is never called because getLocation returns the (masked) row.
  return bootstrapLocation(input, generateNanoBananaPro, {
    getLocation: async () => ({
      ...row,
      reference_image_url: null,
      reference_image_id: null,
    }),
    insertLocation: async () => {
      // Defensive — unreachable because the stub getLocation above returns
      // a non-null row.
      throw new Error(
        `updateLocationReference: unexpected insertLocation call for '${location_id}'`,
      );
    },
  });
}

// ── confirmReferenceUpdate ────────────────────────────────────────────────────

/**
 * Confirms the chosen canonical update by atomically writing the new
 * reference_image_url + reference_image_id on the location row. Status
 * is preserved (still 'active'). Old URL is overwritten.
 *
 * Historical reference_image_url_used values on existing stills are
 * unaffected (they live on rachel_stills, not on the location row).
 *
 * @throws if location_id is not found.
 * @throws if status is not 'active'.
 * @throws if reference_image_url is empty / not HTTPS.
 * @throws if reference_image_id is empty.
 */
export async function confirmReferenceUpdate(
  location_id: string,
  reference_image_url: string,
  reference_image_id: string,
  deps: UpdateLocationReferenceDeps = DEFAULT_DEPS,
): Promise<RachelLocation> {
  if (!reference_image_url || !reference_image_url.startsWith('https://')) {
    throw new Error(
      `confirmReferenceUpdate: reference_image_url must be a non-empty HTTPS URL (got '${reference_image_url}')`,
    );
  }
  if (!reference_image_id || reference_image_id.trim() === '') {
    throw new Error('confirmReferenceUpdate: reference_image_id must be a non-empty string');
  }
  const row = await deps.getLocation(location_id);
  if (row === null) {
    throw new Error(`confirmReferenceUpdate: location_id '${location_id}' not found`);
  }
  if (row.status !== 'active') {
    throw new Error(
      `confirmReferenceUpdate: location_id '${location_id}' is '${row.status}', expected 'active'`,
    );
  }
  return deps.updateLocationReferenceImage(location_id, reference_image_url, reference_image_id);
}
