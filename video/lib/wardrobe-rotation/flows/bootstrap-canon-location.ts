/**
 * bootstrapCanonLocation — add a new canon-locked location slot to the active pool.
 *
 * Mirror of bootstrapCanonLook, but for the location axis. Human entry point:
 * call this when Yaron wants to introduce a new location from the canon brief
 * dict (locations 1-2 currently defined). Generates 6 candidate stills for
 * human review using look_01 (cream knit sweater) as the neutral reference look.
 * Yaron then calls approveStill(chosen_still_id) and the bootstrap-aware
 * approve-still flow auto-promotes the parent location and auto-retires the
 * 5 sibling candidates.
 *
 * Ordering invariant (failure recovery):
 *   1. assembleLookPrompt  — throws on FORBIDDEN_RE before any write; no DB side-effects.
 *   2. insertLocation      — parent record written as 'pending'.
 *   3. generateImages ×2   — Higgsfield calls. If either fails, parent location is
 *                            left 'pending' with 0-3 stills. Acceptable per spec.
 *                            Yaron can manually delete the orphaned pending location
 *                            and retry. No auto-cleanup to keep failure surface small.
 *   4. insertStill ×6      — stills written as 'pending', bound to parent location.
 *
 * Transport: DI — callers pass a `generateImages` callback assembled via the
 * `mcp__78d93fcf-...__generate_image` MCP tool from within the wardrobe-rotation
 * SKILL. Higgsfield count max is 4, so 6 candidates require 2 sequential calls.
 *
 * @module flows/bootstrap-canon-location
 */

import type { CanonLookBrief, CanonLocationBrief, RachelStill } from '../types.js';
import { CANON_LOCATIONS, CANON_LOCATION_NUMBERS_DEFINED } from '../canon/canon-locations.js';
import { assembleLookPrompt } from '../prompt/look-prompt.js';
import {
  getLook,
  getLocation,
  insertLocation,
  insertStill,
  listActiveLooks,
} from '../db.js';
import type {
  BootstrapResult,
  GenerateImagesFn,
  GeneratedImage,
  GenerateImagesInput,
} from './bootstrap-canon-look.js';
import { RACHEL_SOUL_ID, TOTAL_BOOTSTRAP_CANDIDATES } from './bootstrap-canon-look.js';

// Re-export DI types and constants so callers can import from either module.
export type { BootstrapResult, GenerateImagesFn, GeneratedImage, GenerateImagesInput };
export { RACHEL_SOUL_ID, TOTAL_BOOTSTRAP_CANDIDATES };

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Preferred neutral reference look for location bootstraps.
 * look_01 (cream knit) is the most-established, best-known look — ideal for
 * evaluating a new location without confounding look novelty.
 */
export const NEUTRAL_LOOK_FOR_LOCATION_BOOTSTRAP = 'look_01';

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap a new canon location slot.
 *
 * @param location_number - Numeric slot (e.g. 2 for location_02). Must be in
 *   CANON_LOCATION_NUMBERS_DEFINED. Throws if not found.
 * @param generateImages - DI transport for Higgsfield Soul 2.0 image generation.
 *   Called twice: once with count=4, once with count=2, for 6 total candidates.
 * @returns Metadata about the inserted parent location + 6 candidate stills.
 * @throws if location_number is not in the defined canon set.
 * @throws if location_id already exists in rachel_locations (idempotency guard).
 * @throws if no active look is available to serve as neutral reference.
 * @throws if assembleLookPrompt detects a forbidden identity term.
 */
