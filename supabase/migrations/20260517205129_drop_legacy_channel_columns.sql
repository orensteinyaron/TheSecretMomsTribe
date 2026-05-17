-- Drop legacy channel and format columns from content_queue.
-- These were superseded by render_profile_id (format) + scheduled_posts
-- table (channels). This is the final, destructive step of the channel
-- model v2.0.0 rollout per docs/specs/CHANNEL_MODEL_V1.md §3.1 Migration 4.
--
-- Linear: YAR-125 (gated migration). Gated on Skills v2.0.0 + channel
-- model v2.0.0 being verified live (Run #669 produced clean
-- scheduled_posts rows end-to-end: 5 content_queue × 2 channels = 10
-- scheduled_posts rows, all captioned, zero rejections).
--
-- Pre-flight checks at execution time (2026-05-17):
--   - 0 content_queue rows in last 24h had post_format set
--   - 0 content_queue rows in last 24h had any inline channel column set
--   - 0 non-deleted content_queue rows missing render_profile_id
--   - 0 unallowed code references to the dropped columns
--
-- This is irreversible. There is no rollback that recovers the dropped
-- column data without restoring from backup.

BEGIN;

ALTER TABLE content_queue
  DROP COLUMN IF EXISTS post_format,
  DROP COLUMN IF EXISTS scheduled_at_ig,
  DROP COLUMN IF EXISTS scheduled_at_tt,
  DROP COLUMN IF EXISTS published_at_ig,
  DROP COLUMN IF EXISTS published_at_tt,
  DROP COLUMN IF EXISTS published_url_ig,
  DROP COLUMN IF EXISTS published_url_tt,
  DROP COLUMN IF EXISTS channel_override,
  DROP COLUMN IF EXISTS content_format_id;

DROP TYPE IF EXISTS post_format;

COMMIT;
