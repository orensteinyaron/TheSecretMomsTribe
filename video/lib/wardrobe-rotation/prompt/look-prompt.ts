import type { CanonLookBrief } from '../types.js';
import type { CanonLocationBrief } from '../../location/types.js';
import { FORBIDDEN_RE } from './forbidden-identity-regex.js';

export const PROMPT_TAIL =
  'vertical 9:16 portrait, no airbrushing, half-smile resting expression';

/**
 * Assembles the Soul 2.0 generation prompt from a look + location pair.
 *
 * The look contributes wardrobe + hair + accessories (styling). The location
 * contributes setting + lighting + framing. Soul 2.0 carries identity via
 * soul_id — never describe Rachel's skin, hair color, scars, or any facial
 * feature. The FORBIDDEN_RE safety net catches obvious mistakes; if it fires,
 * the prompt is rejected before the Higgsfield call.
 *
 * @throws if `look` or `location` contain forbidden identity descriptors.
 */
export function assembleLookPrompt(
  look: CanonLookBrief,
  location: CanonLocationBrief,
): string {
  const lookPart = [look.wardrobe, look.hair, look.accessories]
    .filter((s): s is string => Boolean(s))
    .join(', ');
  const locationPart = `${location.setting}, ${location.lighting}, ${location.framing}`;
  const combined = `${lookPart} | ${locationPart}`;

  const match = FORBIDDEN_RE.exec(combined);
  if (match) {
    throw new Error(
      `assembleLookPrompt: forbidden identity term "${match[0]}" detected in prompt. ` +
        'Soul carries identity via soul_id — never describe Rachel\'s skin, hair color, scars, etc.',
    );
  }

  return `${combined}, ${PROMPT_TAIL}`;
}
