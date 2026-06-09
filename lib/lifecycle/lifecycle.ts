/**
 * Lifecycle policy layer.
 *
 * Pure orchestration over a LifecycleStore: validation, normalization,
 * idempotency, fail-closed guards, and (critically) a symmetric post-check on
 * every persistent write — we re-read the row and assert the DB actually
 * accepted it. Schema-shaped validation is NOT proof of a write.
 *
 * No LLM, no network beyond the store. Deterministic.
 */

import type { LifecycleStore } from './store.js';
import {
  CHANNELS,
  type Channel,
  type EnqueueInput,
  type EnqueueResult,
  type MarkResult,
  type NormalizedEnqueueInput,
  type PostCheckChannelReport,
  type PostCheckReport,
  type RenderProfileSlug,
  type ContentPillar,
  type ScheduledPostRow,
} from './types.js';

const RENDER_PROFILE_SLUGS: readonly RenderProfileSlug[] = [
  'avatar-v1',
  'moving-images',
  'static-image',
  'carousel',
];
const PILLARS: readonly ContentPillar[] = [
  'parenting',
  'health',
  'ai_magic',
  'tech',
  'trending',
  'financial',
  'uncategorized',
];

function req(value: string | undefined | null, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[lifecycle] missing required field: ${field}`);
  }
  return value;
}

function normalizeEnqueue(input: EnqueueInput): NormalizedEnqueueInput {
  if (!RENDER_PROFILE_SLUGS.includes(input.renderProfileSlug)) {
    throw new Error(`[lifecycle] invalid renderProfileSlug: ${input.renderProfileSlug}`);
  }
  if (!PILLARS.includes(input.pillar)) {
    throw new Error(`[lifecycle] invalid pillar: ${input.pillar}`);
  }
  if (!Array.isArray(input.channels) || input.channels.length === 0) {
    throw new Error('[lifecycle] at least one channel is required');
  }
  const seen = new Set<Channel>();
  const channels = input.channels.map((c) => {
    if (!CHANNELS.includes(c.channel)) {
      throw new Error(`[lifecycle] invalid channel: ${c.channel}`);
    }
    if (seen.has(c.channel)) {
      throw new Error(`[lifecycle] duplicate channel: ${c.channel}`);
    }
    seen.add(c.channel);
    return {
      channel: c.channel,
      caption: req(c.caption, `channels[${c.channel}].caption`),
      scheduledFor: c.scheduledFor ?? null,
    };
  });
  return {
    renderProfileSlug: input.renderProfileSlug,
    pillar: input.pillar,
    hook: req(input.hook, 'hook'),
    baseCaption: req(input.baseCaption, 'baseCaption'),
    finalAssetUrl: req(input.finalAssetUrl, 'finalAssetUrl'),
    renderCompletedAt: input.renderCompletedAt ?? null,
    status: input.approved ? 'approved' : 'pending_approval',
    metadata: input.metadata ?? {},
    channels,
  };
}

export interface Lifecycle {
  enqueuePiece(input: EnqueueInput): Promise<EnqueueResult>;
  markPosted(
    contentId: string,
    channel: Channel,
    postUrl: string,
    externalPostId: string,
  ): Promise<MarkResult>;
  markFailed(contentId: string, channel: Channel, reason: string): Promise<MarkResult>;
  markSkipped(contentId: string, channel: Channel, reason: string): Promise<MarkResult>;
  postCheck(contentId: string, expectedChannels?: readonly Channel[]): Promise<PostCheckReport>;
}

export function createLifecycle(store: LifecycleStore): Lifecycle {
  async function enqueuePiece(input: EnqueueInput): Promise<EnqueueResult> {
    const normalized = normalizeEnqueue(input);
    const contentId = await store.enqueue(normalized);

    // Post-check: re-read and assert the DB accepted every channel row.
    const scheduledPosts = await store.listScheduledPosts(contentId);
    const expected = normalized.channels.map((c) => c.channel).sort();
    const got = scheduledPosts.map((p) => p.channel).sort();
    if (got.length !== expected.length || got.some((c, i) => c !== expected[i])) {
      throw new Error(
        `[lifecycle.enqueuePiece] post-check failed for ${contentId}: ` +
          `expected channels [${expected.join(', ')}], got [${got.join(', ')}]`,
      );
    }
    for (const p of scheduledPosts) {
      if (p.status !== 'pending') {
        throw new Error(
          `[lifecycle.enqueuePiece] post-check failed: ${p.channel} not 'pending' (${p.status})`,
        );
      }
    }
    return { contentId, scheduledPosts };
  }

  async function markPosted(
    contentId: string,
    channel: Channel,
    postUrl: string,
    externalPostId: string,
  ): Promise<MarkResult> {
    req(postUrl, 'postUrl');
    req(externalPostId, 'externalPostId');

    const existing = await store.getScheduledPost(contentId, channel);
    if (!existing) {
      throw new Error(
        `[lifecycle.markPosted] fail-closed: no scheduled_posts row for ${contentId}/${channel}`,
      );
    }
    // Idempotent no-op: an external_post_id already recorded ⇒ first write wins.
    if (existing.external_post_id !== null) {
      return { row: existing, idempotentNoop: true };
    }

    const updated = await store.tryMarkPosted(contentId, channel, postUrl, externalPostId);
    if (!updated) {
      // Guard blocked us ⇒ a concurrent writer set it first. Return that state.
      const reread = await store.getScheduledPost(contentId, channel);
      if (reread?.external_post_id) return { row: reread, idempotentNoop: true };
      throw new Error(
        `[lifecycle.markPosted] write did not land for ${contentId}/${channel}`,
      );
    }

    // Post-check: re-read and assert the close persisted exactly as intended.
    const reread = await store.getScheduledPost(contentId, channel);
    assertPosted(reread, contentId, channel, postUrl, externalPostId);
    return { row: reread as ScheduledPostRow, idempotentNoop: false };
  }

  async function setTerminal(
    contentId: string,
    channel: Channel,
    status: 'failed' | 'skipped',
    reason: string,
  ): Promise<MarkResult> {
    req(reason, 'reason'); // never silent
    const updated = await store.trySetStatus(contentId, channel, status, reason);
    if (!updated) {
      const existing = await store.getScheduledPost(contentId, channel);
      if (!existing) {
        throw new Error(
          `[lifecycle.${status}] fail-closed: no scheduled_posts row for ${contentId}/${channel}`,
        );
      }
      if (existing.status === 'posted') {
        throw new Error(
          `[lifecycle.${status}] refusing to overwrite a 'posted' channel ${contentId}/${channel}`,
        );
      }
      throw new Error(`[lifecycle.${status}] write did not land for ${contentId}/${channel}`);
    }
    // Post-check.
    const reread = await store.getScheduledPost(contentId, channel);
    if (!reread || reread.status !== status || reread.failure_reason !== reason) {
      throw new Error(
        `[lifecycle.${status}] post-check failed for ${contentId}/${channel}`,
      );
    }
    return { row: reread, idempotentNoop: false };
  }

  function markFailed(contentId: string, channel: Channel, reason: string): Promise<MarkResult> {
    return setTerminal(contentId, channel, 'failed', reason);
  }
  function markSkipped(contentId: string, channel: Channel, reason: string): Promise<MarkResult> {
    return setTerminal(contentId, channel, 'skipped', reason);
  }

  async function postCheck(
    contentId: string,
    expectedChannels?: readonly Channel[],
  ): Promise<PostCheckReport> {
    const rows = await store.listScheduledPosts(contentId);
    const byChannel = new Map<Channel, ScheduledPostRow>();
    for (const r of rows) byChannel.set(r.channel, r);

    // If the caller does not declare expected channels, assert over whatever is
    // present (cannot detect a missing row without an expectation).
    const expected = (expectedChannels ?? rows.map((r) => r.channel)) as readonly Channel[];

    const channels: PostCheckChannelReport[] = expected.map((channel) =>
      reportForChannel(channel, byChannel.get(channel)),
    );
    const issues = channels.flatMap((c) => c.issues);
    const fullyPosted =
      expected.length > 0 &&
      channels.every((c) => c.status === 'posted' && c.ok);
    return { contentId, fullyPosted, channels, issues };
  }

  return { enqueuePiece, markPosted, markFailed, markSkipped, postCheck };
}

/** Detect half-written rows: a recorded status whose required fields are absent. */
function reportForChannel(
  channel: Channel,
  row: ScheduledPostRow | undefined,
): PostCheckChannelReport {
  if (!row) {
    return { channel, status: 'missing', ok: false, issues: [`${channel}: missing scheduled_posts row`] };
  }
  const issues: string[] = [];
  if (row.status === 'posted' && (!row.post_url || !row.external_post_id)) {
    issues.push(`${channel}: posted but missing post_url/external_post_id (half-written)`);
  }
  if (row.status === 'posted' && !row.published_at) {
    issues.push(`${channel}: posted but published_at is null (half-written)`);
  }
  if ((row.status === 'failed' || row.status === 'skipped') && !row.failure_reason) {
    issues.push(`${channel}: ${row.status} but failure_reason is null (silent)`);
  }
  return { channel, status: row.status, ok: issues.length === 0, issues };
}

function assertPosted(
  row: ScheduledPostRow | null,
  contentId: string,
  channel: Channel,
  postUrl: string,
  externalPostId: string,
): void {
  if (
    !row ||
    row.status !== 'posted' ||
    row.post_url !== postUrl ||
    row.external_post_id !== externalPostId ||
    !row.published_at
  ) {
    throw new Error(
      `[lifecycle.markPosted] post-check failed for ${contentId}/${channel}: row did not persist as posted`,
    );
  }
}
