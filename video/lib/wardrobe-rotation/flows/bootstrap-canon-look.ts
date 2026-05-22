/**
 * bootstrapCanonLook — add a new canon-locked look slot to the active pool.
 *
 * Human entry point: call this when Yaron wants to introduce a new look from
 * the canon brief dict (looks 1-5 currently defined). Generates 6 candidate
 * stills for human review. Yaron then calls approveStill(chosen_still_id) and
 * the bootstrap-aware approve-still flow auto-promotes the parent look and
 * auto-retires the 5 sibling candidates.
 *
 * Ordering invariant (failure recovery):
 *   1. assembleLookPrompt — throws on FORBIDDEN_RE before any write; no DB side-effects.
 *   2. insertLook         — parent record written as 'pending'.
 *   3. generateImages ×2  — Higgsfield calls. If either fails, parent look is
 *                           left 'pending' with 0-3 stills. Acceptable per spec.
 *                           Yaron can manually delete the orphaned pending look
 *                           and retry. No auto-cleanup to keep failure surface small.
 *   4. insertStill ×6     — stills written as 'pending', bound to parent look.
 *
 * Transport: DI — callers pass a `generateImages` callback assembled via the
 * `mcp__78d93fcf-...__generate_image` MCP tool from within the wardrobe-rotation
 * SKILL. Higgsfield count max is 4, so 6 candidates require 2 sequential calls.
 *
 * @module flows/bootstrap-canon-look
 */

import type { CanonLookBrief, RachelStill } from '../types.js';
import type { CanonLocationBrief } from '../../location/types.js';
import { CANON_LOOKS, CANON_LOOK_NUMBERS_DEFINED } from '../canon/canon-looks.js';
import { assembleLookPrompt } from '../prompt/look-prompt.js';
import { getLook, insertLook, insertStill } from '../db.js';
import { getLocation, listActiveLocations } from '../../location/db.js';

// ── DI transport types ────────────────────────────────────────────────────────

export interface GenerateImagesInput {
  prompt: string;
  soul_id: string;
  count: number;   // 1-4 (Higgsfield max per call)
  aspect_ratio: '9:16';
  quality: '2k';
}

export interface GeneratedImage {
  soul_still_id: string;
  soul_still_url: string;
}

export type GenerateImagesFn = (input: GenerateImagesInput) => Promise<GeneratedImage[]>;

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Higgsfield Soul 2.0 character ID for Rachel (the Face of SMT).
 * Exported for callers constructing the DI callback.
 */
export const RACHEL_SOUL_ID = '34a349a6-d6d9-423f-8c80-e4b4c8d6e770';

/** Total candidates generated per bootstrap (2 calls: count=4 + count=2). */
export const TOTAL_BOOTSTRAP_CANDIDATES = 6;

/**
 * Preferred neutral reference location for look bootstraps.
 * Kitchen is the best-known, most photographed location — ideal for evaluating
 * a new look in isolation from location novelty.
 */
export const NEUTRAL_LOCATION_FOR_LOOK_BOOTSTRAP = 'location_01';

// ── Return type ───────────────────────────────────────────────────────────────

export interface BootstrapResult {
  /** The inserted parent id, e.g. 'look_02'. */
  parent_id: string;
  /** The neutral other-axis id used as reference, e.g. 'location_01'. */
  reference_id: string;
  /** still_ids of all 6 inserted candidates (in insertion order). */
  candidate_still_ids: string[];
  candidates: Array<{
    still_id: string;
    soul_still_id: string;
    soul_still_url: string;
  }>;
}

// ── Main flow ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap a new canon look slot.
 *
 * @param look_number - Numeric slot (e.g. 2 for look_02). Must be in
 *   CANON_LOOK_NUMBERS_DEFINED. Throws if not found.
 * @param generateImages - DI transport for Higgsfield Soul 2.0 image generation.
 *   Called twice: once with count=4, once with count=2, for 6 total candidates.
 * @returns Metadata about the inserted parent look + 6 candidate stills.
 * @throws if look_number is not in the defined canon set.
 * @throws if look_id already exists in rachel_looks (idempotency guard).
 * @throws if no active location is available to serve as neutral reference.
 * @throws if assembleLookPrompt detects a forbidden identity term.
 */
