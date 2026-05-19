-- Move phrase_caption_timing from in_scope_dimensions to
-- unmeasured_dimensions on the moving-images row. The dim's implementation
-- returns UNMEASURED until the OCR helper lands (PR 2 scope cut to keep the
-- "3-day" estimate). Schema reflects the intent per memory rule 30.
--
-- Graduates via a single follow-up UPDATE when the OCR helper ships.

UPDATE render_profiles
SET qa_rules = jsonb_set(
  jsonb_set(
    qa_rules,
    '{in_scope_dimensions}',
    (SELECT jsonb_agg(d) FROM jsonb_array_elements_text(qa_rules->'in_scope_dimensions') d WHERE d != 'phrase_caption_timing')
  ),
  '{unmeasured_dimensions}',
  qa_rules->'unmeasured_dimensions' || '["phrase_caption_timing"]'::jsonb
)
WHERE slug = 'moving-images';

-- Defensive: confirm the dim moved.
DO $$
DECLARE
  in_scope_has int;
  unmeasured_has int;
BEGIN
  SELECT COUNT(*) INTO in_scope_has
  FROM render_profiles, jsonb_array_elements_text(qa_rules->'in_scope_dimensions') d
  WHERE slug = 'moving-images' AND d = 'phrase_caption_timing';
  SELECT COUNT(*) INTO unmeasured_has
  FROM render_profiles, jsonb_array_elements_text(qa_rules->'unmeasured_dimensions') d
  WHERE slug = 'moving-images' AND d = 'phrase_caption_timing';
  IF in_scope_has > 0 OR unmeasured_has = 0 THEN
    RAISE EXCEPTION 'moving_images_phrase_caption_timing_unmeasured: post-migration state wrong (in_scope=%, unmeasured=%)', in_scope_has, unmeasured_has;
  END IF;
END $$;
