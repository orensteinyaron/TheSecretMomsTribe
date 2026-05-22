// Public API barrel for wardrobe-rotation.
// Import from here — do not import the sub-modules directly.

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  RachelLook,
  RachelLocation,
  RachelStill,
  RachelLookStatus,
  LocationTier,
  Source,
  RecentLookPick,
  RecentLocationPick,
  CanonLookBrief,
} from './types.js';

// ── Canon dicts ──────────────────────────────────────────────────────────────
export { CANON_LOOKS, CANON_LOOK_NUMBERS_DEFINED } from './canon/canon-looks.js';
export { CANON_LOCATIONS, CANON_LOCATION_NUMBERS_DEFINED } from './canon/canon-locations.js';

// ── Pickers (pure) ───────────────────────────────────────────────────────────
export { pickLook, LOOK_COOLDOWN } from './pickers/pick-look.js';
export {
  pickLocation,
  PRIMARY_LOCATION_RATIO,
  LOCATION_COOLDOWN_WITHIN_TIER,
  LOCATION_RATIO_WINDOW,
} from './pickers/pick-location.js';
export { pickCombination } from './pickers/pick-combination.js';
export type { PickCombinationInput, PickCombinationResult } from './pickers/pick-combination.js';

// ── Guards (pure) ────────────────────────────────────────────────────────────
export {
  assertCanRetireLook,
  LOOK_POOL_FLOOR,
  LOOK_POOL_WARNING_THRESHOLD,
} from './guards/assert-can-retire-look.js';
export {
  assertCanRetireLocation,
  LOCATION_POOL_FLOOR,
  PRIMARY_LOCATION_MIN,
} from './guards/assert-can-retire-location.js';
export { assertCanRetireStill } from './guards/assert-can-retire-still.js';

// ── Prompt assembly ──────────────────────────────────────────────────────────
export { assembleLookPrompt, PROMPT_TAIL } from './prompt/look-prompt.js';
export { FORBIDDEN_RE } from './prompt/forbidden-identity-regex.js';

// ── DB layer ─────────────────────────────────────────────────────────────────
export {
  listActiveLooks,
  listLooks,
  getLook,
  insertLook,
  updateLookStatus,
  generateNextLookId,
  listActiveLocations,
  listLocations,
  getLocation,
  insertLocation,
  updateLocationStatus,
  generateNextLocationId,
  listActiveStills,
  listStills,
  getStill,
  insertStill,
  updateStillStatus,
  getActiveStillsByCombo,
  countActiveStillsForCombo,
  getRecentLookPicks,
  getRecentLocationPicks,
} from './db.js';

// ── Lifecycle flows ──────────────────────────────────────────────────────────
export { approveLook } from './flows/approve-look.js';
export { approveLocation } from './flows/approve-location.js';
export { approveStill } from './flows/approve-still.js';
export { retireLook } from './flows/retire-look.js';
export { retireLocation } from './flows/retire-location.js';
export { retireStill } from './flows/retire-still.js';

// ── Bootstrap + render-time flows ────────────────────────────────────────────
// Types are defined in bootstrap-canon-look and re-used by bootstrap-canon-location.
// Export types + constants only from the canonical source to avoid duplicate exports.
export {
  bootstrapCanonLook,
  RACHEL_SOUL_ID,
  TOTAL_BOOTSTRAP_CANDIDATES,
  NEUTRAL_LOCATION_FOR_LOOK_BOOTSTRAP,
} from './flows/bootstrap-canon-look.js';
export type {
  GenerateImagesFn,
  GenerateImagesInput,
  GeneratedImage,
  BootstrapResult,
} from './flows/bootstrap-canon-look.js';
export {
  bootstrapCanonLocation,
  NEUTRAL_LOOK_FOR_LOCATION_BOOTSTRAP,
} from './flows/bootstrap-canon-location.js';
// NOTE: RACHEL_SOUL_ID and TOTAL_BOOTSTRAP_CANDIDATES are NOT re-exported from
// bootstrap-canon-location to avoid duplicate export identifiers in this barrel.

export {
  generateStill,
  ON_DEMAND_STILL_CANDIDATES,
} from './flows/generate-still.js';
export type { GenerateStillResult } from './flows/generate-still.js';

export { getCanonStatus } from './flows/get-canon-status.js';
export type { CanonStatus, CanonSlotStatus } from './flows/get-canon-status.js';

// ── ID generator (pure) ──────────────────────────────────────────────────────
export { nextIdFrom } from './flows/generate-id.js';
