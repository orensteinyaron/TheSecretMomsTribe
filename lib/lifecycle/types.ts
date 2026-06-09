/**
 * Shared types for the publishing lifecycle layer.
 *
 * This layer is the handoff seam that BOTH `create-from-url` (Phase 1) and
 * `smt_publisher` (Phase 2) write through. It owns the `content_queue` +
 * `scheduled_posts` lifecycle: enqueue (atomic), close (mark posted/failed/
 * skipped, idempotent), and post-check (re-read + assert).
 *
 * Source of truth for shapes: agents/skills/SMT_PIPELINE_CONTRACT.md (v2.x).
 * Verified against Supabase project fvxaykkmzsbrggjgdfjj before authoring.
 */

/** Channels are the `channel` Postgres enum. v2.0.0 supports exactly these two. */
export type Channel = 'instagram' | 'tiktok';
export const CHANNELS: readonly Channel[] = ['instagram', 'tiktok'] as const;

/** `scheduled_posts.status` text CHECK domain. */
export type ScheduledPostStatus =
  | 'pending'
  | 'scheduled'
  | 'posted'
  | 'failed'
  | 'skipped';

/** The four canonical render-profile slugs (render_profiles.slug). */
export type RenderProfileSlug =
  | 'avatar-v1'
  | 'moving-images'
  | 'static-image'
  | 'carousel';

/**
 * `content_queue.content_pillar` CHECK domain (DB pillar names — note these are
 * the DB-side names, e.g. `parenting`/`tech`, NOT the canonical SKILL pillars
 * `parenting_insights`/`tech_for_moms`). Callers translate at the boundary
 * (agents/lib/pillar_translation.js) before handing a row to this layer.
 */
export type ContentPillar =
  | 'parenting'
  | 'health'
  | 'ai_magic'
  | 'tech'
  | 'trending'
  | 'financial'
  | 'uncategorized';

/** One target channel for a piece, with its platform-native caption. */
export interface ChannelPlan {
  channel: Channel;
  /** Platform-native caption written to scheduled_posts.caption. */
  caption: string;
  /** ISO-8601 schedule time; null/undefined → posted ASAP (scheduled_for null). */
  scheduledFor?: string | null;
}

/** Input to enqueuePiece(). Validated + normalized before persistence. */
export interface EnqueueInput {
  renderProfileSlug: RenderProfileSlug;
  pillar: ContentPillar;
  /** content_queue.hook — NOT NULL with no default; required. */
  hook: string;
  /** content_queue.caption — the base/storytelling caption (fallback). */
  baseCaption: string;
  /** content_queue.final_asset_url — required by render_complete_minimum_contract. */
  finalAssetUrl: string;
  /** ISO-8601; null/undefined → DB stamps now() at insert. */
  renderCompletedAt?: string | null;
  /**
   * Maps to content_queue.status. The real human-approval mechanism is the web
   * app writing status='approved' (Pipeline.tsx / ContentDetailPage.tsx).
   * Fail-closed default: false → 'pending_approval' (surfaces in the approval
   * queue; never auto-published). Pass true only when a human has already
   * approved upstream (e.g. create-from-url approval #2).
   */
  approved?: boolean;
  /** At least one. Default targets are both 'tiktok' and 'instagram'. */
  channels: ChannelPlan[];
  /** Free-form metadata (e.g. source_url + creator_handle for provenance). */
  metadata?: Record<string, unknown>;
}

/** A row of `scheduled_posts`, as stored. */
export interface ScheduledPostRow {
  id: string;
  content_id: string;
  channel: Channel;
  status: ScheduledPostStatus;
  caption: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  post_url: string | null;
  external_post_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueResult {
  contentId: string;
  scheduledPosts: ScheduledPostRow[];
}

/** Result of a mark* close operation. */
export interface MarkResult {
  row: ScheduledPostRow;
  /** True when the call was a no-op because the terminal state already held. */
  idempotentNoop: boolean;
}

/** Per-channel slice of a post-check. */
export interface PostCheckChannelReport {
  channel: Channel;
  /** Recorded status, or 'missing' when no scheduled_posts row exists. */
  status: ScheduledPostStatus | 'missing';
  /** True when the recorded row is internally consistent (not half-written). */
  ok: boolean;
  /** Human-readable issues, e.g. 'posted_but_missing_identifiers'. */
  issues: string[];
}

/**
 * Re-read assertion over every scheduled_posts row for a piece. A piece is
 * `fullyPosted` only when every expected channel row exists AND is 'posted'
 * AND is internally consistent.
 */
export interface PostCheckReport {
  contentId: string;
  fullyPosted: boolean;
  channels: PostCheckChannelReport[];
  /** Aggregate of every channel-level issue (empty ⇒ clean). */
  issues: string[];
}

/** Normalized, validated enqueue payload handed to a store. */
export interface NormalizedEnqueueInput {
  renderProfileSlug: RenderProfileSlug;
  pillar: ContentPillar;
  hook: string;
  baseCaption: string;
  finalAssetUrl: string;
  renderCompletedAt: string | null;
  status: 'approved' | 'pending_approval';
  metadata: Record<string, unknown>;
  channels: Array<{ channel: Channel; caption: string; scheduledFor: string | null }>;
}
