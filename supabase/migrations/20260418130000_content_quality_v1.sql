-- Content Quality V1 — source URL traceability, format-fail review status,
-- and audit table.
--
-- Before this migration:
--   - content_queue.source_urls was a jsonb array of {url, source} objects.
--     Spec requires per-URL traceability to the specific research signal
--     (signal_id) plus a `relation` tag (primary_inspiration |
--     supporting_context | viral_reference).
--   - content_status enum had no value for posts that fail format gates
--     (caption too long, wrong slide count, stale primary source).
--
-- This migration:
--   1. Adds 'draft_needs_review' to the content_status enum so the content
--      agent can flag posts that need Yaron's attention without silently
--      shipping broken format.
--   2. Rewrites existing content_queue.source_urls values to the new shape.
--      Existing rows default to relation='primary_inspiration' (best
--      assumption — they were stored as the primary source) and
--      signal_id=null (no IDs existed before).
--   3. Creates content_source_audit for the retro-audit pass (spec §5.4)
--      so mismatches can be flagged for Yaron's review without auto-delete.

-- 0. Extend content_status enum. ADD VALUE IF NOT EXISTS is idempotent.
ALTER TYPE content_status ADD VALUE IF NOT EXISTS 'draft_needs_review';

-- 0.5. Defensive: the source_urls and avatar_config columns were added to
-- production directly (outside the migrations/ tree). IF NOT EXISTS keeps
-- this a no-op on main while making the migration self-contained on a
-- fresh branch.
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS source_urls jsonb DEFAULT '[]'::jsonb;
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS avatar_config jsonb;

-- 1. Rewrite existing source_urls entries.
UPDATE content_queue
SET source_urls = (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'url',       COALESCE(elem->>'url', ''),
      'source',    COALESCE(elem->>'source', 'unknown'),
      'signal_id', elem->'signal_id',              -- NULL if absent
      'relation',  COALESCE(elem->>'relation', 'primary_inspiration')
    )
  ), '[]'::jsonb)
  FROM jsonb_array_elements(source_urls) elem
  WHERE jsonb_typeof(elem) = 'object' AND COALESCE(elem->>'url', '') <> ''
)
WHERE source_urls IS NOT NULL
  AND jsonb_typeof(source_urls) = 'array'
  AND jsonb_array_length(source_urls) > 0;

-- 2. Retro-audit table for the one-shot topical-match spot check.
CREATE TABLE IF NOT EXISTS content_source_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid REFERENCES content_queue(id) ON DELETE CASCADE,
  source_url   text NOT NULL,
  match_verdict text NOT NULL CHECK (match_verdict IN ('match', 'mismatch', 'unclear')),
  reasoning    text,
  audited_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_source_audit_content_id_idx
  ON content_source_audit(content_id);

CREATE INDEX IF NOT EXISTS content_source_audit_verdict_idx
  ON content_source_audit(match_verdict);

COMMENT ON TABLE content_source_audit IS
  'Retro-audit of content_queue.source_urls topical match. Populated by a ' ||
  'one-shot Haiku spot-check script; mismatches get reviewed by Yaron.';
