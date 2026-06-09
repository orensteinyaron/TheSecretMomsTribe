/**
 * PREFLIGHT (skill §2 preflight + §1 invariants) — per-channel guards, pure.
 *
 * Order matters: the approval gate is checked FIRST, so an unapproved row can
 * never reach a write. Idempotency (already posted) and scheduling (not due)
 * resolve to 'noop' — no write, leave the row alone. Content-integrity problems
 * resolve to 'fail'; an expired trending window to 'skip'.
 */

import type { Channel } from '../lifecycle/types.js';
import type { DuePiece, PreflightDecision } from './types.js';

// Mirrors the financial disclaimer check in create-from-url/enqueue.ts (the same
// contract rule, enforced again defensively at publish time).
const DISCLAIMER_RE = /not\s+(financial|investment|tax|legal)\s+advice/i;

export function preflightChannel(piece: DuePiece, channel: Channel, now: Date): PreflightDecision {
  // 1. Approval is the publish permission. Never act on an unapproved row.
  if (piece.status !== 'approved') return { action: 'noop', reason: 'not_approved' };
  if (piece.renderStatus !== 'complete') return { action: 'noop', reason: 'not_rendered' };

  const ch = piece.channels.find((c) => c.channel === channel);
  if (!ch) return { action: 'noop', reason: 'no_channel_row' };

  // 2. Idempotent — never double-post. An external id ⇒ the post already exists.
  if (ch.externalPostId || ch.status === 'posted') return { action: 'noop', reason: 'already_posted' };
  if (ch.status === 'skipped' || ch.status === 'failed') {
    return { action: 'noop', reason: `already_${ch.status}` };
  }
  if (ch.status !== 'pending' && ch.status !== 'scheduled') {
    return { action: 'noop', reason: 'not_actionable' };
  }

  // 3. Respect scheduled_for — never post before its time.
  if (ch.scheduledFor && new Date(ch.scheduledFor) > now) {
    return { action: 'noop', reason: 'not_due' };
  }

  // 4. Pillar compliance.
  const caption = ch.caption ?? piece.caption ?? '';
  if (piece.pillar === 'financial' && !DISCLAIMER_RE.test(caption)) {
    return { action: 'fail', reason: 'financial_disclaimer_missing' };
  }
  if (piece.pillar === 'trending') {
    const expiresAt = piece.metadata.expires_at;
    if (typeof expiresAt === 'string' && new Date(expiresAt) <= now) {
      return { action: 'skip', reason: 'trending_expired' };
    }
  }

  // 5. Must have a rendered asset to upload.
  if (!piece.finalAssetUrl) return { action: 'fail', reason: 'missing_asset' };

  return { action: 'proceed' };
}
