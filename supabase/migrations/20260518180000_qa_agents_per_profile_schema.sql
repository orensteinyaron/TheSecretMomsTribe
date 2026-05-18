-- QA agents per profile — schema-only migration (PR 0)
--
-- Spec: YAR-129 comment "QA agent architecture update — per-profile agents,
-- expanded dimensions" (2026-05-18T15:18) + critique §C.
--
-- This migration is intentionally code-free. It adds the columns and JSON
-- keys the per-profile QA agents (PRs 1–3) will read at runtime. It does NOT
-- introduce any agent dispatch, scoring, or runtime behavior.
--
-- Three changes:
--   1. New top-level column `render_profiles.qa_stability` (jsonb) carrying
--      `{ state, consecutive_approvals, observation_window_started_at }`.
--      Default state is 'informational' — agents return PASS verdicts as
--      informational only, and `human_review_required` stays true until a
--      profile is promoted to 'decisional' (manual flip, gated on 5
--      consecutive human-approved outputs over a 2-week window per YAR-129).
--
--   2. `render_profiles.output_spec` jsonb extended with four new keys:
--        - filter_setting      — declared color treatment ('none' | 'warm_light' | 'warm_golden')
--        - transition_style    — { type: 'hard_cut' | 'crossfade', duration_s: number }
--        - caption_region      — { top_pct, bottom_pct } where captions render
--        - hook_overlay        — declared hook overlay style (exists flag + spec)
--
--   3. `render_profiles.qa_rules` jsonb extended with three new keys:
--        - in_scope_dimensions       — dims the agent measures + scores
--        - unmeasured_dimensions     — dims declared UNMEASURED (memory rule 30)
--        - out_of_scope_dimensions   — dims that don't apply to this profile
--
-- IMPORTANT: avatar-v1's filter_setting and transition_style reflect PRE-V3
-- reality (warm_light filter, 0.2s crossfade — the state of the active code
-- path on main). The v3 reality update (filter_setting='none',
-- transition_style.type='hard_cut') is gated on human approval of the v3
-- proof loop output and lands as a separate one-line UPDATE after approval.
-- This migration deliberately does NOT pre-empt that decision.
--
-- ask-rachel and avatar-visual are not separate render_profiles rows; they
-- are variants of avatar-v1 keyed by avatar_config.format (and an eventual
-- ask-rachel flag). The qa_rules on the avatar-v1 row below describe the
-- Avatar Full baseline. Variant-specific dimension additions (two-voice
-- presence, 50/50 split timing, etc.) live in agent code (PR 3) layered on
-- top of the baseline declared here.

BEGIN;

-- 1. qa_stability column ----------------------------------------------------

ALTER TABLE render_profiles
  ADD COLUMN qa_stability jsonb NOT NULL DEFAULT
    '{"state":"informational","consecutive_approvals":0,"observation_window_started_at":null}'::jsonb;

COMMENT ON COLUMN render_profiles.qa_stability IS
  'Per-profile QA agent promotion state. state: informational | decisional. '
  'consecutive_approvals: count toward the 5/2-week promotion threshold. '
  'observation_window_started_at: ISO timestamp when current window began, '
  'or null if no window is active. Manual flip per YAR-129.';

-- 2. output_spec JSON updates ----------------------------------------------

-- avatar-v1 — pre-v3 reality (warm_light filter, 0.2s crossfade). The v3
-- update (none / hard_cut) is a separate UPDATE after human approval.
UPDATE render_profiles
SET output_spec = output_spec || jsonb_build_object(
  'filter_setting',   'warm_light',
  'transition_style', jsonb_build_object('type', 'crossfade', 'duration_s', 0.2),
  'caption_region',   jsonb_build_object('top_pct', 70, 'bottom_pct', 92),
  'hook_overlay',     jsonb_build_object(
    'exists',                false,
    'component_path',        'video/src/templates/shared/SMTHookOverlay.tsx',
    'expected_color_hex',    '#63246a',
    'vertical_band_pct',     jsonb_build_array(5, 35),
    'notes',                 'Component lands with v3 merge. Until then QA returns UNMEASURED for hook_overlay_style.'
  )
)
WHERE slug = 'avatar-v1';

