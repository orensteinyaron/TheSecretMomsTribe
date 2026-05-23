// Public API barrel for the location skill module (YAR-136 PR-C C9).
// Import from here — do not import the sub-modules directly.
//
// This module owns the LOCATION AXIS: canon set definitions, the locked
// Rachel-in-location canonical reference image, anchored wardrobe-swap
// still generation, and the location lifecycle (bootstrap → approve →
// retire + canonical refresh).
//
// The look axis + pickers stay in ../wardrobe-rotation/.

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  CanonLocationBrief,
  BootstrapLocationInput,
  BootstrapLocationResult,
  GenerateAnchoredStillResult,
} from './types.js';

// ── Canon dict ───────────────────────────────────────────────────────────────
export { CANON_LOCATIONS, CANON_LOCATION_NUMBERS_DEFINED } from './canon/canon-locations.js';

// ── Prompt assembly ──────────────────────────────────────────────────────────
export { assembleCanonicalBootstrapPrompt } from './prompt/canonical-bootstrap-prompt.js';
export { assembleAnchoredStillPrompt } from './prompt/anchored-still-prompt.js';

// ── DB layer ─────────────────────────────────────────────────────────────────
export {
  listActiveLocations,
  listLocations,
  getLocation,
  insertLocation,
  updateLocationStatus,
  generateNextLocationId,
  updateLocationReferenceImage,
  getLocationReferenceImage,
} from './db.js';

// ── Lifecycle + render-time flows ────────────────────────────────────────────
export { bootstrapLocation } from './flows/bootstrap-location.js';
export type { BootstrapLocationDeps } from './flows/bootstrap-location.js';

export { generateAnchoredStill } from './flows/generate-anchored-still.js';
export type { GenerateAnchoredStillDeps } from './flows/generate-anchored-still.js';

export { approveLocation } from './flows/approve-location.js';
export type { ApproveLocationDeps } from './flows/approve-location.js';

export { retireLocation } from './flows/retire-location.js';
export type { RetireLocationDeps } from './flows/retire-location.js';

export { getLocationReference } from './flows/get-location-reference.js';
export type { GetLocationReferenceDeps } from './flows/get-location-reference.js';

export { updateLocationReference, confirmReferenceUpdate } from './flows/update-location-reference.js';
export type { UpdateLocationReferenceDeps } from './flows/update-location-reference.js';

// ── Transport constants + DI types ───────────────────────────────────────────
export {
  LOCATION_BOOTSTRAP_CANDIDATES,
  ANCHORED_STILL_CANDIDATES,
} from './flows/constants.js';
export type {
  NanoBananaProFn,
  NanoBananaProInput,
  NanoBananaProImage,
  MediasReference,
} from './flows/constants.js';
