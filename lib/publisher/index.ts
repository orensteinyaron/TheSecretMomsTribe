/**
 * smt_publisher — Phase 1 (browser-assisted) deterministic surfaces.
 *
 * Selection, preflight, format matrix, per-channel planning, close/writeback,
 * and the provider seam. The live browser staging (Claude in Chrome) and the
 * human publish click happen in-session per agents/skills/smt_publisher/SKILL.md.
 * Persistence is the Phase 0 lib/lifecycle module — not reimplemented here.
 */

export { groupDueRows, selectDuePieces } from './select.js';
export { preflightChannel } from './preflight.js';
export { resolveMedia, TIKTOK_PHOTO_UNSUPPORTED, type MediaMatrixOptions } from './media-matrix.js';
export { planChannel, planPiece } from './plan.js';
export {
  closeChannel,
  skipChannel,
  failChannel,
  type CloseChannelInput,
  type CloseResult,
} from './close.js';
export {
  BrowserAssistedProvider,
  ApiPublishProvider,
  COMPOSER_URLS,
  type PublishProvider,
  type BuildStagingInput,
} from './provider.js';
export * from './types.js';
