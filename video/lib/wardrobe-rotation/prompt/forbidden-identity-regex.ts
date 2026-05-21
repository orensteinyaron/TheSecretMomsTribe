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
 * - "tan" with word boundary catches "tan complexion" without breaking
 *   "tantalizing" or "tantamount".
 */
export const FORBIDDEN_RE =
  /(skin (tone|texture)|complexion|sun-?kissed|\btan(ned)?\b|freckle|scar near|olive skin|brown eyes|hair (color|brown|wavy)|teen-?(ager)?|young (woman|adult)|female|age (3|4)\d|36-year|crow.{0,5}feet|visible pore|dark circle)/i;
