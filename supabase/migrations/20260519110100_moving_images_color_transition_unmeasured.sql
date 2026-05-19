-- Move color_filter_consistency and transition_style_verification from
-- in_scope_dimensions to unmeasured_dimensions on the moving-images row.
--
-- Reason: both dims' base implementations (PR 1) require raw-clip
-- metadata (raw mp4 URLs + start_offset_in_final_s) to compare against
-- the composited output. Avatar Full has raw Seedance clips that match
-- this shape; Moving Images does not — its inputs are Pexels images,
-- not raw clips, and the pipeline doesn't persist per-slide source URLs
-- as QA inputs.
--
-- Profile-specific implementations could be built:
--   - color: re-fetch the original Pexels image and compare to the
--     composited slide's mid-frame.
--   - transition: reconstruct slide boundaries from frame-diff peaks
--     (same algorithm slide-segmentation.ts uses), then sample the 5-
--     frame signature at each.
--
-- Both deferred to a follow-up PR. Until then, schema reflects the
-- intent (memory rule 30) and graduates via a single SQL UPDATE when
-- the profile-specific dim implementations land.

UPDATE render_profiles
SET qa_rules = jsonb_set(
  jsonb_set(
    qa_rules,
    '{in_scope_dimensions}',
    (SELECT jsonb_agg(d) FROM jsonb_array_elements_text(qa_rules->'in_scope_dimensions') d WHERE d NOT IN ('color_filter_consistency','transition_style_verification'))
  ),
  '{unmeasured_dimensions}',
  qa_rules->'unmeasured_dimensions' || '["color_filter_consistency","transition_style_verification"]'::jsonb
)
WHERE slug = 'moving-images';

DO $$
DECLARE
  in_scope_has int;
  unmeasured_has int;
BEGIN
  SELECT COUNT(*) INTO in_scope_has
  FROM render_profiles, jsonb_array_elements_text(qa_rules->'in_scope_dimensions') d
  WHERE slug = 'moving-images' AND d IN ('color_filter_consistency','transition_style_verification');
  SELECT COUNT(*) INTO unmeasured_has
  FROM render_profiles, jsonb_array_elements_text(qa_rules->'unmeasured_dimensions') d
  WHERE slug = 'moving-images' AND d IN ('color_filter_consistency','transition_style_verification');
  IF in_scope_has > 0 OR unmeasured_has < 2 THEN
    RAISE EXCEPTION 'moving_images_color_transition_unmeasured: post-state wrong (in_scope=%, unmeasured=%)', in_scope_has, unmeasured_has;
  END IF;
END $$;
