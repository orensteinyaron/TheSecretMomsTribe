// Avatar Full pipeline constants.
//
// Referenced by:
//   - video/lib/elevenlabs-per-clip.ts (RACHEL_ELEVENLABS_VOICE_ID)
//   - video/scripts/render-avatar-full-v5.ts (AVATAR_V5_DEFAULTS)
//   - video/lib/location/flows/generate-anchored-still.ts (RACHEL_SOUL_ID via re-export from wardrobe-rotation)
//   - video/lib/wardrobe-rotation/flows/bootstrap-canon-look.ts (re-exports RACHEL_SOUL_ID)
//
// PR-B (YAR-136): removed RACHEL_SOUL_STILL_ID and RACHEL_SOUL_STILL_URL.
// Those were the single canonical Rachel reference; every v5 render now
// resolves its own start_image_url via pickCombination + Soul-pass-through
// (see video/lib/v5-init-combination.ts) and stores the result in
// rachel_stills.soul_still_url per (look_id, location_id) combo.

/** Higgsfield Soul 2.0 character ID for Rachel. Source of identity lock. */
export const RACHEL_SOUL_ID = "34a349a6-d6d9-423f-8c80-e4b4c8d6e770";

export const RACHEL_ELEVENLABS_VOICE_ID = "tRhabdS7JjlQ0lVEImuM";

export const AVATAR_V5_DEFAULTS = {
  aspect_ratio: "9:16" as const,
  resolution: "1080p" as const,
  mode: "std" as const,
  duration_per_clip_s: 8,
} as const;
