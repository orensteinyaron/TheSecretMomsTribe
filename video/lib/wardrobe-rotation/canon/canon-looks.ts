// Canonical look briefs for Rachel (Face of SMT).
//
// Source: FACE_OF_SMT_V1.md "Wardrobe & looks (11 locked variations)" table.
// Looks 1-5 have explicit briefs in canon. Looks 6-11 are placeholders in
// canon ("Additional variations") with no wardrobe specifics — defining them
// is a follow-up task with Yaron + Claude before bootstrap of those slots.
//
// Look = styling axis (wardrobe + hair + accessories), independent of
// location. Composed at render time by pickCombination.

import type { CanonLookBrief } from '../types.js';

export const CANON_LOOKS: Record<string, CanonLookBrief> = {
  look_01: {
    wardrobe: 'cream cable-knit sweater',
    hair: 'loose half-up',
    accessories: null,
    best_for: 'trust content, morning content, comfort topics',
  },
  look_02: {
    wardrobe: 'white casual tee',
    hair: 'hair down',
    accessories: null,
    best_for: 'neutral / default / explainers',
  },
  look_03: {
    wardrobe: 'denim jacket over white top',
    hair: 'hair down, slightly tucked behind one ear',
    accessories: null,
    best_for: 'casual, relatable, going-about-my-day',
  },
  look_04: {
    wardrobe: 'fitted black top',
    hair: 'hair down',
    accessories: 'small gold necklace',
    best_for: 'hot takes, sharper tone, tech content',
  },
  look_05: {
    wardrobe: 'dusty rose blouse',
    hair: 'hair down, natural',
    accessories: null,
    best_for: 'feel-good, trending, wellness',
  },
  // look_06 through look_11: TODO. Canon doc (FACE_OF_SMT_V1.md L202) has
  // a single "Additional variations (tested, held in rotation)" row for
  // slots 6-11 with no wardrobe specifics. Lock briefs in a follow-up
  // session before bootstrapping these slots.
};

/** Numeric look slots (1-N) that have a brief defined. */
export const CANON_LOOK_NUMBERS_DEFINED: readonly number[] = [1, 2, 3, 4, 5];
