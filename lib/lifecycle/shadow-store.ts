/**
 * In-memory LifecycleStore for dry-run / shadow mode and tests.
 *
 * Faithfully mirrors the DB invariants the policy layer relies on:
 *   - enqueue is all-or-nothing (no orphan content row on a mid-insert failure);
 *   - UNIQUE(content_id, channel) is enforced;
 *   - tryMarkPosted guards on external_post_id IS NULL;
 *   - trySetStatus guards on status <> 'posted';
 *   - updated_at advances on every write (mirrors the BEFORE UPDATE trigger).
 *
 * It writes to a shadow state, never to the platforms or the real tables —
 * this is the dry-run substrate the build spec requires.
 */

import type { LifecycleStore } from './store.js';
import type {
  Channel,
  NormalizedEnqueueInput,
  ScheduledPostRow,
  ScheduledPostStatus,
} from './types.js';

interface ContentRecord {
  id: string;
  render_profile_slug: string;
  pillar: string;
  hook: string;
  caption: string;
  final_asset_url: string;
  render_status: 'complete';
  render_completed_at: string;
  status: 'approved' | 'pending_approval';
  metadata: Record<string, unknown>;
}

let _seq = 0;
function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}_${String(_seq).padStart(6, '0')}`;
}

function key(contentId: string, channel: Channel): string {
  return `${contentId}::${channel}`;
}

function clone(row: ScheduledPostRow): ScheduledPostRow {
  return { ...row };
}

export class ShadowLifecycleStore implements LifecycleStore {
  /** Exposed for assertions in tests. */
  readonly content = new Map<string, ContentRecord>();
  readonly posts = new Map<string, ScheduledPostRow>();

  async enqueue(input: NormalizedEnqueueInput): Promise<string> {
    // Build everything in staging vars first; commit only if all rows are
    // valid — mirrors the single-transaction Postgres function (no orphan).
    const contentId = nextId('cq');
    const now = new Date().toISOString();
    const staged: ScheduledPostRow[] = [];
    const seen = new Set<Channel>();

    for (const ch of input.channels) {
      if (seen.has(ch.channel)) {
        throw new Error(
          `[shadow.enqueue] UNIQUE(content_id, channel) violation: ${ch.channel} appears twice`,
        );
      }
      seen.add(ch.channel);
      staged.push({
        id: nextId('sp'),
        content_id: contentId,
        channel: ch.channel,
        status: 'pending',
        caption: ch.caption,
        scheduled_for: ch.scheduledFor,
        published_at: null,
        post_url: null,
        external_post_id: null,
        failure_reason: null,
        created_at: now,
        updated_at: now,
      });
    }
    if (staged.length === 0) {
      throw new Error('[shadow.enqueue] at least one channel required');
    }

    // Commit (atomic): content first, then its posts.
    this.content.set(contentId, {
      id: contentId,
      render_profile_slug: input.renderProfileSlug,
      pillar: input.pillar,
      hook: input.hook,
      caption: input.baseCaption,
      final_asset_url: input.finalAssetUrl,
      render_status: 'complete',
      render_completed_at: input.renderCompletedAt ?? now,
      status: input.status,
      metadata: input.metadata,
    });
    for (const row of staged) this.posts.set(key(contentId, row.channel), row);
    return contentId;
  }

  async listScheduledPosts(contentId: string): Promise<ScheduledPostRow[]> {
    return [...this.posts.values()]
      .filter((r) => r.content_id === contentId)
      .sort((a, b) => a.channel.localeCompare(b.channel))
      .map(clone);
  }

  async getScheduledPost(
    contentId: string,
    channel: Channel,
  ): Promise<ScheduledPostRow | null> {
    const row = this.posts.get(key(contentId, channel));
    return row ? clone(row) : null;
  }

  async tryMarkPosted(
    contentId: string,
    channel: Channel,
    postUrl: string,
    externalPostId: string,
  ): Promise<ScheduledPostRow | null> {
    const row = this.posts.get(key(contentId, channel));
    if (!row || row.external_post_id !== null) return null; // guard
    row.status = 'posted';
    row.post_url = postUrl;
    row.external_post_id = externalPostId;
    row.published_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    return clone(row);
  }

  async trySetStatus(
    contentId: string,
    channel: Channel,
    status: ScheduledPostStatus,
    failureReason: string,
  ): Promise<ScheduledPostRow | null> {
    const row = this.posts.get(key(contentId, channel));
    if (!row || row.status === 'posted') return null; // guard: posted is terminal
    row.status = status;
    row.failure_reason = failureReason;
    row.updated_at = new Date().toISOString();
    return clone(row);
  }
}
