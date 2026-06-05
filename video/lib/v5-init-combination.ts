/**
 * pickAndPersistCombination — phaseInit's combination-resolution + writeback step.
 *
 * Pulled out of render-avatar-full-v5.ts:phaseInit so the
 * combination-resolution logic is unit-testable without spawning the CLI as a
 * subprocess. phaseInit threads concrete deps (Supabase + transport calls);
 * tests thread mocks.
 *
 * Flow:
 *   1. List active looks / locations / stills + recent picks (last 7).
 *   2. Run pickCombination (pure picker).
 *   3. If pick.needs_generation === true: call generateAnchoredStill to
 *      materialize the missing combo (nano + Soul-pass-through happen inside
 *      that flow). Production deps may refuse this — see phaseInit's
 *      wireup — because the v5 Node renderer can't safely invoke
 *      Higgsfield MCP from Node; bootstrapping a missing still requires the
 *      session-side location skill.
 *   4. Resolve start_image_url from rachel_stills.soul_still_url (which, post
 *      PR-B, is a Soul-locked Rachel image).
 *   5. UPDATE content_queue.avatar_config setting look_id / location_id /
 *      still_id (preserving any other avatar_config keys).
 *   6. Post-write verify: re-SELECT avatar_config and confirm the three
 *      fields round-tripped. Required by the May 2026 "every persistent
 *      write needs a post-check" architectural principle.
 *
 * @module v5-init-combination
 */

import {
  pickCombination,
  type RachelLook,
  type RachelStill,
  type RecentLookPick,
  type RecentLocationPick,
} from './wardrobe-rotation/index.js';
import type { RachelLocation } from './location/index.js';
import type { GenerateAnchoredStillResult } from './location/types.js';

/** Last-N picks window passed to pickCombination — kept in sync with PR-A's wardrobe-rotation cooldown semantics. */
export const PICK_RECENCY_LIMIT = 7;

export interface PickAndPersistDeps {
  listActiveLooks: () => Promise<RachelLook[]>;
  listActiveLocations: () => Promise<RachelLocation[]>;
  listActiveStills: () => Promise<RachelStill[]>;
  getRecentLookPicks: (limit: number) => Promise<RecentLookPick[]>;
  getRecentLocationPicks: (limit: number) => Promise<RecentLocationPick[]>;
  /**
   * Materialize the wardrobe × location combo when no active still exists.
   * Production wireup in phaseInit refuses this — bootstrapping a still
   * requires Higgsfield MCP, which only the Claude Code session can call.
   */
  generateAnchoredStill: (look_id: string, location_id: string) => Promise<GenerateAnchoredStillResult>;
  /** UPDATE content_queue.avatar_config preserving all keys outside the patch. */
  updateAvatarConfig: (
    content_id: string,
    patch: { look_id: string; location_id: string; still_id: string },
  ) => Promise<void>;
  /** Re-SELECT avatar_config for post-write verify. */
  readAvatarConfig: (content_id: string) => Promise<{
    look_id?: string;
    location_id?: string;
    still_id?: string;
  }>;
}

export interface PickAndPersistResult {
  look_id: string;
  location_id: string;
  still_id: string;
  start_image_url: string;
}

export async function pickAndPersistCombination(
  content_id: string,
  deps: PickAndPersistDeps,
): Promise<PickAndPersistResult> {
  const [activeLooks, activeLocations, activeStills, recentLookPicks, recentLocationPicks, existing] =
    await Promise.all([
      deps.listActiveLooks(),
      deps.listActiveLocations(),
      deps.listActiveStills(),
      deps.getRecentLookPicks(PICK_RECENCY_LIMIT),
      deps.getRecentLocationPicks(PICK_RECENCY_LIMIT),
      // YAR-146: read any pre-pinned look_id/location_id from avatar_config so
      // the picker honors them and LRU-fills only the null dimension(s). The
      // post-write re-SELECT verify below is a SEPARATE read of the same field.
      deps.readAvatarConfig(content_id),
    ]);

  const pick = pickCombination({
    activeLooks,
    activeLocations,
    activeStills,
    recentLookPicks,
    recentLocationPicks,
    pinnedLookId: existing.look_id,
    pinnedLocationId: existing.location_id,
  });

  let still_id: string;
  let start_image_url: string;

  if (pick.needs_generation) {
    const generated = await deps.generateAnchoredStill(pick.look_id, pick.location_id);
    still_id = generated.still_id;
    start_image_url = generated.soul_still_url;
  } else {
    still_id = pick.still_id;
    const row = activeStills.find((s) => s.still_id === still_id);
    if (!row) {
      throw new Error(
        `pickAndPersistCombination: pickCombination returned still_id '${still_id}' but it is not in listActiveStills`,
      );
    }
    start_image_url = row.soul_still_url;
  }

  await deps.updateAvatarConfig(content_id, {
    look_id: pick.look_id,
    location_id: pick.location_id,
    still_id,
  });

  const after = await deps.readAvatarConfig(content_id);
  if (after.look_id !== pick.look_id || after.location_id !== pick.location_id || after.still_id !== still_id) {
    throw new Error(
      `pickAndPersistCombination: post-write verify failed for ${content_id}. ` +
        `Wrote look=${pick.look_id}/location=${pick.location_id}/still=${still_id}, ` +
        `read back look=${after.look_id}/location=${after.location_id}/still=${after.still_id}`,
    );
  }

  return {
    look_id: pick.look_id,
    location_id: pick.location_id,
    still_id,
    start_image_url,
  };
}
