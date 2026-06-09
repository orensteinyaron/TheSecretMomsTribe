/**
 * FORMAT → media-type matrix (skill §3), for the Phase 1 browser path.
 *
 * | render profile | instagram | tiktok (browser)                       |
 * | avatar-v1      | video     | video                                  |
 * | moving-images  | video     | video                                  |
 * | carousel       | carousel  | NOT SUPPORTED → skip / slideshow       |
 * | static-image   | image     | NOT SUPPORTED → skip / slideshow       |
 *
 * The TikTok web uploader is video-only — no Photo Mode on desktop — so carousel
 * and static-image cannot post to TikTok via the browser. Default: skip the
 * TikTok channel with reason `tiktok_web_photo_unsupported`. `slideshow` is a
 * flagged alternative (render the slides as a vertical MP4 and upload as video);
 * it is left as an explicit opt-in, not the default.
 */

import type { Channel, RenderProfileSlug } from '../lifecycle/types.js';
import type { MediaPlan } from './types.js';

export const TIKTOK_PHOTO_UNSUPPORTED = 'tiktok_web_photo_unsupported';

export interface MediaMatrixOptions {
  /** If true, a TikTok carousel/static-image is uploaded as a slideshow MP4 video. */
  tiktokSlideshow?: boolean;
}

export function resolveMedia(
  renderProfileSlug: RenderProfileSlug | null,
  channel: Channel,
  opts: MediaMatrixOptions = {},
): MediaPlan {
  if (renderProfileSlug === 'avatar-v1' || renderProfileSlug === 'moving-images') {
    return { channel, action: 'video' };
  }
  if (renderProfileSlug === 'carousel') {
    if (channel === 'instagram') return { channel, action: 'carousel' };
    return opts.tiktokSlideshow
      ? { channel, action: 'video' }
      : { channel, action: 'skip', reason: TIKTOK_PHOTO_UNSUPPORTED };
  }
  if (renderProfileSlug === 'static-image') {
    if (channel === 'instagram') return { channel, action: 'image' };
    return opts.tiktokSlideshow
      ? { channel, action: 'video' }
      : { channel, action: 'skip', reason: TIKTOK_PHOTO_UNSUPPORTED };
  }
  return { channel, action: 'skip', reason: 'unknown_render_profile' };
}
