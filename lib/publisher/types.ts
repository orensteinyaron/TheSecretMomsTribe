/**
 * Types for the smt_publisher Phase 1 (browser-assisted) path.
 *
 * Source of truth: agents/skills/smt_publisher/SKILL.md (contract wins on
 * conflict). The publisher selects approved + rendered + due rows, stages each
 * channel's post in Yaron's logged-in composer via Claude in Chrome, STOPS at
 * the publish button (never clicks), and — after Yaron clicks — closes the
 * lifecycle via the Phase 0 module (markPosted/markFailed/markSkipped +
 * postCheck). It never reimplements persistence.
 *
 * The deterministic surfaces (selection, preflight guards, the format matrix,
 * the close/writeback, and the provider seam) live here. The browser tool-calls
 * are performed live in-session per the skill.
 */

import type {
  Channel,
  ContentPillar,
  RenderProfileSlug,
  ScheduledPostStatus,
} from '../lifecycle/types.js';

/** A scheduled_posts row joined to its piece, as the selection query returns it. */
export interface DueRowRaw {
  content_id: string;
  cq_status: string;
  render_status: string;
  render_profile_slug: string | null;
  content_pillar: string;
  final_asset_url: string | null;
  /** First-frame + hook-banner PNG — TikTok's cover path (frame-based covers only). */
  thumbnail_asset_url: string | null;
  /** Purpose-generated cover PNG — passed as cover_url on IG Reels. */
  cover_asset_url: string | null;
  cq_caption: string | null;
  metadata: Record<string, unknown> | null;
  sp_channel: Channel;
  sp_status: ScheduledPostStatus;
  sp_caption: string | null;
  sp_scheduled_for: string | null;
  sp_external_post_id: string | null;
}

export interface DueChannel {
  channel: Channel;
  status: ScheduledPostStatus;
  caption: string | null;
  scheduledFor: string | null;
  externalPostId: string | null;
}

export interface DuePiece {
  contentId: string;
  /** content_queue.status — the publisher acts ONLY when this is 'approved'. */
  status: string;
  renderStatus: string;
  renderProfileSlug: RenderProfileSlug | null;
  pillar: ContentPillar;
  finalAssetUrl: string | null;
  /**
   * The two grid-facing visual assets of the avatar three-asset contract
   * (video + thumbnail + cover). IG uses coverAssetUrl as the Reels cover;
   * TikTok keeps the thumbnail path — its API only supports frame-based
   * covers (video_cover_timestamp_ms), and thumbnail_asset_url IS the
   * video's opening frame, so the visual matches.
   */
  thumbnailAssetUrl: string | null;
  coverAssetUrl: string | null;
  /** content_queue.caption — fallback when a per-channel caption is null. */
  caption: string | null;
  metadata: Record<string, unknown>;
  channels: DueChannel[];
}

export type PreflightAction = 'proceed' | 'noop' | 'skip' | 'fail';

/**
 * A preflight verdict for one (piece, channel), with explicit WRITE semantics so
 * the orchestrator never has to guess:
 *   - 'proceed' → stage it.
 *   - 'noop'    → do NOT write, leave the row as-is. Covers the idempotency and
 *                 fail-closed cases: already posted, not yet due, and — the key
 *                 invariant — a row that is NOT approved (never act on it).
 *   - 'skip'    → write markSkipped(reason). A legitimate non-error skip, e.g.
 *                 expired `trending`.
 *   - 'fail'    → write markFailed(reason). A content-integrity failure, e.g. a
 *                 `financial` piece missing its disclaimer, or a missing asset.
 * `reason` is a stable machine code.
 */
export interface PreflightDecision {
  action: PreflightAction;
  reason?: string;
}

export type MediaAction = 'video' | 'image' | 'carousel' | 'skip';

export interface MediaPlan {
  channel: Channel;
  action: MediaAction;
  /** Present when action === 'skip'. */
  reason?: string;
}

/**
 * Everything the browser agent needs to stage one channel's post — and a hard
 * reminder that it must stop at the publish button. There is no "publish" field
 * and no provider method that clicks: stopping is structural.
 */
export interface StagingPlan {
  contentId: string;
  channel: Channel;
  composerUrl: string;
  /** Local temp path of the downloaded asset (browser uploads via file picker). */
  assetPath: string;
  /**
   * Instagram only: local temp path of the downloaded cover image
   * (cover_asset_url) to set in the composer's cover selector. TikTok stays
   * null — its composer/API supports frame-based covers only, so the agent
   * leaves the default first frame (which matches thumbnail_asset_url).
   */
  coverAssetPath: string | null;
  caption: string;
  media: MediaPlan;
  readonly stopAtPublish: true;
}

/**
 * The deterministic per-channel decision (preflight × media matrix), before any
 * live browser action or DB write:
 *   - 'stage' → download the asset, build a StagingPlan, drive the composer.
 *   - 'skip'  → markSkipped(reason).
 *   - 'fail'  → markFailed(reason).
 *   - 'noop'  → leave the row untouched (already done / not due / not approved).
 */
export type ChannelAction =
  | {
      channel: Channel;
      action: 'stage';
      media: MediaPlan;
      caption: string;
      /** IG: cover_asset_url to stage as the Reels cover; null elsewhere. */
      coverAssetUrl: string | null;
    }
  | { channel: Channel; action: 'skip' | 'fail' | 'noop'; reason?: string };

/** Outcome of attempting to close a channel after the human acts. */
export type CloseOutcome = 'posted' | 'left_scheduled' | 'skipped' | 'failed';
