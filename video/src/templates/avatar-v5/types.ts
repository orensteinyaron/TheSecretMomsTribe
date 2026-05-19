// Remotion composition types for Avatar Full v5.
//
// V5Clip carries the Seedance MP4 URL + the crop_offset_y computed by
// transitions-manifest. V5Transition carries the per-cut motion-blur
// gate.
//
// Punch-in (115% scale on emphasis lines) is deferred to v5.1 — no
// punch_in field on V5Clip in v5.0. See docs/specs/AVATAR_FULL_V5.md
// "Follow-ups" section.

export type V5Clip = {
  id: string;
  /** Seedance MP4 with embedded audio. Local path OR https URL. */
  video_url: string;
  /** Effective clip duration in seconds (use Whisper-confirmed duration). */
  duration_s: number;
  /** Pixels to translate vertically — normalizes face position across cuts. */
  crop_offset_y: number;
};

export type V5Transition = {
  cut_index: number;
  /**
   * When true, applies a brief horizontal blur on the boundary (last 2-3 frames
   * of the outgoing clip + first 2-3 frames of the incoming clip). When false,
   * hard cut.
   */
  needs_motion_blur: boolean;
};

export type AvatarV5Props = {
  clips: V5Clip[];
  /** transitions[i] describes the cut between clips[i] and clips[i+1]. */
  transitions: V5Transition[];
  /** Hook text overlaid on top of clip 1. Empty string = no overlay. */
  hook_text: string;
};

export const AVATAR_V5_FPS = 30;
export const AVATAR_V5_WIDTH = 1080;
export const AVATAR_V5_HEIGHT = 1920;
export const AUDIO_BRIDGE_FRAMES = 4;
export const MOTION_BLUR_FRAMES = 3;
