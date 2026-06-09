/**
 * ENQUEUE + HANDOFF (skill §7) — rejoin the standard rails.
 *
 * Takes the approved concept (approval #2 — the human gate that authorizes
 * publishing) and persists it exactly like an agent-generated, approved piece,
 * via the Phase 0 lifecycle layer: one content_queue row + one scheduled_posts
 * row per channel, then a post-check. No LLM here.
 *
 * Enforces, deterministically:
 *   - no public credit: the creator handle must NOT appear in any caption;
 *   - provenance: source_url + creator_handle stored in metadata (internal only);
 *   - pillar gates: ai_magic verbatim four-field gate, financial disclaimer;
 *   - the TikTok carousel/static-image rule (skip → markSkipped, or slideshow).
 */

import { toDbPillar } from '../../agents/lib/pillar_translation.js';
import { validateAiMagicGate } from '../../agents/lib/gate_validators.js';
import type { Lifecycle } from '../lifecycle/lifecycle.js';
import {
  CHANNELS,
  type Channel,
  type ChannelPlan,
  type ContentPillar,
  type PostCheckReport,
  type ScheduledPostRow,
} from '../lifecycle/types.js';
import type { RemixEnqueuePlan } from './types.js';

const TIKTOK_PHOTO_UNSUPPORTED = 'tiktok_web_photo_unsupported';
const DISCLAIMER_RE = /not\s+(financial|investment|tax|legal)\s+advice/i;

export interface RemixEnqueueResult {
  contentId: string;
  scheduledPosts: ScheduledPostRow[];
  postCheck: PostCheckReport;
  skipped: Channel[];
}

function resolveScheduledFor(plan: RemixEnqueuePlan, channel: Channel): string | null {
  const s = plan.scheduledFor;
  if (s == null || typeof s === 'string') return (s as string | null) ?? null;
  return s[channel] ?? null;
}

/** Build the per-channel ChannelPlan list, falling back to the base caption. */
function buildChannelPlans(plan: RemixEnqueuePlan, channels: Channel[]): ChannelPlan[] {
  return channels.map((channel) => ({
    channel,
    caption: plan.channelCaptions[channel] ?? plan.baseCaption,
    scheduledFor: resolveScheduledFor(plan, channel),
  }));
}

/** Fail-closed pillar + IP gates run before any write. */
function assertGates(plan: RemixEnqueuePlan, captions: string[]): void {
  const handle = plan.provenance.creatorHandle?.trim();
  if (handle) {
    const bare = handle.replace(/^@/, '').toLowerCase();
    for (const c of captions) {
      if (c.toLowerCase().includes(bare)) {
        throw new Error(
          `[create-from-url] no-credit violation: creator handle "${handle}" appears in a caption — a remix must not credit the source`,
        );
      }
    }
  }
  if (plan.pillar === 'ai_magic') {
    const result = validateAiMagicGate({ ...plan.aiMagic });
    if (!result.ok) {
      throw new Error(`[create-from-url] ${result.reason ?? 'ai_magic_gate_failed'}`);
    }
  }
  if (plan.pillar === 'financial' && !captions.some((c) => DISCLAIMER_RE.test(c))) {
    throw new Error(
      '[create-from-url] financial pillar requires a disclaimer (e.g. "not financial advice") in the caption',
    );
  }
}

/** Which channels must be skipped under the TikTok carousel/static-image rule. */
function tiktokSkips(plan: RemixEnqueuePlan, channels: Channel[]): Channel[] {
  const isPhoto = plan.renderProfileSlug === 'carousel' || plan.renderProfileSlug === 'static-image';
  if (!isPhoto || !channels.includes('tiktok')) return [];
  if ((plan.tiktokCarouselStrategy ?? 'skip') === 'slideshow') {
    throw new Error(
      `[create-from-url] tiktokCarouselStrategy='slideshow' requires a moving-images render; ` +
        `got render_profile_slug='${plan.renderProfileSlug}'. Render the slideshow MP4 as moving-images instead.`,
    );
  }
  return ['tiktok'];
}

export async function enqueueRemix(
  plan: RemixEnqueuePlan,
  lifecycle: Lifecycle,
): Promise<RemixEnqueueResult> {
  if (!plan.provenance?.sourceUrl) {
    throw new Error('[create-from-url] provenance.sourceUrl is required');
  }
  const channels = plan.channels && plan.channels.length > 0 ? plan.channels : [...CHANNELS];
  const channelPlans = buildChannelPlans(plan, channels);

  assertGates(plan, [plan.baseCaption, ...channelPlans.map((c) => c.caption)]);
  const skips = tiktokSkips(plan, channels);

  const metadata: Record<string, unknown> = {
    source: 'create-from-url',
    source_url: plan.provenance.sourceUrl,
    creator_handle: plan.provenance.creatorHandle ?? null,
    ...(plan.aiMagic ? { ai_magic: plan.aiMagic } : {}),
    ...(plan.extraMetadata ?? {}),
  };

  const { contentId, scheduledPosts } = await lifecycle.enqueuePiece({
    renderProfileSlug: plan.renderProfileSlug,
    pillar: toDbPillar(plan.pillar) as ContentPillar,
    hook: plan.hook,
    baseCaption: plan.baseCaption,
    finalAssetUrl: plan.finalAssetUrl,
    renderCompletedAt: plan.renderCompletedAt ?? null,
    approved: plan.approved,
    channels: channelPlans,
    metadata,
  });

  const rowsByChannel = new Map<Channel, ScheduledPostRow>(scheduledPosts.map((r) => [r.channel, r]));
  for (const channel of skips) {
    const result = await lifecycle.markSkipped(contentId, channel, TIKTOK_PHOTO_UNSUPPORTED);
    rowsByChannel.set(channel, result.row);
  }

  const postCheck = await lifecycle.postCheck(contentId, channels);
  const missing = postCheck.channels.filter((c) => c.status === 'missing');
  if (missing.length > 0) {
    throw new Error(
      `[create-from-url] enqueue post-check failed for ${contentId}: missing channel rows ` +
        `[${missing.map((m) => m.channel).join(', ')}]`,
    );
  }
  return { contentId, scheduledPosts: [...rowsByChannel.values()], postCheck, skipped: skips };
}
