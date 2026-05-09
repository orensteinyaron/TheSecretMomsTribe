-- Soft-delete column for content_queue.
--
-- Why a column instead of a 'deleted' status enum value:
--   1. content_status is referenced by 5+ list/filter branches in the
--      content-queue Edge Function plus pillar metrics queries — adding an
--      enum value would force updating every status filter to exclude it.
--   2. Postgres enum values are painful to remove if we ever need to revert.
--   3. A nullable timestamptz preserves WHEN the delete happened (useful for
--      future audit / restore tooling) at the cost of one column.
--
-- Filter contract: every list query in supabase/functions/content-queue/index.ts
-- adds `.is('deleted_at', null)` unless the caller passes ?include_deleted=1.
-- Single-row reads (GET /pieces/:id) intentionally don't filter — direct links
-- to a deleted piece still resolve so a future restore UI can show it.

ALTER TABLE content_queue
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX content_queue_deleted_at_idx
  ON content_queue (deleted_at)
  WHERE deleted_at IS NOT NULL;
