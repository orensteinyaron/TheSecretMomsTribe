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
// Location DB queries have moved to ../location/db.ts (YAR-136 PR-C C5).
// They will be re-exported from the location barrel in C9.
export {
  listActiveLooks,
  listLooks,
  getLook,
  insertLook,
  updateLookStatus,
  generateNextLookId,
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
// Location-axis flows moved to ../location/index.ts (YAR-136 PR-C C9).
export { approveLook } from './flows/approve-look.js';
export { approveStill } from './flows/approve-still.js';
export { retireLook } from './flows/retire-look.js';
export { retireStill } from './flows/retire-still.js';

// ── Bootstrap flow (look axis only) ──────────────────────────────────────────
// Location bootstrap + anchored-still generation moved to ../location/index.ts.
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

// ── ID generator (pure) ──────────────────────────────────────────────────────
export { nextIdFrom } from './flows/generate-id.js';
