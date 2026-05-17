-- Channels backfill — populate scheduled_posts + soft-delete 6 orphans
-- Spec: docs/specs/CHANNEL_MODEL_V1.md §3.1 (backfill), Q2/Q3 decisions
-- Linear: YAR-119 (parent: YAR-117)
--
-- Idempotent. Current data state: 0 rows have any populated inline columns,
-- so the INSERT statements are effectively no-ops, but we keep them for safety.
-- The soft-delete touches 6 truly-orphan rows (null post_format + null render_profile_id).

BEGIN;

-- TikTok channel backfill (idempotent: skip if row already exists)
INSERT INTO scheduled_posts (content_id, channel, scheduled_for, published_at, post_url, status, created_at, updated_at)
SELECT
  cq.id,
  'tiktok',
  cq.scheduled_at_tt,
  cq.published_at_tt,
  cq.published_url_tt,
  CASE
    WHEN cq.published_at_tt IS NOT NULL THEN 'posted'
    WHEN cq.scheduled_at_tt IS NOT NULL THEN 'scheduled'
    ELSE 'pending'
  END,
  NOW(),
  NOW()
FROM content_queue cq
WHERE (cq.scheduled_at_tt IS NOT NULL OR cq.published_at_tt IS NOT NULL OR cq.published_url_tt IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp
    WHERE sp.content_id = cq.id AND sp.channel = 'tiktok'
  );

-- Instagram channel backfill
INSERT INTO scheduled_posts (content_id, channel, scheduled_for, published_at, post_url, status, created_at, updated_at)
SELECT
  cq.id,
  'instagram',
  cq.scheduled_at_ig,
  cq.published_at_ig,
  cq.published_url_ig,
  CASE
    WHEN cq.published_at_ig IS NOT NULL THEN 'posted'
    WHEN cq.scheduled_at_ig IS NOT NULL THEN 'scheduled'
    ELSE 'pending'
  END,
  NOW(),
  NOW()
FROM content_queue cq
WHERE (cq.scheduled_at_ig IS NOT NULL OR cq.published_at_ig IS NOT NULL OR cq.published_url_ig IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp
    WHERE sp.content_id = cq.id AND sp.channel = 'instagram'
  );

-- Soft-delete the 6 truly-orphan null-format rows (all created 2026-04-02 to 2026-04-03).
-- The 1 backfilled avatar-v1 showcase row (PR #21) is intentionally excluded:
-- it has render_profile_id set even though post_format is null.
UPDATE content_queue
SET deleted_at = NOW()
WHERE post_format IS NULL
  AND render_profile_id IS NULL
  AND deleted_at IS NULL;

COMMIT;
