/**
 * create-from-url — deterministic surfaces for the Phase 1 ingestion path.
 *
 * CAPTURE and ENQUEUE are code; ANALYZE and RECREATE are creative steps the
 * skill performs in-session; the approvals are human gates. See
 * skills/create-from-url/SKILL.md for the full flow.
 */

export { detectPlatform } from './platform.js';
export { capture, CaptureIncompleteError, APIFY_ACTORS } from './capture.js';
export { enqueueRemix, type RemixEnqueueResult } from './enqueue.js';
export * from './types.js';
