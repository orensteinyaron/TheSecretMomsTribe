// Inputs the entry point feeds each profile agent.
//
// Every profile agent receives the same QAInput shape. Fields the profile
// doesn't need are simply ignored. Fields a profile NEEDS that are missing
// cause the dimension that needs them to short-circuit to UNMEASURED with a
// clear "metadata not provided" note — never to a fabricated verdict.

export type TransitionStyle =
  | { type: "hard_cut"; duration_s: 0 }
  | { type: "crossfade"; duration_s: number }
  | { type: "not_applicable"; duration_s: 0 };

export type FilterSetting = "none" | "warm_light" | "warm_golden";

export type RenderProfileConfig = {
  slug: string;
  status: string;
  output_spec: {
    fps?: number;
    dimensions?: { width: number; height: number };
    filter_setting: FilterSetting;
    transition_style: TransitionStyle;
    caption_region: { top_pct: number; bottom_pct: number } | null;
    hook_overlay: {
      exists: boolean;
      component_path?: string;
      expected_color_hex?: string;
      vertical_band_pct?: [number, number];
      notes?: string;
    };
  };
  qa_rules: {
    in_scope_dimensions: string[];
    unmeasured_dimensions: string[];
    out_of_scope_dimensions: string[];
  };
  qa_stability: {
    state: "informational" | "decisional";
    consecutive_approvals: number;
    observation_window_started_at: string | null;
  };
};

export type ClipMeta = {
  id: string; // e.g. "SCENE_01"
  url?: string; // raw clip URL (avatar pipeline; null for moving images)
  local_path?: string; // post-download path
  expected_script: string; // verbatim ElevenLabs / TTS script for this clip
  duration_s: number;
  start_offset_in_final_s?: number; // cumulative position in final video
};

export type QAInput = {
  asset_id: string | null;
  asset_path: string; // final composited MP4/PNG (local path)
  profile_config: RenderProfileConfig;
  variant: string | null; // avatar_config.format ('full_avatar' | 'avatar_visual') or null
  reference_image_url?: string; // Soul still for avatar profiles
  reference_image_path?: string; // populated after download by entry point
  clips?: ClipMeta[]; // raw clips for profiles that produce them
  hook_overlay_text?: { line1: string; line2?: string };
  hook_card_image_url?: string; // for static-image profile
  carousel_slide_paths?: string[]; // for carousel profile
  // Working directory for frame extraction, audio extraction, intermediate files.
  // The entry point creates and tears this down.
  workdir: string;
};

// Agent version is per-profile, bumped on behavior changes that would invalidate
// a prior promotion. Format: <profile-slug>@<yyyy-mm-dd-rev>.
export const AGENT_VERSION = {
  base: "base@2026-05-19-1",
  avatar_full: "avatar-full@2026-05-19-1",
  moving_images: "moving-images@2026-05-19-1",
  ask_rachel: "ask-rachel@2026-05-19-1",
  avatar_visual: "avatar-visual@2026-05-19-1",
  static_image: "static-image@2026-05-19-1",
  carousel: "carousel@2026-05-19-1",
} as const;