-- moving-images — warm filter applied per BrandFilter.tsx; ~0.3s crossfade
-- per CROSSFADE = 9 frames at 30fps in video/scripts/generate-video.ts.
UPDATE render_profiles
SET output_spec = output_spec || jsonb_build_object(
  'filter_setting',   'warm_light',
  'transition_style', jsonb_build_object('type', 'crossfade', 'duration_s', 0.3),
  'caption_region',   jsonb_build_object('top_pct', 40, 'bottom_pct', 75),
  'hook_overlay',     jsonb_build_object(
    'exists',                false,
    'component_path',        'video/src/templates/shared/SMTHookOverlay.tsx',
    'expected_color_hex',    '#63246a',
    'vertical_band_pct',     jsonb_build_array(5, 35),
    'notes',                 'Component lands with v3 merge. Moving Images may adopt the locked overlay; until then QA returns UNMEASURED.'
  )
)
WHERE slug = 'moving-images';

-- static-image — no motion, no audio. caption_region not applicable
-- (text is the image). hook_overlay not applicable.
UPDATE render_profiles
SET output_spec = output_spec || jsonb_build_object(
  'filter_setting',   'none',
  'transition_style', jsonb_build_object('type', 'not_applicable', 'duration_s', 0),
  'caption_region',   null,
  'hook_overlay',     jsonb_build_object('exists', false, 'notes', 'Static image format — no overlay layer.')
)
WHERE slug = 'static-image';

-- carousel — multi-image still set; no motion, no audio. Per-slide layout
-- is part of slide rendering, not a single caption region.
UPDATE render_profiles
SET output_spec = output_spec || jsonb_build_object(
  'filter_setting',   'none',
  'transition_style', jsonb_build_object('type', 'not_applicable', 'duration_s', 0),
  'caption_region',   null,
  'hook_overlay',     jsonb_build_object('exists', false, 'notes', 'Carousel — no separate overlay layer; first-slide hook is the overlay.')
)
WHERE slug = 'carousel';

-- 3. qa_rules JSON updates -------------------------------------------------
--
-- Dimension names are the canonical identifiers the per-profile QA agents
-- emit in their QADimensionResult.name field. Adding or renaming a dimension
-- here is a contract change with PR 1+ agents.
--
-- Three lists per profile:
--   - in_scope_dimensions:     measured + scored every run
--   - unmeasured_dimensions:   acknowledged-not-yet-implemented; return
--                              {status:'UNMEASURED'} with a note. Memory
--                              rule 30: never fabricate a score.
--   - out_of_scope_dimensions: not applicable to this profile; agent should
--                              not even attempt them.

-- avatar-v1 (Avatar Full baseline; ask-rachel / avatar-visual layer on top
-- in agent code per A1/PR 3).
UPDATE render_profiles
SET qa_rules = COALESCE(qa_rules, '{}'::jsonb) || jsonb_build_object(
  'in_scope_dimensions', jsonb_build_array(
    'watermark_compliance',
    'audio_integrity_raw_clips',
    'audio_integrity_final',
    'caption_legibility',
    'color_filter_consistency',
    'transition_style_verification',
    'identity_consistency',
    'identity_markers',
    'hand_naturalism',
    'wardrobe_setting_continuity'
  ),
  'unmeasured_dimensions', jsonb_build_array(
    'lip_sync',
    'hook_overlay_style',
    'register_adherence'
  ),
  'out_of_scope_dimensions', jsonb_build_array(
    'b_roll_relevance',
    'image_coherence',
    'ken_burns_smoothness',
    'phrase_caption_timing',
    'two_voice_presence',
    'turn_taking_alignment',
    'split_timing_verification',
    'visual_segment_relevance',
    'text_on_image_legibility',
    'layout_grid_compliance',
    'slide_narrative_coherence',
    'hook_slide_strength',
    'cta_slide_presence'
  )
)
WHERE slug = 'avatar-v1';

