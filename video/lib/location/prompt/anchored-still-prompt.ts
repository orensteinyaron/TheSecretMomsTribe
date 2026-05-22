import type { RachelLook } from '../../wardrobe-rotation/types.js';
import { FORBIDDEN_RE } from '../../wardrobe-rotation/prompt/forbidden-identity-regex.js';

/**
 * Assembles the wardrobe-swap prompt for nano_banana_pro.
 *
 * The canonical (passed separately via medias[]) provides the location AND
 * Rachel's identity AND the pose AND the framing. This prompt only names
 * the wardrobe to swap to.
 *
 * SHORT prompt by design — long prompts confuse the model and risk drift.
 * Validated in Smoke 0d Stage B: this minimal prompt reliably preserves
 * the canonical's location + identity while swapping wardrobe.
 *
 * Forbidden-identity check is applied to the DYNAMIC look fields only
 * (wardrobe + hair + accessories). The static baseline identity descriptor
 * ("olive skin, dark wavy hair") in the template is intentional and
 * whitelisted by being outside the dynamic input.
 *
 * @throws if any dynamic look field contains a forbidden identity descriptor.
 */
export function assembleAnchoredStillPrompt(look: RachelLook): string {
  // Forbidden-identity check on DYNAMIC INPUT FIELDS only.
  const dynamicJoined = [look.wardrobe, look.hair, look.accessories ?? '']
    .filter((s) => s && s.length > 0)
    .join(' | ');

  const match = FORBIDDEN_RE.exec(dynamicJoined);
  if (match) {
    throw new Error(
      `assembleAnchoredStillPrompt: forbidden identity term "${match[0]}" detected in look fields. ` +
        "Never describe Rachel's skin texture, freckles, scars, or other features beyond the baseline identity descriptors.",
    );
  }

  const accessoriesClause = look.accessories ? `, ${look.accessories}` : '';

  const prompt = [
    `Rachel (mid-30s woman, olive skin, dark wavy hair, wearing ${look.wardrobe}, ${look.hair}${accessoriesClause}) standing in THIS EXACT location from the reference image, same position and framing.`,
    '',
    `The ONLY difference: Rachel is wearing ${look.wardrobe} instead of the wardrobe in the reference. Location, framing, lighting, and composition must EXACTLY match the reference.`,
    '',
    'Rachel covers ~60% width and ~60-70% height of the frame. Surface band at the bottom, no near edge visible. No ceiling, no pendant lamps visible.',
    '',
    'Photorealistic.',
  ].join('\n');

  return prompt;
}
