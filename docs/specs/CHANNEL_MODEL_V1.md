# CHANNEL_MODEL_V1 — `post_format` deprecation + canonical channel model

**Version:** 1.0
**Status:** Ready for Claude Code execution
**Owner:** Yaron (approver) / Claude Chat (architect)
**Date:** 2026-05-17
**Linear:** [YAR-117](https://linear.app/yarono/issue/YAR-117) (parent), YAR-118–YAR-125 (sub-issues), [YAR-126](https://linear.app/yarono/issue/YAR-126) (social_metrics follow-up under YAR-97)

## 0. TL;DR

Three mental models for "where a piece gets posted" currently live in production schema simultaneously, all inconsistent with each other and with the canonical render-profile model. The orchestrator's contentgen stage fails because it tries to write `post_format = 'tiktok_avatar'` into an enum that doesn't have it — but the enum itself is the wrong abstraction.

This spec collapses the three models into one:

1. **Format = render profile.** One render profile per piece, one output file. `render_profile_id` (FK to `render_profiles`) is the truth. `post_format` enum is dropped.
2. **Channel = where it gets posted.** A piece can target multiple channels (TikTok + Instagram by default, extensible to YouTube Shorts, Threads, etc.). Captions, scheduling, posting state, and platform-specific identifiers all live per-channel.
3. **One new table, `scheduled_posts`, owns per-channel state.** Replaces the inline `scheduled_at_ig` / `scheduled_at_tt` / `published_at_ig` / `published_at_tt` / `published_url_ig` / `published_url_tt` / `channel_override` columns AND the parallel `published_posts` table.

The legacy `social_metrics` table (FK to `content_queue_id`) is out of scope for this migration — keep it untouched, tracked as [YAR-126](https://linear.app/yarono/issue/YAR-126).

## 1. Context — why this matters

### 1.1 The crash that triggered this

Run #631 of System Orchestrator (workflow_dispatch, 2026-05-17 14:54 UTC) failed in contentgen with:

```
invalid input value for enum post_format: "tiktok_avatar"
```

Skills v1.0.0 contract validator did its job: failed fast, escalated, halted. This is the second escalation in 48 hours (first was `mom_health` → `health`, already fixed). Both are schema-code drift symptoms.

### 1.2 The three models living in schema today

**Model A (legacy enum):** `content_queue.post_format` — values `tiktok_slideshow`, `tiktok_text`, `ig_carousel`, `ig_static`, `ig_meme`, `video_script`. Pre-render-profiles era. Conflates channel and format.

**Model B (inline per-channel columns):** `content_queue.scheduled_at_ig` + `scheduled_at_tt` + `published_at_ig` + `published_at_tt` + `published_url_ig` + `published_url_tt` + `channel_override`. Someone started Option 1 (two-channel inline). Hardcoded to IG+TT, no extensibility.

**Model C (separate table):** `published_posts (content_id, platform, platform_post_id, post_url, published_at)`. Option 3-shaped. Already exists, currently underused (0 rows as of 2026-05-17).

**Model D (the canon we agreed on, not yet implemented):** `render_profile_id` for format, `scheduled_posts` table for per-channel state. `render_profile_id` already exists on `content_queue` and is ~80% populated.

### 1.3 The agreed model (locked)

- One piece = one row in `content_queue`.
- One render profile per piece = one rendered output file (e.g., one `.mp4` for Moving Images).
- Multiple channels per piece = multiple rows in `scheduled_posts`, one per (content_id, channel).
- Default: every piece targets `tiktok` AND `instagram`. Captions are platform-native (different per channel).
- Channel is independent from format. A Moving Images piece posts to both. An Avatar Full piece posts to both. Same file, different captions, possibly different schedule times.

### 1.4 Data state (verified at execution time, 2026-05-17)

```
content_queue:               147 rows total
  post_format distribution:
    tiktok_slideshow:        56  (47 → moving-images, 9 null)
    ig_static:               44  (39 → static-image, 4 → moving-images [wrong], 1 null)
    ig_carousel:             35  (14 → static-image, 13 → moving-images, 8 null)
    tiktok_text:             5   (3 → moving-images, 2 null)
    null:                    7   (6 truly orphan, 1 backfilled avatar-v1 showcase)

  render_profile_id null:    26  (20 inferrable from post_format, 6 truly orphan)

published_posts:             0 rows (publishing agent never wrote — IG Graph API not configured)

Inline channel columns on content_queue (147 rows):
  scheduled_at_ig:           0 populated
  scheduled_at_tt:           0 populated
  published_at_ig:           0 populated
  published_at_tt:           0 populated
  published_url_ig:          0 populated
  published_url_tt:          0 populated
  channel_override:          0 populated

render_profiles:
  avatar-v1     (status=active)  → 1 row uses it
  moving-images (status=active)  → 67 rows
  static-image  (status=draft)   → 53 rows (status flip is out of scope)
  carousel      (status=draft)   → 0 rows
```

**Implications:**
- Migration 2 backfill from inline columns: effectively no-op (no data to move). Keep the INSERT statements idempotent for safety.
- Backfill from `published_posts`: nothing to backfill. The 0-row table is a clean rename target.
- Migration 3 will touch ~20 rows (the inferrable nulls).
- 6 orphans to soft-delete (Q2 decision, modified by Q3 carve-out).
- The 4 `ig_static` → `moving-images` and 13 `ig_carousel` → `moving-images` mappings are tolerated as-is (`render_profile_id` is source of truth when set).

## 2. Scope

### 2.1 In scope

1. DB migration: add `scheduled_posts` table (by evolving `published_posts`), drop `post_format` column and its enum, drop the 7 inline `*_ig` / `*_tt` columns on `content_queue`, drop `channel_override`, drop `content_format_id` (vestigial).
2. Backfill: populate `scheduled_posts` from existing inline columns + existing `published_posts` rows (both effectively empty today, but the SQL is idempotent for safety). Reconcile inconsistent `post_format` → `render_profile_id` mappings (use `render_profile_id` as source of truth when set; infer from `post_format` only when `render_profile_id` is null).
3. Code: update all agents that write `content_queue`. The spec originally named `agents/contentgen.js` and `agents/strategist.js`; the **actual** surface is:
   - `agents/content.js`, `agents/ai-magic-content-gen.js`
   - `agents/lib/content-queue-row.js`, `agents/lib/content-prompt.js`, `agents/lib/format-selector.js`, `agents/lib/caption-retry.js`, `agents/lib/image-diversity.js`
   - `agents/strategist-daily.js`, `agents/strategist-weekly.js`
   - `agents/publish.js` (replace `LEFT JOIN published_posts ON ... IS NULL` with `scheduled_posts WHERE status='pending'`)
4. Code: update any reader of `post_format`, `scheduled_at_ig/tt`, `published_at_ig/tt`, `published_url_ig/tt`, `channel_override`:
   - `scripts/regenerate-stale-drafts.js`, `scripts/image-gen.js`, `scripts/compose.js`
   - `video/scripts/generate-video.ts`
   - `supabase/functions/content-queue/index.ts` (redeploy required)
5. UI: update `app/src/types/index.ts`, `app/src/api/content.ts`, `app/src/pages/Pipeline.tsx`, `ContentDetailPage.tsx`, `Planner.tsx`.
6. Skills **v2.0.0** contracts: update output schema for contentgen + add fail-closed `rejectLegacyFormatFields` validator.
7. `published_posts` → `scheduled_posts` evolution: rename + add `caption`, `scheduled_for`, `status` (pending|scheduled|posted|failed|skipped), `failure_reason`, `external_post_id` (renamed from `platform_post_id`), `channel` (renamed from `platform`), `updated_at`. Add `UNIQUE(content_id, channel)`.

### 2.2 Out of scope (separate Linear tickets)

- `social_metrics` table refactor — [YAR-126](https://linear.app/yarono/issue/YAR-126).
- `content_metrics` evolution — already on roadmap.
- Apify-based metrics fetcher.
- Adding YouTube Shorts or any channel beyond `tiktok` and `instagram`.
- Per-channel render profile overrides.
- Publishing agent itself (still blocked on IG Graph API + TikTok API credentials).
- Flipping `static-image` / `carousel` render_profiles from `status='draft'` to `status='active'` (filed for future).

## 3. The migration (DB)

### 3.1 New table: `scheduled_posts`

Evolve `published_posts` rather than create a new one — same shape, expanded responsibilities, cleaner name.

**Migration 1 (`20260517163000_channels_model_v1.sql`):**

```sql
BEGIN;

-- Rename enum type platform → channel for naming consistency
ALTER TYPE platform RENAME TO channel;

-- Make published_at nullable (pending/scheduled rows don't have it yet)
ALTER TABLE published_posts ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE published_posts ALTER COLUMN published_at DROP DEFAULT;

-- Rename columns
ALTER TABLE published_posts RENAME COLUMN platform_post_id TO external_post_id;
ALTER TABLE published_posts RENAME COLUMN platform TO channel;

-- Add new columns
ALTER TABLE published_posts
  ADD COLUMN caption        TEXT,
  ADD COLUMN scheduled_for  TIMESTAMPTZ,
  ADD COLUMN status         TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','scheduled','posted','failed','skipped')),
  ADD COLUMN failure_reason TEXT,
  ADD COLUMN updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- updated_at trigger
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

-- UNIQUE (content_id, channel)
ALTER TABLE published_posts
  ADD CONSTRAINT scheduled_posts_unique_per_channel
  UNIQUE (content_id, channel);

-- Rename the table itself
ALTER TABLE published_posts RENAME TO scheduled_posts;

COMMIT;
```

**Migration 2 (`20260517164000_channels_backfill.sql`):**

```sql
BEGIN;

-- TikTok backfill
INSERT INTO scheduled_posts (content_id, channel, scheduled_for, published_at, post_url, status, created_at, updated_at)
SELECT
  cq.id, 'tiktok',
  cq.scheduled_at_tt, cq.published_at_tt, cq.published_url_tt,
  CASE
    WHEN cq.published_at_tt IS NOT NULL THEN 'posted'
    WHEN cq.scheduled_at_tt IS NOT NULL THEN 'scheduled'
    ELSE 'pending'
  END,
  NOW(), NOW()
FROM content_queue cq
WHERE (cq.scheduled_at_tt IS NOT NULL OR cq.published_at_tt IS NOT NULL OR cq.published_url_tt IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.content_id = cq.id AND sp.channel = 'tiktok'
  );

-- Instagram backfill
INSERT INTO scheduled_posts (content_id, channel, scheduled_for, published_at, post_url, status, created_at, updated_at)
SELECT
  cq.id, 'instagram',
  cq.scheduled_at_ig, cq.published_at_ig, cq.published_url_ig,
  CASE
    WHEN cq.published_at_ig IS NOT NULL THEN 'posted'
    WHEN cq.scheduled_at_ig IS NOT NULL THEN 'scheduled'
    ELSE 'pending'
  END,
  NOW(), NOW()
FROM content_queue cq
WHERE (cq.scheduled_at_ig IS NOT NULL OR cq.published_at_ig IS NOT NULL OR cq.published_url_ig IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.content_id = cq.id AND sp.channel = 'instagram'
  );

-- Soft-delete the 6 truly-orphan null-format rows (created Apr 2-3, 2026).
-- The 1 backfilled avatar-v1 row (PR #21) is intentionally excluded — it has
-- render_profile_id set and is a valid showcase piece.
UPDATE content_queue
SET deleted_at = NOW()
WHERE post_format IS NULL
  AND render_profile_id IS NULL
  AND deleted_at IS NULL;

COMMIT;
```

**Migration 3 (`20260517165000_render_profile_backfill.sql`):**

```sql
BEGIN;

UPDATE content_queue cq
SET render_profile_id = rp.id
FROM render_profiles rp
WHERE cq.render_profile_id IS NULL
  AND cq.post_format IS NOT NULL
  AND rp.slug = CASE cq.post_format::text
    WHEN 'tiktok_slideshow' THEN 'moving-images'
    WHEN 'tiktok_text'      THEN 'moving-images'
    WHEN 'ig_carousel'      THEN 'static-image'
    WHEN 'ig_static'        THEN 'static-image'
    WHEN 'ig_meme'          THEN 'static-image'
    WHEN 'video_script'     THEN 'moving-images'
    ELSE NULL
  END;

COMMIT;
```

**Migration 4 (`20260517170000_drop_legacy_columns.sql`) — GATED, applied AFTER code merge + cron verification:**

```sql
BEGIN;

ALTER TABLE content_queue
  DROP COLUMN post_format,
  DROP COLUMN scheduled_at_ig,
  DROP COLUMN scheduled_at_tt,
  DROP COLUMN published_at_ig,
  DROP COLUMN published_at_tt,
  DROP COLUMN published_url_ig,
  DROP COLUMN published_url_tt,
  DROP COLUMN channel_override,
  DROP COLUMN content_format_id;

DROP TYPE post_format;

COMMIT;
```

### 3.2 Migration sequencing — critical

The four migrations must land in this order:

1. `20260517163000_channels_model_v1.sql` — evolve `published_posts` into `scheduled_posts`. Non-destructive.
2. `20260517164000_channels_backfill.sql` — populate + soft-delete 6 orphans. Non-destructive.
3. `20260517165000_render_profile_backfill.sql` — fill ~20 null `render_profile_id` values. Non-destructive.
4. **CODE DEPLOY HERE** — agents and UI updated to use new model. Both old and new columns exist during this window.
5. `20260517170000_drop_legacy_columns.sql` — drop the old columns + enum. **Destructive.** Deploy LAST, after code verified working against new model for at least one cron tick.

No step can be skipped or reordered. Each must succeed before the next.

## 4. The code changes

### 4.1 Content gen (the failing path)

Current failing behavior: emits `post_format = 'tiktok_avatar'` (a value not in the enum) into `content_queue`.

New behavior pattern:

```js
const renderProfile = await resolveRenderProfile({ contentPillar, pillarFormatMix, contentType });

const { data: content } = await supabase
  .from('content_queue')
  .insert({
    hook, caption: defaultCaption, hashtags,
    content_pillar, content_type,
    render_profile_id: renderProfile.id,
    // ... no post_format
  })
  .select()
  .single();

const channels = resolveTargetChannels(renderProfile, contentPillar); // defaults to ['tiktok','instagram']
const channelCaptions = await generateChannelCaptions(content, channels); // 2× Haiku calls

await supabase.from('scheduled_posts').insert(
  channels.map(channel => ({
    content_id: content.id,
    channel,
    caption: channelCaptions[channel],
    status: 'pending',
  }))
);
```

### 4.2 Readers of deprecated columns

UI: `app/src/pages/Pipeline.tsx`, `ContentDetailPage.tsx`, `Planner.tsx`, `app/src/api/content.ts`, `app/src/types/index.ts`.
Edge: `supabase/functions/content-queue/index.ts` (redeploy required).
Agents: `agents/strategist-daily.js`, `agents/strategist-weekly.js`, `agents/publish.js`.
Scripts: `scripts/regenerate-stale-drafts.js`, `scripts/image-gen.js`, `scripts/compose.js`.
Video: `video/scripts/generate-video.ts`.
Tests: all `__tests__/` files referencing `post_format` + `app/e2e/fixtures/test-data.ts`.

### 4.3 New helper: `agents/lib/channels.js`

```
DEFAULT_CHANNELS = ['tiktok','instagram']
resolveTargetChannels(renderProfile, contentPillar) → string[]
generateChannelCaptions(content, channels) → { [channel]: string }
getScheduledPostsForContent(contentId) → ScheduledPost[]
updateScheduledPostStatus(contentId, channel, status, extras) → void
```

### 4.4 New helper: `agents/lib/render-profiles.js`

```
RENDER_PROFILE_SLUGS = {
  AVATAR_V1:     'avatar-v1',
  MOVING_IMAGES: 'moving-images',
  STATIC_IMAGE:  'static-image',
  CAROUSEL:      'carousel',
}
resolveRenderProfile({ contentPillar, pillarFormatMix, contentType }) → RenderProfile
getActiveRenderProfiles() → RenderProfile[]
```

## 5. Skills v2.0.0 contract updates

`agents/skills/SMT_PIPELINE_CONTRACT.md` + per-skill SKILL.md files.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["hook", "caption_base", "hashtags", "content_pillar", "content_type",
               "render_profile_slug", "channels", "captions_per_channel"],
  "properties": {
    "hook":                 { "type": "string", "minLength": 1 },
    "caption_base":         { "type": "string", "minLength": 1 },
    "hashtags":             { "type": "array", "items": { "type": "string" } },
    "content_pillar":       { "type": "string",
                              "enum": ["parenting","health","ai_magic","tech","trending","financial"] },
    "content_type":         { "type": "string", "enum": ["wow","trust","cta"] },
    "render_profile_slug":  { "type": "string",
                              "enum": ["avatar-v1","moving-images","static-image","carousel"] },
    "channels":             { "type": "array", "minItems": 1, "uniqueItems": true,
                              "items": { "type": "string", "enum": ["tiktok","instagram"] } },
    "captions_per_channel": { "type": "object",
                              "patternProperties": {
                                "^(tiktok|instagram)$": { "type": "string", "minLength": 1 }
                              },
                              "additionalProperties": false }
  },
  "not": {
    "anyOf": [
      { "required": ["post_format"] },
      { "required": ["scheduled_at_ig"] },
      { "required": ["scheduled_at_tt"] },
      { "required": ["published_at_ig"] },
      { "required": ["published_at_tt"] },
      { "required": ["channel_override"] }
    ]
  }
}
```

The `not.anyOf` block ensures contentgen explicitly cannot regress to the old shape — fail fast if any legacy field appears.

`agents/lib/gate_validators.js` — add `rejectLegacyFormatFields` validator catching the same set.

## 6. Test plan

### 6.1 Unit tests (must pass before push)

1. `agents/lib/__tests__/channels.test.js` — `resolveTargetChannels` returns `['tiktok','instagram']` by default. `generateChannelCaptions` returns object with both keys for both-channel target.
2. `agents/lib/__tests__/render-profiles.test.js` — `resolveRenderProfile` returns the correct profile for each pillar.
3. Updates to existing tests removing `post_format` expectations.
4. `npm run skills:test` — passes.
5. `npm test` — passes.

### 6.2 Integration (post-deploy)

1. After migrations 1+2+3: `SELECT COUNT(*) FROM scheduled_posts` — expect 0 (no source data).
2. After migrations 1+2+3: `SELECT COUNT(*) FROM content_queue WHERE deleted_at IS NOT NULL` — expect ≥ 6.
3. After migrations 1+2+3: `SELECT COUNT(*) FROM content_queue WHERE render_profile_id IS NULL AND deleted_at IS NULL` — expect 1 (the avatar-v1 backfill row with null post_format — already has render_profile_id set, so this should be 0; remaining nulls are from pre-existing rows that don't have a clean mapping).
4. After code deploy: trigger orchestrator manually via `workflow_dispatch`.
5. Verify: any new `content_queue` row has `render_profile_id` set; matching `scheduled_posts` rows exist (one per channel).
6. Spot-check one piece in the UI: detail page shows scheduled state correctly per channel.
7. After 1 cron tick + verification clean: ship migration 4 (drop legacy columns).
8. `scheduled_posts_post_check` stage in the orchestrator now guards this invariant on every run (added by YAR-128).

### 6.3 Rollback plan

- If migration 1 fails: drop the new columns, no data loss.
- If migration 2 (backfill) fails: re-run idempotently; or `TRUNCATE scheduled_posts` and retry (0-row table).
- If migration 3 fails: revert with `UPDATE content_queue SET render_profile_id = NULL WHERE ...` against affected rows.
- If code deploy breaks pipeline: revert the merge commit. Both old and new columns exist during this window so old code path still works.
- If migration 4 (drop) breaks something: restore from backup. Atomic — no partial drop possible. This is why migration 4 ships last and only after verification.

## 7. Linear tracking

- Parent: [YAR-117](https://linear.app/yarono/issue/YAR-117)
- Migration 1: [YAR-118](https://linear.app/yarono/issue/YAR-118)
- Migration 2: [YAR-119](https://linear.app/yarono/issue/YAR-119)
- Migration 3: [YAR-120](https://linear.app/yarono/issue/YAR-120)
- Code helpers: [YAR-121](https://linear.app/yarono/issue/YAR-121)
- Code UI/Edge/scripts: [YAR-122](https://linear.app/yarono/issue/YAR-122)
- Skills v2.0.0: [YAR-123](https://linear.app/yarono/issue/YAR-123)
- Tests + docs: [YAR-124](https://linear.app/yarono/issue/YAR-124)
- Migration 4 (gated): [YAR-125](https://linear.app/yarono/issue/YAR-125)
- Follow-up under YAR-97: [YAR-126](https://linear.app/yarono/issue/YAR-126) — Consolidate social_metrics into canonical content_metrics

## 8. Locked decisions (answered by Yaron 2026-05-17)

1. **Channel default per pillar:** all 6 pillars × all 4 render profiles default to BOTH `tiktok` and `instagram`. Publishing-layer concerns (TT photo mode vs IG carousel mechanics) live in the publish agent, not the channel model.
2. **The 7 `post_format = null` rows:** soft-delete the 6 truly-orphan ones (null post_format + null render_profile_id) via `deleted_at = NOW()`. The 1 avatar-v1 backfill row is excluded (Q3 carve-out — render_profile_id is correctly set).
3. **`social_metrics` table:** OUT OF SCOPE. Tracked as [YAR-126](https://linear.app/yarono/issue/YAR-126) under YAR-97.
4. **`scheduled_posts` channel enum:** keep only `tiktok` + `instagram`. Future expansion = `ALTER TYPE ADD VALUE`.
5. **Caption-per-channel generation:** 2× Haiku calls per piece. TikTok = short, hook-first, hashtag-dense. Instagram = longer prose, hashtags in first comment.
6. **Skills versioning:** **v2.0.0** (breaking — explicit `not.anyOf` rejection of legacy fields).
7. **Branch:** `feat/channels-model-v1`.
