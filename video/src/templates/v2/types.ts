// V2 Karaoke Slideshow — Shared types and constants

export const FPS = 30;
export const HOOK_FRAMES = 120;    // 4 seconds
export const CTA_FRAMES = 150;     // 5 seconds
export const BG_CROSSFADE = 6;     // 0.2s between visual segments
export const PHRASE_CROSSFADE = 4;  // ~0.13s between caption phrases

export const BRAND_PINK = "#b74780";
export const BRAND_PURPLE = "#63246a";
export const TEXT_SHADOW = "0 2px 8px rgba(0,0,0,0.8), 0 0 30px rgba(0,0,0,0.4)";

export const PILLAR_COLORS: Record<string, { bg: string; accent: string; warm: string }> = {
  parenting_insights: { bg: "#63246a", accent: "#b74780", warm: "#8b3a6b" },
  ai_magic: { bg: "#1a1a2e", accent: "#b74780", warm: "#2a1a3e" },
  mom_health: { bg: "#63246a", accent: "#e8a0bf", warm: "#7a3a6b" },
  default: { bg: "#63246a", accent: "#b74780", warm: "#8b3a6b" },
};

export type AudioMode = "voice" | "sound" | "hybrid";

export type MotionType = "ZOOM_IN" | "ZOOM_OUT" | "PAN_LEFT" | "PAN_RIGHT" | "PAN_UP" | "TILT";
export const MOTION_TYPES: MotionType[] = ["ZOOM_IN", "ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "TILT"];

// ---- Visual Segment Types ----

export type SegmentMediaType = "photo" | "video" | "zoom_cut" | "black_flash";

export interface VisualSegment {
  type: SegmentMediaType;
  file: string;           // filename in public/
  startTime: number;      // seconds from video start
  endTime: number;
  motionType?: MotionType; // for photos
  zoomLevel?: number;      // for zoom_cut (e.g. 1.3)
}

// ---- Phrase Captions ----

export interface PhraseGroup {
  words: string;          // 2-4 words displayed on screen
  emphasis: boolean;      // power word — bigger, pink, scale pop
  startTime: number;      // seconds from audio start
  endTime: number;
}

// ---- Slide Data ----

export interface SlideData {
  text: string;           // full slide text
  phraseGroups: PhraseGroup[];
  visualSegments: VisualSegment[];
  pexelsQueries: string[]; // 3 search queries for media sourcing
}

// ---- Composition Props ----

export interface KaraokeSlideshowProps {
  hookText: string;
  hookImage: string;      // filename in public/
  slides: SlideData[];
  ctaText: string;
  ctaStartSec?: number;   // when CTA slide appears (absolute seconds from video start)
  pillar: string;
  audioMode: AudioMode;
  voiceoverFile: string;  // filename in public/
  totalDuration: number;  // seconds
}
