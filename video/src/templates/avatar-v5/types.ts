// Remotion composition types for Avatar Full v5.
//
// V5Clip carries the Seedance MP4 URL + the crop_offset_y computed by
// transitions-manifest. V5Transition carries the per-cut motion-blur
// gate.
//
// Punch-in (115% scale on emphasis lines) is deferred to v5.1 — no
// punch_in field on V5Clip in v5.0. See docs/specs/AVATAR_FULL_V5.md
// "Follow-ups" section.

import type { Phrase } from "../../../lib/phrase-grouper.js";

export type V5Clip = {
  id: string;
  /** Seedance MP4 with embedded audio. Local path OR https URL. */
  video_url: string;
  /** Effective clip duration in seconds (use Whisper-confirmed duration). */
  duration_s: number;
  /** Pixels to translate vertically — normalizes face position across cuts. */
  crop_offset_y: number;
  /**
   * Phrase captions for this clip. Clip-local timing (start_s 0 = clip start).
   * Empty array = no captions on this clip.
   */
  phrases?: Phrase[];
};

export type V5Transition = {
  cut_index: number;
  /**
   * When true, applies a brief horizontal blur on the boundary (last 2-3 frames
   * of the outgoing clip + first 2-3 frames of the incoming clip). When false,
   * hard cut.
   */
  needs_motion_blur: boolean;
  /**
   * When true (default), clip N+1 starts AUDIO_BRIDGE_FRAMES before clip N's
   * nominal end → ~133 ms audio mix at the cut. When false, strict hard cut at
   * the boundary. Per-cut so Phase 9 acceptance review can disable specific
   * bridges that sound rough without dropping the bridge globally.
   */
  bridge_enabled?: boolean;
};

export type AvatarV5Props = {
  clips: V5Clip[];
  /** transitions[i] describes the cut between clips[i] and clips[i+1]. */
  transitions: V5Transition[];
  /**
   * Hook overlay primary line (dominant — UPPERCASED by the renderer).
   * Empty string = no overlay. See video/src/templates/shared/SMTHookOverlay.tsx
   * for the locked design (full-width #63246a block, lower-middle, 1.0s hard cut).
   */
  hook_primary: string;
  /** Optional secondary line, smaller. */
  hook_secondary?: string;
};

export const AVATAR_V5_FPS = 30;
export const AVATAR_V5_WIDTH = 1080;
export const AVATAR_V5_HEIGHT = 1920;
export const AUDIO_BRIDGE_FRAMES = 4;
export const MOTION_BLUR_FRAMES = 3;
