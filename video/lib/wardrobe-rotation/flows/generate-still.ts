import type { RachelStill, CanonLookBrief, CanonLocationBrief } from '../types.js';
import { assembleLookPrompt } from '../prompt/look-prompt.js';
import {
  getLook, getLocation, insertStill, updateStillStatus, listStills,
} from '../db.js';
import {
  RACHEL_SOUL_ID,
  type GenerateImagesFn,
} from './bootstrap-canon-look.js';

export const ON_DEMAND_STILL_CANDIDATES = 3;

export interface GenerateStillResult {
  still_id: string;
  soul_still_id: string;
  soul_still_url: string;
  retired_still_ids: string[];
}

/**
 * Render-time on-demand: generate Soul stills for a specific (look, location)
 * combination and auto-approve the first candidate.
 *
 * Used by the orchestrator's render init phase when pickCombination returns
 * needs_generation: true for a combination that has no active still yet.
 *
 * Unlike bootstrap (which gates on human review), this flow auto-approves
 * the FIRST returned candidate and retires the other 2. The "first" is by
 * Higgsfield response order (no quality scoring — that's PR-B).
 *
 * Caveat: NOT a real DB transaction. If a later step fails, partial inserts
 * may remain. Same risk model as approveStill bootstrap path.
 */
export async function generateStill(
  look_id: string,
  location_id: string,
  generateImages: GenerateImagesFn,
): Promise<GenerateStillResult> {
  // Validate parents exist + are active.
  const look = await getLook(look_id);
  if (look === null) throw new Error(`generateStill: look_id '${look_id}' not found`);
  if (look.status !== 'active') {
    throw new Error(
      `generateStill: look_id '${look_id}' is '${look.status}', expected 'active'`,
    );
  }
  const location = await getLocation(location_id);
  if (location === null) throw new Error(`generateStill: location_id '${location_id}' not found`);
  if (location.status !== 'active') {
    throw new Error(
      `generateStill: location_id '${location_id}' is '${location.status}', expected 'active'`,
    );
  }

  // Refuse if an active still ALREADY exists for this combo (the picker
  // shouldn't have asked us to generate one in that case — defensive).
  const existingActives = await listStills({
    look_id, location_id, status: 'active',
  });
  if (existingActives.length > 0) {
    throw new Error(
      `generateStill: an active still already exists for (${look_id}, ${location_id}). ` +
        `Retire it first if you want to regenerate.`,
    );
  }

  // Assemble prompt from canon-like briefs derived from the DB rows.
  // (We don't re-read CANON_LOOKS/CANON_LOCATIONS — the DB is source of truth
  // for what's active.)
  const lookBrief: CanonLookBrief = {
    wardrobe: look.wardrobe,
    hair: look.hair,
    accessories: look.accessories,
    best_for: '',
  };
  const locationBrief: CanonLocationBrief = {
    tier: location.tier,
    setting: location.setting,
    lighting: location.lighting,
    framing: location.framing,
    best_for: '',
  };
  const prompt = assembleLookPrompt(lookBrief, locationBrief);

  // Generate N candidates (single call, count=3, well under the 4-max).
  const candidates = await generateImages({
    prompt,
    soul_id: RACHEL_SOUL_ID,
    count: ON_DEMAND_STILL_CANDIDATES,
    aspect_ratio: '9:16',
    quality: '2k',
  });

  if (candidates.length !== ON_DEMAND_STILL_CANDIDATES) {
    throw new Error(
      `generateStill: expected ${ON_DEMAND_STILL_CANDIDATES} candidates, got ${candidates.length}`,
    );
  }

  // Insert all as pending.
  const insertedStills: RachelStill[] = [];
  for (const cand of candidates) {
    const inserted = await insertStill({
      look_id, location_id,
      soul_still_id: cand.soul_still_id,
      soul_still_url: cand.soul_still_url,
      status: 'pending',
      created_by: 'skill_v1',
    });
    insertedStills.push(inserted);
  }

  // Auto-approve the first; retire the rest.
  const [first, ...rest] = insertedStills;
  const approved = await updateStillStatus(first.still_id, 'active');
  const retiredIds: string[] = [];
  for (const r of rest) {
    await updateStillStatus(r.still_id, 'retired');
    retiredIds.push(r.still_id);
  }

  return {
    still_id: approved.still_id,
    soul_still_id: approved.soul_still_id,
    soul_still_url: approved.soul_still_url,
    retired_still_ids: retiredIds,
  };
}
