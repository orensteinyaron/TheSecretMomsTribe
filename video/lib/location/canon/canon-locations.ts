// Canonical location briefs for Rachel (Face of SMT) — PR-C v2.
//
// Each entry mirrors the structured fields in the rachel_locations table
// and feeds the canonical-bootstrap-prompt assembler. The aesthetic
// reference URL is provided by Yaron at bootstrap time (not stored here)
// — this dict only carries the immutable canon set definition.
//
// PR-C ships kitchen + studio. Locations 03-08 are TODO — defined in a
// follow-up session with Yaron + matching reference URLs.

import type { CanonLocationBrief } from '../types.js';

export const CANON_LOCATIONS: Record<string, CanonLocationBrief> = {
  location_01: {
    name: 'kitchen',
    tier: 'primary',
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, chest up',
    rachel_position: 'standing just behind the kitchen island, hands resting on the marble surface',
    background_composition:
      'gas cooktop visible on back-wall counter behind Rachel, stainless steel double oven on the right, marble splashback above the cooktop, white shaker upper cabinets, window with shutters and view of trees/ocean on the far left',
    lighting_setup:
      'bright natural daylight from window camera-left, soft fill, no harsh shadows',
    props: [
      'white marble island',
      'gas cooktop on back-wall counter',
      'stainless steel double oven',
      'marble splashback',
      'white shaker cabinets',
      'window with shutters (view of trees/ocean)',
    ] as const,
    wall_color: 'soft white',
    floor_material: 'light oak hardwood',
    best_for: 'parenting insights, mom health, day-to-day mom content',
  },
  location_02: {
    name: 'home_studio',
    tier: 'primary',
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, chest up',
    rachel_position:
      'seated at a wooden desk, hands resting calmly on the desk surface',
    background_composition:
      'large monstera plant with green leaves on the left, soft pink decor on the right, white walls, bright natural daylight from a window on the far left, wooden desk',
    lighting_setup:
      'bright natural daylight from window camera-left, soft ambient fill',
    props: [
      'wooden desk',
      'monstera plant in pot',
      'soft pink decor accent',
      'white walls',
      'bright window with daylight',
    ] as const,
    wall_color: 'warm off-white',
    floor_material: 'light wood',
    best_for: 'AI Magic, Tech for Moms, Financial, explainer content',
  },
  // location_03 through location_08: TODO. Defined in follow-up session.
};

/** Numeric location slots (1-N) that have a brief defined here. */
export const CANON_LOCATION_NUMBERS_DEFINED: readonly number[] = [1, 2];
