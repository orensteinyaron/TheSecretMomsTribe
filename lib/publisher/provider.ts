/**
 * Provider seam (skill §8) — swappable channel implementations.
 *
 * Phase 1 ships ONLY the browser-assisted provider. The API provider (IG Graph
 * container flow, TikTok FILE_UPLOAD/SELF_ONLY) is Phase 2 and is intentionally
 * NOT implemented here — the seam exists so it can drop in without a rewrite.
 *
 * Critically, a provider has no "publish" method. `buildStagingPlan` returns
 * everything needed to STAGE a post up to (not including) the publish button.
 * For the browser provider, the actual composer driving is performed live by
 * Claude in Chrome from this plan; the human clicks publish. Stopping at the
 * button is structural — there is nothing here that clicks.
 */

import type { Channel } from '../lifecycle/types.js';
import type { MediaPlan, StagingPlan } from './types.js';

export interface BuildStagingInput {
  contentId: string;
  channel: Channel;
  /** Local temp path of the downloaded asset. */
  assetPath: string;
  /** IG only: local temp path of the downloaded cover image (cover_asset_url). */
  coverAssetPath?: string | null;
  caption: string;
  media: MediaPlan;
}

export interface PublishProvider {
  readonly kind: 'browser' | 'api';
  buildStagingPlan(input: BuildStagingInput): StagingPlan;
}

/** Where the browser agent opens each platform's composer. */
export const COMPOSER_URLS: Record<Channel, string> = {
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/upload',
};

export class BrowserAssistedProvider implements PublishProvider {
  readonly kind = 'browser' as const;

  buildStagingPlan(input: BuildStagingInput): StagingPlan {
    return {
      contentId: input.contentId,
      channel: input.channel,
      composerUrl: COMPOSER_URLS[input.channel],
      assetPath: input.assetPath,
      coverAssetPath: input.coverAssetPath ?? null,
      caption: input.caption,
      media: input.media,
      stopAtPublish: true,
    };
  }
}

/**
 * Phase 2 — deterministic API publishing. Not implemented in Phase 1; present
 * only to document the seam. Building this is gated on the IG `instagram_business_content_publish`
 * and TikTok `video.publish` approvals (skill §8).
 */
export class ApiPublishProvider implements PublishProvider {
  readonly kind = 'api' as const;
  buildStagingPlan(): StagingPlan {
    throw new Error('[publisher] ApiPublishProvider is Phase 2 and not implemented');
  }
}