export async function bootstrapCanonLook(
  look_number: number,
  generateImages: GenerateImagesFn,
): Promise<BootstrapResult> {
  // 1. Validate canon slot.
  if (!(CANON_LOOK_NUMBERS_DEFINED as readonly number[]).includes(look_number)) {
    throw new Error(
      `bootstrapCanonLook: look_number ${look_number} is not defined in canon. ` +
        `Defined slots: ${[...CANON_LOOK_NUMBERS_DEFINED].join(', ')}.`,
    );
  }

  const look_id = `look_${String(look_number).padStart(2, '0')}`;
  const canonBrief: CanonLookBrief | undefined = CANON_LOOKS[look_id];
  if (!canonBrief) {
    // Defensive — should be unreachable if CANON_LOOK_NUMBERS_DEFINED is in sync with CANON_LOOKS.
    throw new Error(`bootstrapCanonLook: missing canon brief for ${look_id}`);
  }

  // 2. Idempotency check — refuse if look_id already exists.
  const existing = await getLook(look_id);
  if (existing) {
    throw new Error(
      `bootstrapCanonLook: look_id '${look_id}' already exists (status='${existing.status}'). ` +
        `Use the existing record or retire it first.`,
    );
  }

  // 3. Resolve neutral reference location.
  //    Prefer location_01 (kitchen) if active; else first active primary.
  const preferredLocation = await getLocation(NEUTRAL_LOCATION_FOR_LOOK_BOOTSTRAP);
  let referenceLocationBrief: CanonLocationBrief;
  let referenceLocationId: string;

  if (preferredLocation && preferredLocation.status === 'active') {
    referenceLocationId = NEUTRAL_LOCATION_FOR_LOOK_BOOTSTRAP;
    referenceLocationBrief = {
      tier: preferredLocation.tier,
      setting: preferredLocation.setting,
      lighting: preferredLocation.lighting,
      framing: preferredLocation.framing,
      best_for: '',
    };
  } else {
    // Fallback: first active primary location.
    const actives = await listActiveLocations();
    const firstPrimary = actives.find(l => l.tier === 'primary');
    if (!firstPrimary) {
      throw new Error(
        'bootstrapCanonLook: no active primary location available for reference. ' +
          'Bootstrap location_01 first via bootstrapCanonLocation(1) or apply the canon seed.',
      );
    }
    referenceLocationId = firstPrimary.location_id;
    referenceLocationBrief = {
      tier: firstPrimary.tier,
      setting: firstPrimary.setting,
      lighting: firstPrimary.lighting,
      framing: firstPrimary.framing,
      best_for: '',
    };
  }

  // 4. Assemble prompt. Throws if FORBIDDEN_RE detects identity leak.
  //    Assembly is BEFORE insertLook so a bad brief causes zero DB side-effects.
  const prompt = assembleLookPrompt(canonBrief, referenceLocationBrief);

  // 5. Insert parent look as pending.
  await insertLook({
    look_id,
    wardrobe: canonBrief.wardrobe,
    hair: canonBrief.hair,
    accessories: canonBrief.accessories,
    notes: `Canon Look #${look_number}. Best for: ${canonBrief.best_for}`,
    status: 'pending',
    created_by: 'skill_v1',
    source: 'canon_seed',
  });

  // 6. Generate 6 candidates via 2 sequential Higgsfield calls (count=4 + count=2).
  //    If either call fails, parent look is left as 'pending' with 0-N stills.
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
      `bootstrapCanonLook: expected ${TOTAL_BOOTSTRAP_CANDIDATES} candidates, ` +
        `got ${allCandidates.length}`,
    );
  }

  // 7. Insert each candidate as a pending still bound to (look_id, reference_location_id).
  const insertedStills: RachelStill[] = [];
  for (const cand of allCandidates) {
    const inserted = await insertStill({
      look_id,
      location_id: referenceLocationId,
      soul_still_id: cand.soul_still_id,
      soul_still_url: cand.soul_still_url,
      status: 'pending',
      created_by: 'skill_v1',
    });
    insertedStills.push(inserted);
  }

  return {
    parent_id: look_id,
    reference_id: referenceLocationId,
    candidate_still_ids: insertedStills.map(s => s.still_id),
    candidates: insertedStills.map(s => ({
      still_id: s.still_id,
      soul_still_id: s.soul_still_id,
      soul_still_url: s.soul_still_url,
    })),
  };
}
