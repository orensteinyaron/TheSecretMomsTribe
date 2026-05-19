// Canonical dimension status values.
//
// PASS / FAIL: the agent measured the dimension and reached a verdict.
// UNMEASURED: the agent acknowledges this dimension as in-spec but cannot
// currently measure it (waiting on upstream pipeline, separate spike, etc.).
// Never returned as a fabricated score. Memory rule 30.
export type DimensionStatus = "PASS" | "FAIL" | "UNMEASURED";

// Every dimension implementation returns a DimensionResult. The agent
// aggregates these into a QAReport.
//
// score is optional and only meaningful for numeric dimensions (e.g.
// identity_consistency 0-5). For PASS/FAIL-only dimensions, leave it
// undefined.
export type DimensionResult = {
  name: string;
  status: DimensionStatus;
  score?: number;
  details: string;
  evidence?: string[];
  // call_costs is populated by dimensions that make LLM/Whisper/API calls.
  // The base aggregator sums these into the report-level cost breakdown.
  call_costs?: DimensionCall[];
};

export type DimensionCall = {
  service: "anthropic" | "openai_whisper";
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  audio_seconds?: number;
  cost_usd: number;
};

// A dimension is a function from inputs to a result. Implementations live
// under dimensions/base/* and dimensions/avatar-full/*.
export type DimensionFn<Input> = (input: Input) => Promise<DimensionResult>;

// Canonical names — the strings the agent emits in DimensionResult.name and
// the strings declared in render_profiles.qa_rules.in_scope_dimensions. Keep
// in sync with the migration in supabase/migrations/.
export const DIMENSION_NAMES = {
  // Base
  watermark_compliance: "watermark_compliance",
  audio_integrity_raw_clips: "audio_integrity_raw_clips",
  audio_integrity_final: "audio_integrity_final",
  caption_legibility: "caption_legibility",
  color_filter_consistency: "color_filter_consistency",
  transition_style_verification: "transition_style_verification",
  hook_overlay_style: "hook_overlay_style",

  // Avatar Full
  identity_consistency: "identity_consistency",
  identity_markers: "identity_markers",
  hand_naturalism: "hand_naturalism",
  wardrobe_setting_continuity: "wardrobe_setting_continuity",
  cross_clip_drift: "cross_clip_drift",
  lip_sync: "lip_sync",
  register_adherence: "register_adherence",

  // Moving Images
  b_roll_relevance: "b_roll_relevance",
  image_coherence: "image_coherence",
  ken_burns_smoothness: "ken_burns_smoothness",
  phrase_caption_timing: "phrase_caption_timing",

  // Ask Rachel
  two_voice_presence: "two_voice_presence",
  turn_taking_alignment: "turn_taking_alignment",

  // Avatar + Visual
  split_timing_verification: "split_timing_verification",
  visual_segment_relevance: "visual_segment_relevance",

  // Static Image
  text_on_image_legibility: "text_on_image_legibility",
  layout_grid_compliance: "layout_grid_compliance",

  // Carousel
  slide_narrative_coherence: "slide_narrative_coherence",
  hook_slide_strength: "hook_slide_strength",
  cta_slide_presence: "cta_slide_presence",
} as const;

export type DimensionName = keyof typeof DIMENSION_NAMES;
