-- Content Regeneration V1 — supersede-flow status.
--
-- When a pre-V1 draft is regenerated under the new rules, the original
-- row is kept (never deleted) and marked 'superseded' so dashboards and
-- downstream consumers know to ignore it. metadata.superseded_by on the
-- original points at the new row; metadata.regenerated_from on the new
-- row points back.

ALTER TYPE content_status ADD VALUE IF NOT EXISTS 'superseded';

-- Allow cost_log rows tagged with the new regen pipeline stage so we can
-- track Haiku + Sonnet spend per regen piece alongside the normal content
-- generation costs.
ALTER TABLE cost_log DROP CONSTRAINT IF EXISTS cost_log_pipeline_stage_check;
ALTER TABLE cost_log ADD CONSTRAINT cost_log_pipeline_stage_check
  CHECK (pipeline_stage = ANY (ARRAY[
    'research', 'content_generation', 'content_regeneration',
    'image_generation', 'image_composition', 'video_generation',
    'scraping', 'learning', 'other'
  ]));
