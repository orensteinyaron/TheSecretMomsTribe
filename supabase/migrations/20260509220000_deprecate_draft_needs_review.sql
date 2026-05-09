-- Deprecate the 'draft_needs_review' content_status value.
--
-- Background:
--   The 'draft_needs_review' enum value was added by content_quality_v1
--   (20260418130000) to flag pieces failing format gates / caption length /
--   stale primary sources. Five distinct write paths grew to use it
--   (content.js format gates, content.js URL revalidation, caption-retry,
--   ai-magic-content-gen as default, regenerate-stale-drafts on failure).
--
--   The status added no UI affordance the 'draft' status didn't already
--   carry — review action buttons gate on draft anyway, and the StatusBadge
--   had no entry for it. The "why review" payload already lived in
--   metadata.format_flags (array of error tags) and
--   generation_context.needs_review_reason (AI Magic). The status itself
--   was redundant.
--
--   Going forward, every flagged-but-unreviewed piece is plain 'draft'.
--   The piece page renders an inline warning banner whenever
--   metadata.format_flags is non-empty or needs_review_reason is set.
--
-- Why we don't drop the enum value:
--   Postgres enum value removal is destructive (requires rewriting the
--   type with no rows referencing the value, plus rebuilding every
--   dependent column). The cost outweighs the benefit. The value is
--   retained as a tombstone — code MUST NOT write it again.
--
-- Verification: code reviewers should confirm
--   `rg "draft_needs_review" agents/ scripts/ app/ supabase/functions/`
--   returns zero hits after this migration's PR lands.

UPDATE content_queue
SET status = 'draft'
WHERE status = 'draft_needs_review';

COMMENT ON TYPE content_status IS
  'Pipeline status for content_queue rows. NOTE: ''draft_needs_review'' is DEPRECATED — use ''draft'' plus metadata.format_flags / generation_context.needs_review_reason for review context. Existing enum value retained because Postgres enum value removal is destructive.';
