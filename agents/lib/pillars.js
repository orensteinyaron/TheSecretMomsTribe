/**
 * Single source of truth for content_queue.content_pillar values.
 *
 * The V1.1 canonical names MUST match the DB check constraint
 * `content_queue_pillar_taxonomy` installed by migration
 * 20260418171805_enforce_pillar_taxonomy_v11:
 *
 *   CHECK (content_pillar = ANY (ARRAY[
 *     'parenting', 'health', 'ai_magic', 'tech',
 *     'trending', 'financial', 'uncategorized'
 *   ]))
 *
 * Every agent prompt, validator, and hashtag lookup imports from
 * here instead of hard-coding strings, so the next migration that
 * touches the taxonomy only has to update one file and the
 * schema-contract test catches drift automatically.
 *
 * `normalizePillar` is a defensive safety net: if the LLM emits a
 * legacy V1.0 long name (parenting_insights, mom_health, ...) we
 * remap it to V1.1 and let the caller log a `pillar_remapped_legacy`
 * activity event. Keep the net in place until we're confident
 * prompts + briefings are fully migrated; removing it prematurely
 * puts the pipeline back at risk of 23514 rollbacks.
 */

export const VALID_PILLARS = Object.freeze([
  'parenting',
  'health',
  'ai_magic',
  'tech',
  'trending',
  'financial',
  'uncategorized',
]);

/**
 * Old V1.0 long names → V1.1 canonical short names. Only the
 * renamed pillars appear; V1.0 names that survived verbatim
 * (ai_magic, trending) are passthrough and don't need mapping.
 */
export const LEGACY_TO_V11 = Object.freeze({
  parenting_insights: 'parenting',
  mom_health: 'health',
  tech_for_moms: 'tech',
  trending_culture: 'trending',
});

/**
 * Normalize any pillar-ish string to V1.1 canonical.
 *
 * @param {unknown} input
 * @returns {{pillar: string, remapped: boolean, legacy_value: string|null}}
 */
export function normalizePillar(input) {
  if (typeof input !== 'string' || input.length === 0) {
    return { pillar: 'uncategorized', remapped: true, legacy_value: input == null ? null : String(input) };
  }
  if (VALID_PILLARS.includes(input)) {
    return { pillar: input, remapped: false, legacy_value: null };
  }
  if (LEGACY_TO_V11[input]) {
    return { pillar: LEGACY_TO_V11[input], remapped: true, legacy_value: input };
  }
  return { pillar: 'uncategorized', remapped: true, legacy_value: input };
}
