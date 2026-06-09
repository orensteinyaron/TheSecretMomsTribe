/**
 * Persistence contract for the lifecycle layer.
 *
 * A `LifecycleStore` is a thin, mechanical persistence boundary. ALL policy
 * (validation, idempotency, fail-closed guards, post-check assertions) lives in
 * lifecycle.ts on top of this interface, so the policy is testable against the
 * in-memory ShadowLifecycleStore without a database.
 *
 * Two implementations:
 *   - SupabaseLifecycleStore (supabase-store.ts) — real DB.
 *   - ShadowLifecycleStore   (shadow-store.ts)   — in-memory dry-run.
 *
 * The store methods are deliberately *conditional and atomic*: `tryMarkPosted`
 * and `trySetStatus` perform guarded single-statement updates and report
 * whether THIS call performed the write, which is how the policy layer detects
 * idempotent no-ops and concurrent races without a read-modify-write race of
 * its own.
 */

import type {
  Channel,
  NormalizedEnqueueInput,
  ScheduledPostRow,
  ScheduledPostStatus,
} from './types.js';

export interface LifecycleStore {
  /**
   * Atomically insert one content_queue row AND one scheduled_posts row per
   * channel. All-or-nothing: a failure on any row leaves NO content_queue row
   * (no orphan). Returns the new content_id.
   */
  enqueue(input: NormalizedEnqueueInput): Promise<string>;

  /** Re-read every scheduled_posts row for a piece (ordered by channel). */
  listScheduledPosts(contentId: string): Promise<ScheduledPostRow[]>;

  /** Re-read a single (content_id, channel) row, or null if absent. */
  getScheduledPost(
    contentId: string,
    channel: Channel,
  ): Promise<ScheduledPostRow | null>;

  /**
   * Guarded atomic close → 'posted'. Sets status='posted', post_url,
   * external_post_id, published_at — but ONLY when external_post_id IS NULL.
   * Returns the updated row if THIS call performed the write; null if the guard
   * blocked it (already had an external_post_id) or the row does not exist.
   */
  tryMarkPosted(
    contentId: string,
    channel: Channel,
    postUrl: string,
    externalPostId: string,
  ): Promise<ScheduledPostRow | null>;

  /**
   * Guarded atomic status write (failed/skipped/etc). Sets status +
   * failure_reason ONLY when the current status is NOT 'posted' (a posted
   * channel is terminal and must never be silently downgraded). Returns the
   * updated row if THIS call performed the write; null if blocked or absent.
   */
  trySetStatus(
    contentId: string,
    channel: Channel,
    status: ScheduledPostStatus,
    failureReason: string,
  ): Promise<ScheduledPostRow | null>;
}
