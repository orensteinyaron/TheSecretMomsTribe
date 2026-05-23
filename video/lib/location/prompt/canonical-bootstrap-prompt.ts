import type { CanonLocationBrief } from '../types.js';
import { FORBIDDEN_RE } from '../../wardrobe-rotation/prompt/forbidden-identity-regex.js';

/**
 * Assembles the Rachel-in-location canonical generation prompt for nano_banana_pro.
 *
 * Used by bootstrapLocation. The aesthetic_reference_url (passed separately via
 * medias[]) provides the location aesthetic (style, color palette, room
 * elements). This prompt locks Rachel's position + framing on top of that
 * aesthetic.
 *
 * Framing rules encoded here are locked from the Smoke 0d iterations:
 * ~60% width, ~60-70% height, surface band <20% bottom of frame with no near
 * edge visible, no ceiling visible, no pendant lamps visible.
 *
 * Surface phrase varies by location: kitchen → "marble island"; everything
 * else → "wooden desk". The static identity descriptor ("olive skin, dark
 * wavy hair") is intentional baseline identity for the FIRST Rachel-in-
 * location instance and is whitelisted by being part of the static template
 * (not a dynamic field). The forbidden-identity check is applied only to
 * the DYNAMIC brief fields, so tampered briefs are still rejected.
 *
 * @throws if any dynamic field on `loc` contains a forbidden identity descriptor.
 */
export function assembleCanonicalBootstrapPrompt(loc: CanonLocationBrief): string {
  // Forbidden-identity check on DYNAMIC FIELDS only (not the static template).
  // The static "olive skin, dark wavy hair" baseline identity must pass through
  // untouched, but a tampered brief must still be caught.
  const dynamicJoined = [
    loc.name,
    loc.rachel_position,
    loc.background_composition,
    loc.lighting_setup,
    ...loc.props,
    loc.wall_color,
    loc.floor_material,
  ].join(' | ');

  const match = FORBIDDEN_RE.exec(dynamicJoined);
  if (match) {
    throw new Error(
      `assembleCanonicalBootstrapPrompt: forbidden identity term "${match[0]}" detected in canon brief. ` +
        "Never describe Rachel's skin tone, hair color, scars, freckles, or other features that should come from the reference image.",
    );
  }

  const surface = loc.name === 'kitchen' ? 'marble island' : 'wooden desk';

  const propsClause =
    loc.props.length > 0
      ? `Visible context in the background includes: ${loc.props.slice(0, 4).join(', ')}.`
      : '';

  const prompt = [
    `Rachel (mid-30s woman, olive skin, dark wavy hair down past her shoulders, calm expression, no smile, cream cable-knit sweater) ${loc.rachel_position} in THIS EXACT ${loc.name} from the reference image. Frontal straight-on view facing the camera directly.`,
    '',
    'Rachel is THE central subject and dominates the frame:',
    '- She covers approximately 60% of the frame WIDTH (shoulders wide in the frame).',
    '- She covers approximately 60-70% of the frame HEIGHT.',
    '- CLOSE portrait-style framing.',
    '',
    `Bottom of frame: the ${surface} top is a thin horizontal band at the very bottom, LESS than 20% of frame height. Only the middle/back portion of the surface is visible — no near edge visible. Rachel's hands rest on the surface in front of her.`,
    '',
    'Top of frame: NO ceiling visible. NO pendant lamps visible at all. Top edge crops above her head at the wall/cabinet level.',
    '',
    `Background visible only at narrow margins around Rachel: ${loc.background_composition}. ${loc.lighting_setup}. ${propsClause}`.trimEnd(),
    '',
    'Photorealistic, bright, natural lighting, shallow depth of field. The location aesthetic must match the reference image — same coastal-modern feel.',
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  return prompt;
}
