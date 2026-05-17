-- Drop legacy unique index inherited from the published_posts → scheduled_posts
-- rename. Rename two surviving published_posts_* indexes to match the new
-- table name.
--
-- Spec: docs/specs/CHANNEL_MODEL_V1.md (gap retroactively closed)
-- Linear: YAR-117 (parent) — Issue 1 follow-up after Run #667
--
-- Postgres carries indexes across `ALTER TABLE RENAME`. Migration 1
-- (20260517163000_channels_model_v1.sql) added the new composite UNIQUE
-- (content_id, channel) but did not drop the legacy single-column unique
-- index on (content_id). Result: every batch insert of 2+ rows per
-- content_id (one per channel) collides on the legacy index, the batch
-- rolls back atomically, and zero rows persist. Run #667 surfaced this:
-- 5 content_queue rows landed, 0 scheduled_posts rows landed, no
-- escalation (writeScheduledPosts logged + returned silently).

BEGIN;

-- The cause. This single-column unique-on-content_id index permitted
-- only one row per piece — fine for the old "what got published" semantics
-- of published_posts, fatal for the new "per-channel state" semantics of
-- scheduled_posts.
DROP INDEX IF EXISTS idx_published_posts_content;

-- Cosmetic cleanup: rename leftover index names to match the new table.
ALTER INDEX IF EXISTS idx_published_posts_published_at RENAME TO idx_scheduled_posts_published_at;
ALTER INDEX IF EXISTS published_posts_pkey            RENAME TO scheduled_posts_pkey;

COMMIT;
