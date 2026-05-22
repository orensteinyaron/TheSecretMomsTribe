// Canonical location briefs for Rachel (Face of SMT).
//
// Two primaries are locked: kitchen (location_01) and home office / studio
// (location_02). Six secondaries (location_03 through location_08) are TBD —
// defined in a follow-up session before bootstrapping.
//
// Location = setting axis (setting + lighting + framing + tier), independent
// of look. Composed at render time by pickCombination.

import type { CanonLocationBrief } from '../types.js';

export const CANON_LOCATIONS: Record<string, CanonLocationBrief> = {
  location_01: {
    tier: 'primary',
    setting: 'modern kitchen, kitchen island in background, soft cream walls',
    lighting: 'morning window light, warm, daylight balanced',
    framing: 'medium shot, eye level, shallow depth of field',
    best_for: 'parenting insights, mom health, day-to-day mom content',
  },
  location_02: {
    tier: 'primary',
    setting:
      'home office / studio, warm bookshelf or plant backdrop, wooden desk visible',
    lighting: 'desk lamp + ambient afternoon light, slight golden cast',
    framing: 'medium shot, eye level, shallow depth of field',
    best_for:
      'AI Magic, Tech for Moms, Financial, Trending — anything explainer-coded',
  },
  // location_03 through location_08: TODO. Six secondaries to be locked
  // in a follow-up session before bootstrap.
};

/** Numeric location slots (1-N) that have a brief defined. */
export const CANON_LOCATION_NUMBERS_DEFINED: readonly number[] = [1, 2];
