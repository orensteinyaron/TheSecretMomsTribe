-- Channel model v1 — evolve published_posts → scheduled_posts
-- Spec: docs/specs/CHANNEL_MODEL_V1.md §3.1
-- Linear: YAR-118 (parent: YAR-117)
--
-- Non-destructive: 0 rows in published_posts, 0 rows write to inline channel columns.
-- The next migration (20260517164000_channels_backfill.sql) handles backfill + orphan soft-delete.

BEGIN;

-- 1. Rename enum type platform → channel for naming consistency.
--    The enum currently holds values ('instagram', 'tiktok') which already match channel semantics.
ALTER TYPE platform RENAME TO channel;

-- 2. Make published_at nullable (pending/scheduled rows don't have it yet)
ALTER TABLE published_posts ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE published_posts ALTER COLUMN published_at DROP DEFAULT;

-- 3. Rename columns to new semantics
ALTER TABLE published_posts RENAME COLUMN platform_post_id TO external_post_id;
ALTER TABLE published_posts RENAME COLUMN platform TO channel;

-- 4. Add new columns
ALTER TABLE published_posts
  ADD COLUMN caption        TEXT,
  ADD COLUMN scheduled_for  TIMESTAMPTZ,
  ADD COLUMN status         TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','scheduled','posted','failed','skipped')),
  ADD COLUMN failure_reason TEXT,
  ADD COLUMN updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 5. updated_at trigger
CREATE OR REPLACE FUNCTION touch_scheduled_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_posts_updated_at
  BEFORE UPDATE ON published_posts
  FOR EACH ROW EXECUTE FUNCTION touch_scheduled_posts_updated_at();

-- 6. UNIQUE (content_id, channel) — one row per channel per piece
ALTER TABLE published_posts
  ADD CONSTRAINT scheduled_posts_unique_per_channel
  UNIQUE (content_id, channel);

-- 7. Rename the table itself
ALTER TABLE published_posts RENAME TO scheduled_posts;

COMMIT;
