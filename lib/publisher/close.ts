/**
 * CLOSE / writeback (skill §1.3-1.4, §5A) — record the result after the human acts.
 *
 * Reuses the Phase 0 lifecycle verbs; no persistence is reimplemented here.
 *
 *   - closeChannel: the human clicked publish and we captured the permalink +
 *     external id → markPosted (atomic, idempotent) → postCheck (re-read +
 *     assert). If EITHER the permalink or the id is missing, we MUST NOT mark
 *     the row posted — we leave it in place for manual reconcile (§5A).
 *   - skipChannel / failChannel: fail-closed, never silent — always a reason.
 */

import type { Lifecycle } from '../lifecycle/lifecycle.js';
import type { Channel, MarkResult, PostCheckReport } from '../lifecycle/types.js';
import type { CloseOutcome } from './types.js';

export interface CloseChannelInput {
  contentId: string;
  channel: Channel;
  postUrl: string | null;
  externalPostId: string | null;
}

export interface CloseResult {
  outcome: CloseOutcome;
  reason?: string;
  mark?: MarkResult;
  postCheck?: PostCheckReport;
}

export async function closeChannel(
  lifecycle: Lifecycle,
  input: CloseChannelInput,
): Promise<CloseResult> {
  const { contentId, channel, postUrl, externalPostId } = input;
  if (!postUrl?.trim() || !externalPostId?.trim()) {
    // Cannot confirm the post went live → never mark posted. Surface it.
    return { outcome: 'left_scheduled', reason: 'permalink_or_id_missing' };
  }
  const mark = await lifecycle.markPosted(contentId, channel, postUrl, externalPostId);
  const postCheck = await lifecycle.postCheck(contentId);
  return { outcome: 'posted', mark, postCheck };
}

export async function skipChannel(
  lifecycle: Lifecycle,
  contentId: string,
  channel: Channel,
  reason: string,
): Promise<CloseResult> {
  const mark = await lifecycle.markSkipped(contentId, channel, reason);
  return { outcome: 'skipped', reason, mark };
}

export async function failChannel(
  lifecycle: Lifecycle,
  contentId: string,
  channel: Channel,
  reason: string,
): Promise<CloseResult> {
  const mark = await lifecycle.markFailed(contentId, channel, reason);
  return { outcome: 'failed', reason, mark };
}
