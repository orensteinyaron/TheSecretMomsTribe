-- Add qa_rules.gated_dimensions[] to render_profiles.
--
-- A "gated dimension" is one that is in-scope (the agent measures it and the
-- result is meaningful) but whose verdict should NOT fail the overall report
-- because the rendered output is known-stale relative to the declared
-- output_spec — typically because we're waiting on a manual sign-off that
-- will update the declared values.
--
-- Concrete case (today, 2026-05-19): avatar-v1.output_spec declares pre-v3
-- reality (filter_setting='warm_light', transition_style.duration_s=0.2).
-- The v3 proof loop produced output that's filter='none' + hard-cut. The
-- declared values flip to v3 reality only after Yaron approves v3. Until
-- then, color_filter_consistency and transition_style_verification will
-- FAIL on v3-style output — but that FAIL is "system state pending update,"
-- not "asset is broken."
--
-- Treatment in the agent (PR 1 patch): when a dimension's canonical name is
-- in render_profiles.qa_rules.gated_dimensions, the agent runs the
-- dimension (so the diff details remain visible in the report) but remaps
-- any FAIL result to UNMEASURED with a note explaining the gate. PASS
-- results are emitted as PASS. UNMEASURED stays UNMEASURED.
--
-- Promotion path: when the underlying gate is cleared (e.g. v3 approval),
-- a follow-up UPDATE removes the dim from gated_dimensions[] and updates
-- output_spec to match the new reality. The dim returns to fully in-scope
-- with a single SQL UPDATE; no agent rewrite required.

BEGIN;

-- Add gated_dimensions[] to all 4 existing rows, defaulting to []. Then
-- seed avatar-v1 with the two dims that are gated on v3 reality update.
UPDATE render_profiles
SET qa_rules = COALESCE(qa_rules, '{}'::jsonb) || jsonb_build_object(
  'gated_dimensions', '[]'::jsonb
);

UPDATE render_profiles
SET qa_rules = jsonb_set(
  qa_rules,
  '{gated_dimensions}',
  '["color_filter_consistency","transition_style_verification"]'::jsonb
)
WHERE slug = 'avatar-v1';

-- Defensive: every row must have gated_dimensions[]. Future profiles
-- without this key would silently skip the gating logic.
DO $$
DECLARE
  missing_count int;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM render_profiles
  WHERE qa_rules->'gated_dimensions' IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'qa_rules_gated_dimensions: % row(s) missing qa_rules.gated_dimensions after migration', missing_count;
  END IF;
END $$;

COMMIT;