export async function bootstrapCanonLocation(
  location_number: number,
  generateImages: GenerateImagesFn,
): Promise<BootstrapResult> {
  // 1. Validate canon slot.
  if (!(CANON_LOCATION_NUMBERS_DEFINED as readonly number[]).includes(location_number)) {
    throw new Error(
      `bootstrapCanonLocation: location_number ${location_number} is not defined in canon. ` +
        `Defined slots: ${[...CANON_LOCATION_NUMBERS_DEFINED].join(', ')}.`,
    );
  }

  const location_id = `location_${String(location_number).padStart(2, '0')}`;
  const canonBrief: CanonLocationBrief | undefined = CANON_LOCATIONS[location_id];
  if (!canonBrief) {
    // Defensive — should be unreachable if CANON_LOCATION_NUMBERS_DEFINED is in sync with CANON_LOCATIONS.
    throw new Error(`bootstrapCanonLocation: missing canon brief for ${location_id}`);
  }

  // 2. Idempotency check — refuse if location_id already exists.
  const existing = await getLocation(location_id);
  if (existing) {
    throw new Error(
      `bootstrapCanonLocation: location_id '${location_id}' already exists (status='${existing.status}'). ` +
        `Use the existing record or retire it first.`,
    );
  }

  // 3. Resolve neutral reference look.
  //    Prefer look_01 (cream knit sweater) if active; else first active look.
  const preferredLook = await getLook(NEUTRAL_LOOK_FOR_LOCATION_BOOTSTRAP);
  let referenceLookBrief: CanonLookBrief;
  let referenceLookId: string;

  if (preferredLook && preferredLook.status === 'active') {
    referenceLookId = NEUTRAL_LOOK_FOR_LOCATION_BOOTSTRAP;
    referenceLookBrief = {
      wardrobe: preferredLook.wardrobe,
      hair: preferredLook.hair,
      accessories: preferredLook.accessories,
      best_for: '',
    };
  } else {
    // Fallback: first active look.
    const actives = await listActiveLooks();
    const firstActive = actives[0];
    if (!firstActive) {
      throw new Error(
        'bootstrapCanonLocation: no active look available for reference. ' +
          'Bootstrap look_01 first via bootstrapCanonLook(1) or apply the canon seed.',
      );
    }
    referenceLookId = firstActive.look_id;
    referenceLookBrief = {
      wardrobe: firstActive.wardrobe,
      hair: firstActive.hair,
      accessories: firstActive.accessories,
      best_for: '',
    };
  }

  // 4. Assemble prompt. Throws if FORBIDDEN_RE detects identity leak.
  //    Assembly is BEFORE insertLocation so a bad brief causes zero DB side-effects.
  const prompt = assembleLookPrompt(referenceLookBrief, canonBrief);

  // 5. Insert parent location as pending.
  await insertLocation({
    location_id,
    setting: canonBrief.setting,
    lighting: canonBrief.lighting,
    framing: canonBrief.framing,
    tier: canonBrief.tier,
    notes: `Canon Location #${location_number}. Best for: ${canonBrief.best_for}`,
    status: 'pending',
    created_by: 'skill_v1',
    source: 'canon_seed',
  });

  // 6. Generate 6 candidates via 2 sequential Higgsfield calls (count=4 + count=2).
  //    If either call fails, parent location is left as 'pending' with 0-N stills.
  //    This is acceptable per spec — cleanup is manual.
  const batch1 = await generateImages({
    prompt,
    soul_id: RACHEL_SOUL_ID,
    count: 4,
    aspect_ratio: '9:16',
    quality: '2k',
  });
  const batch2 = await generateImages({
    prompt,
    soul_id: RACHEL_SOUL_ID,
    count: 2,
    aspect_ratio: '9:16',
    quality: '2k',
  });
  const allCandidates = [...batch1, ...batch2];

  if (allCandidates.length !== TOTAL_BOOTSTRAP_CANDIDATES) {
    throw new Error(
      `bootstrapCanonLocation: expected ${TOTAL_BOOTSTRAP_CANDIDATES} candidates, ` +
        `got ${allCandidates.length}`,
    );
  }

  // 7. Insert each candidate as a pending still bound to (reference_look_id, location_id).
  const insertedStills: RachelStill[] = [];
  for (const cand of allCandidates) {
    const inserted = await insertStill({
      look_id: referenceLookId,
      location_id,
      soul_still_id: cand.soul_still_id,
      soul_still_url: cand.soul_still_url,
      status: 'pending',
      created_by: 'skill_v1',
    });
    insertedStills.push(inserted);
  }

  return {
    parent_id: location_id,
    reference_id: referenceLookId,
    candidate_still_ids: insertedStills.map(s => s.still_id),
    candidates: insertedStills.map(s => ({
      still_id: s.still_id,
      soul_still_id: s.soul_still_id,
      soul_still_url: s.soul_still_url,
    })),
  };
}
