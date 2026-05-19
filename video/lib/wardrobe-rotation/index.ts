// Public API barrel for wardrobe-rotation.
// Import from here — do not import the sub-modules directly.

// Types
export type {
  RachelLook,
  RachelLookStatus,
  RecentPick,
  CreateLookInput,
  CreateLookResult,
} from './types.js';

// Picker
export { pickNextLook, WARDROBE_COOLDOWN } from './pick-next-look.js';

// Look-ID generator (pure)
export { nextLookIdFrom } from './generate-look-id.js';

// DB layer
export {
  listActiveLooks,
  listLooks,
  getLook,
  getRecentPicks,
  insertLook,
  updateLookStatus,
  generateNextLookId,
} from './db.js';

// Lifecycle flows
export { approveLook } from './approve-look.js';
export { retireLook } from './retire-look.js';
export { createNewLook } from './create-new-look.js';
export type { GenerateImagesFn } from './create-new-look.js';

// Prompt assembly (exposed for testing + potential reuse)
export { assembleLookPrompt } from './look-prompt.js';
