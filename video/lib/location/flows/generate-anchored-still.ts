/**
 * generateAnchoredStill — render-time wardrobe-swap flow for a specific
 * (look, location) combination via Higgsfield nano_banana_pro, anchored on
 * the location's locked canonical (reference_image_url) supplied as the
 * `medias` reference.
 *
 * Mirrors the PR-A revision `generateStill` shape (auto-approve the FIRST
 * returned candidate, retire the rest, defensive active-still guard) but
 * uses nano_banana_pro + medias instead of Soul 2.0 + soul_id. The
 * canonical URL is snapshotted into each inserted still's
 * `reference_image_url_used` audit column at generation time so the
 * provenance survives any later `updateLocationReference` rotation.
 *
 * Caveat: NOT a real DB transaction. Partial inserts may remain on later
 * failure — same risk model as the PR-A flow.
 *
 * @module flows/generate-anchored-still
 */

import type { RachelStill } from '../../wardrobe-rotation/types.js';
import { assembleAnchoredStillPrompt } from '../prompt/anchored-still-prompt.js';
import { getLocation } from '../db.js';
import {
  getLook, insertStill, updateStillStatus, listStills,
} from '../../wardrobe-rotation/db.js';
import { ANCHORED_STILL_CANDIDATES, type NanoBananaProFn } from './constants.js';

// ── Result + DI deps ──────────────────────────────────────────────────────────

export interface GenerateAnchoredStillResult {
  still_id: string;
  soul_still_id: string;
  soul_still_url: string;
  reference_image_url_used: string;
  retired_still_ids: string[];
}

/**
 * DB dependencies for generateAnchoredStill. Defaults to the real
 * Supabase-backed implementations; tests inject stubs to avoid touching
 * Supabase. Look + still helpers stay in wardrobe-rotation/db.ts (PR-A
 * turf); location helper comes from location/db.ts.
 */
export interface GenerateAnchoredStillDeps {
  getLook: typeof getLook;
  getLocation: typeof getLocation;
  insertStill: typeof insertStill;
  updateStillStatus: typeof updateStillStatus;
  listStills: typeof listStills;
}

const DEFAULT_DEPS: GenerateAnchoredStillDeps = {
  getLook,
  getLocation,
  insertStill,
  updateStillStatus,
  listStills,
};

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Render-time on-demand: generate wardrobe-swap stills for a specific
 * (look, location) combination using nano_banana_pro with the location's
 * locked canonical (reference_image_url) as the medias anchor.
 *
 * Mirrors PR-A revision generateStill (auto-approve first, retire rest)
 * but uses nano_banana_pro + medias instead of soul_2 + soul_id.
 *
 * The snapshot of location.reference_image_url is written to each
 * inserted still's reference_image_url_used column at insertion time —
 * this provides the audit trail for the update-location-reference flow
 * which may regenerate the canonical (changing reference_image_url on
 * the location row, but never the historical reference_image_url_used
 * column on already-generated stills).
 *
 * Caveat: NOT a real DB transaction. Partial inserts may remain on later
 * failure.
 *
 * @throws if either parent is missing or not active.
 * @throws if the location has no reference_image_url (bootstrap incomplete).
 * @throws if an active still already exists for the (look, location) combo.
 * @throws if the transport returns the wrong number of candidates.
 */
export async function generateAnchoredStill(
  look_id: string,
  location_id: string,
  generateNanoBananaPro: NanoBananaProFn,
  deps: GenerateAnchoredStillDeps = DEFAULT_DEPS,
): Promise<GenerateAnchoredStillResult> {
  // 1. Validate look exists + active.
  const look = await deps.getLook(look_id);
  if (look === null) {
    throw new Error(`generateAnchoredStill: look_id '${look_id}' not found`);
  }
  if (look.status !== 'active') {
    throw new Error(
      `generateAnchoredStill: look_id '${look_id}' is '${look.status}', expected 'active'`,
    );
  }

  // 2. Validate location exists + active.
  const location = await deps.getLocation(location_id);
  if (location === null) {
    throw new Error(`generateAnchoredStill: location_id '${location_id}' not found`);
  }
  if (location.status !== 'active') {
    throw new Error(
      `generateAnchoredStill: location_id '${location_id}' is '${location.status}', expected 'active'`,
    );
  }

  // 3. Validate location has reference_image_url set (bootstrap complete).
  if (!location.reference_image_url) {
    throw new Error(
      `generateAnchoredStill: location_id '${location_id}' has no reference_image_url. ` +
        `Run bootstrapLocation first, then approveLocation with the chosen candidate URL.`,
    );
  }
  const referenceUrl = location.reference_image_url;

  // 4. Defensive: refuse if an active still already exists for this combo.
  const existingActives = await deps.listStills({
    look_id, location_id, status: 'active',
  });
  if (existingActives.length > 0) {
    throw new Error(
      `generateAnchoredStill: an active still already exists for (${look_id}, ${location_id}). ` +
        `Retire it first if you want to regenerate.`,
    );
  }

  // 5. Assemble the anchored-still prompt (SHORT — wardrobe only).
  const prompt = assembleAnchoredStillPrompt(look);

  // 6. Generate N candidates via nano_banana_pro + medias anchor.
  const candidates = await generateNanoBananaPro({
    prompt,
    count: ANCHORED_STILL_CANDIDATES,
    aspect_ratio: '9:16',
    resolution: '2k',
    medias: [{ value: referenceUrl, role: 'image' }],
  });
  if (candidates.length !== ANCHORED_STILL_CANDIDATES) {
    throw new Error(
      `generateAnchoredStill: expected ${ANCHORED_STILL_CANDIDATES} candidates, got ${candidates.length}`,
    );
  }

  // 7. Insert all 3 as pending with reference_image_url_used snapshot.
  const insertedStills: RachelStill[] = [];
  for (const cand of candidates) {
    const inserted = await deps.insertStill({
      look_id, location_id,
      soul_still_id: cand.job_id,
      soul_still_url: cand.url,
      reference_image_url_used: referenceUrl,
      status: 'pending',
      created_by: 'skill_v1',
    });
    insertedStills.push(inserted);
  }

  // 8. Auto-approve the first; retire the other two.
  const [first, ...rest] = insertedStills;
  const approved = await deps.updateStillStatus(first.still_id, 'active');
  const retiredIds: string[] = [];
  for (const r of rest) {
    await deps.updateStillStatus(r.still_id, 'retired');
    retiredIds.push(r.still_id);
  }

  return {
    still_id: approved.still_id,
    soul_still_id: approved.soul_still_id,
    soul_still_url: approved.soul_still_url,
    reference_image_url_used: referenceUrl,
    retired_still_ids: retiredIds,
  };
}
