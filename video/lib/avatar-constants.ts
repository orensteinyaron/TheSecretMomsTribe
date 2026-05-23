// Soul-canonical Rachel + Avatar Full pipeline defaults.
//
// Single source of truth — referenced by:
//   - video/scripts/generate-hook-card.ts (hook card background)
//   - video/lib/seedance/* (start_image for Seedance generation)
//   - video/lib/elevenlabs-per-clip.ts (voice id)
//   - video/scripts/render-avatar-full-v5.ts (defaults)
//
// The Soul still ID + URL are the canonical Rachel reference as backfilled
// in docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md and used by QA for identity
// consistency scoring.

export const RACHEL_SOUL_STILL_ID = "f757b09c-d94d-4ade-a076-4a1a496c641e";

export const RACHEL_SOUL_STILL_URL =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png";

export const RACHEL_ELEVENLABS_VOICE_ID = "tRhabdS7JjlQ0lVEImuM";

export const AVATAR_V5_DEFAULTS = {
  aspect_ratio: "9:16" as const,
  resolution: "1080p" as const,
  mode: "std" as const,
  duration_per_clip_s: 8,
} as const;