-- moving-images.
UPDATE render_profiles
SET qa_rules = COALESCE(qa_rules, '{}'::jsonb) || jsonb_build_object(
  'in_scope_dimensions', jsonb_build_array(
    'watermark_compliance',
    'audio_integrity_final',
    'caption_legibility',
    'color_filter_consistency',
    'transition_style_verification',
    'b_roll_relevance',
    'image_coherence',
    'ken_burns_smoothness',
    'phrase_caption_timing'
  ),
  'unmeasured_dimensions', jsonb_build_array(
    'hook_overlay_style'
  ),
  'out_of_scope_dimensions', jsonb_build_array(
    'audio_integrity_raw_clips',
    'identity_consistency',
    'identity_markers',
    'hand_naturalism',
    'wardrobe_setting_continuity',
    'lip_sync',
    'register_adherence',
    'two_voice_presence',
    'turn_taking_alignment',
    'split_timing_verification',
    'visual_segment_relevance',
    'text_on_image_legibility',
    'layout_grid_compliance',
    'slide_narrative_coherence',
    'hook_slide_strength',
    'cta_slide_presence'
  )
)
WHERE slug = 'moving-images';

-- static-image.
UPDATE render_profiles
SET qa_rules = COALESCE(qa_rules, '{}'::jsonb) || jsonb_build_object(
  'in_scope_dimensions', jsonb_build_array(
    'watermark_compliance',
    'text_on_image_legibility',
    'layout_grid_compliance'
  ),
  'unmeasured_dimensions', jsonb_build_array(),
  'out_of_scope_dimensions', jsonb_build_array(
    'audio_integrity_raw_clips',
    'audio_integrity_final',
    'caption_legibility',
    'color_filter_consistency',
    'transition_style_verification',
    'identity_consistency',
    'identity_markers',
    'hand_naturalism',
    'wardrobe_setting_continuity',
    'lip_sync',
    'register_adherence',
    'hook_overlay_style',
    'b_roll_relevance',
    'image_coherence',
    'ken_burns_smoothness',
    'phrase_caption_timing',
    'two_voice_presence',
    'turn_taking_alignment',
    'split_timing_verification',
    'visual_segment_relevance',
    'slide_narrative_coherence',
    'hook_slide_strength',
    'cta_slide_presence'
  )
)
WHERE slug = 'static-image';

-- carousel.
UPDATE render_profiles
SET qa_rules = COALESCE(qa_rules, '{}'::jsonb) || jsonb_build_object(
  'in_scope_dimensions', jsonb_build_array(
    'watermark_compliance',
    'slide_narrative_coherence',
    'hook_slide_strength',
    'cta_slide_presence',
    'text_on_image_legibility'
  ),
  'unmeasured_dimensions', jsonb_build_array(),
  'out_of_scope_dimensions', jsonb_build_array(
    'audio_integrity_raw_clips',
    'audio_integrity_final',
    'caption_legibility',
    'color_filter_consistency',
    'transition_style_verification',
    'identity_consistency',
    'identity_markers',
    'hand_naturalism',
    'wardrobe_setting_continuity',
    'lip_sync',
    'register_adherence',
    'hook_overlay_style',
    'b_roll_relevance',
    'image_coherence',
    'ken_burns_smoothness',
    'phrase_caption_timing',
    'two_voice_presence',
    'turn_taking_alignment',
    'split_timing_verification',
    'visual_segment_relevance',
    'layout_grid_compliance'
  )
)
WHERE slug = 'carousel';

-- 4. Defensive: assert the 4 known profiles got updated, fail the
--    migration if any are missing (catches a future profile being added
--    without QA rules; the next per-profile QA agent build would silently
--    treat it as "no in-scope dimensions").
DO $$
DECLARE
  missing_count int;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM render_profiles
  WHERE qa_rules->'in_scope_dimensions' IS NULL
     OR output_spec->'filter_setting' IS NULL
     OR output_spec->'transition_style' IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'qa_agents_per_profile_schema: % render_profiles row(s) missing qa_rules.in_scope_dimensions or output_spec.filter_setting/transition_style after migration', missing_count;
  END IF;
END $$;

COMMIT;
