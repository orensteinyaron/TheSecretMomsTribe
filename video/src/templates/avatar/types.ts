// video/src/templates/avatar/types.ts
import { type PhraseGroup } from "../v2/types";

export const AVATAR_FPS = 30;
export const CROSSFADE_FRAMES = 12; // 0.4s crossfade between clips
export const HOOK_OVERLAY_FRAMES = 90; // 3s hook text
export const CTA_OVERLAY_FRAMES = 90; // 3s CTA text

export type AvatarFormat = "full_avatar" | "avatar_visual";

export type ClipType = "avatar" | "split" | "broll";

export type VisualType = "pexels_image" | "pexels_video";

export interface AvatarClipDef {
  type: ClipType;
  script?: string;
  purpose: string;
  duration_estimate: number;
  visual_query?: string;
  visual_type?: VisualType;
}

export interface AvatarConfig {
  format: AvatarFormat;
  avatar_look: string;
  avatar_background: string;
  voice_id: string;
  duration_target: number;
  clips: AvatarClipDef[];
}

export interface ResolvedClip {
  type: ClipType;
  purpose: string;
  durationSec: number;
  startSec: number;
  videoFile?: string;
  audioSegmentFile?: string;
  script?: string;
  visualFile?: string;
  visualType?: VisualType;
}

export interface AvatarCompositionProps {
  clips: ResolvedClip[];
  phraseTimings: PhraseGroup[];
  hookText: string;
  ctaText: string;
  totalDurationSec: number;
  pillar: string;
  audioFile: string;
}
