/**
 * Pure helper for assembling the Soul 2.0 look-generation prompt.
 *
 * Extracted from create-new-look.ts so it can be imported by tests without
 * pulling in the Supabase DB layer (which exits at module scope on missing env).
 */

/** Canon tail appended to every look prompt. */
export const PROMPT_TAIL =
  'warm natural light, half-smile resting expression, vertical 9:16 portrait, no airbrushing';

/**
 * Forbidden identity-descriptor patterns.
 *
 * Soul carries identity via soul_id; injecting skin/hair/age/feature
 * descriptors into the prompt causes hallucination. This regex catches
 * obvious mistakes that should never appear in a wardrobe+setting prompt.
 *
 * Scope notes:
 * - "olive" alone is fine (olive linen fabric); "olive skin" is flagged.
 * - "hair" alone is fine (hair accessory); "hair color/brown/wavy" is flagged.
 */
export const FORBIDDEN_RE =
  /(skin (tone|texture)|complexion|sun-?kissed|\btan(ned)?\b|freckle|scar near|olive skin|brown eyes|hair (color|brown|wavy)|teen-?(ager)?|young (woman|adult)|female|age (3|4)\d|36-year|crow.{0,5}feet|visible pore|dark circle)/i;

/**
 * Assembles the Soul 2.0 generation prompt from wardrobe + setting.
 *
 * @throws if `wardrobe` or `setting` contain forbidden identity descriptors.
 */
export function assembleLookPrompt(wardrobe: string, setting: string): string {
  const combined = `${wardrobe}, ${setting}`;

  const match = FORBIDDEN_RE.exec(combined);
  if (match) {
    throw new Error(
      `assembleLookPrompt: forbidden identity term detected — "${match[0]}" in "${combined}". ` +
        'Do not include skin, hair, age, or facial-feature descriptors in wardrobe/setting prompts. ' +
        'Soul carries identity via soul_id.',
    );
  }

  return `${combined}, ${PROMPT_TAIL}`;
}
