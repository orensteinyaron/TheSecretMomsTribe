/**
 * createNewLook — generate N Higgsfield Soul 2.0 candidate stills for Rachel
 * and insert each as `pending` in `rachel_looks`.
 *
 * Transport: B (dependency injection)
 * Reason: no HIGGSFIELD_API_KEY or fetch-based Higgsfield client exists in the
 * repo. The function accepts a `generateImages` callback so it stays pure
 * TypeScript and is invokable by a Claude SKILL that assembles the callback
 * via the `mcp__78d93fcf-...__generate_image` MCP tool. See SKILL.md (Task 9).
 */

import type { CreateLookInput, CreateLookResult } from './types.js';
import { generateNextLookId, insertLook } from './db.js';
import { assembleLookPrompt } from './look-prompt.js';

export { assembleLookPrompt } from './look-prompt.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Higgsfield Soul 2.0 character ID for Rachel. */
export const RACHEL_SOUL_ID = '34a349a6-d6d9-423f-8c80-e4b4c8d6e770';

// ── Transport B interface ─────────────────────────────────────────────────────

/** One still returned by the image-generation backend. */
export interface GeneratedStill {
  soul_still_id: string;
  soul_still_url: string;
}

/**
 * Dependency-injected image-generation callback.
 *
 * In production this is assembled by the Claude SKILL using the
 * `mcp__78d93fcf-...__generate_image` + `mcp__78d93fcf-...__job_display`
 * MCP tools (async job pattern). In tests it is a simple stub.
 */
export type GenerateImagesFn = (input: {
  prompt: string;
  soul_id: string;
  count: number;
  aspect_ratio: '9:16';
  quality: '2k';
}) => Promise<GeneratedStill[]>;

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Generates `variation_count` Soul 2.0 candidate stills for Rachel and inserts
 * each as a `pending` look in `rachel_looks`.
 *
 * Look IDs are generated sequentially (not in parallel) so each DB query sees
 * the previous insert and the IDs are monotonically increasing.
 *
 * @param input          — wardrobe descriptor, setting, optional notes + count
 * @param generateImages — image-generation callback (Transport B, DI)
 */
export async function createNewLook(
  input: CreateLookInput,
  generateImages: GenerateImagesFn,
): Promise<CreateLookResult> {
  // 1. Validate + clamp variation_count to Higgsfield's count range [1, 4].
  const rawCount = input.variation_count ?? 3;
  const variation_count = Math.max(1, Math.min(4, rawCount));

  // 2. Assemble prompt (throws on forbidden identity terms).
  const prompt = assembleLookPrompt(input.wardrobe, input.setting);

  // 3. Call image-generation backend.
  const stills = await generateImages({
    prompt,
    soul_id: RACHEL_SOUL_ID,
    count: variation_count,
    aspect_ratio: '9:16',
    quality: '2k',
  });

  // 4. Insert each still sequentially so look_ids are monotonically increasing.
  const candidates: CreateLookResult['candidates'] = [];
  const candidate_look_ids: string[] = [];

  for (const still of stills) {
    const look_id = await generateNextLookId();

    await insertLook({
      look_id,
      soul_still_id: still.soul_still_id,
      soul_still_url: still.soul_still_url,
      wardrobe: input.wardrobe,
      setting: input.setting,
      notes: input.notes ?? null,
      status: 'pending',
      created_by: 'skill_v1',
      source: 'skill_v1',
    });

    candidate_look_ids.push(look_id);
    candidates.push({ look_id, soul_still_id: still.soul_still_id, soul_still_url: still.soul_still_url });
  }

  // 5. Return summary.
  return { candidate_look_ids, candidates };
}
