# SMT Piece Page Lifecycle Overhaul — Spec V1

**Date:** April 18, 2026
**Target branch:** `feat/piece-page-lifecycle`
**Supersedes:** N/A (additive to `SMT_SYSTEM_ARCHITECTURE_V1.md`)
**Execution model:** One Claude Code session, end-to-end. No incremental patches.

---

## 1. Context & goal

The piece page (`/pipeline/:id`) today shows content text only. It is a partial view of a creative's lifecycle. Rendered output lives in a separate Render Queue module; metrics don't exist yet; the generation context that produced the piece is not persisted; scheduling can't be edited per-channel.

**This spec turns the piece page into the full lifecycle cockpit:** generation → render → schedule → publish → performance, all in one view. It also closes two architectural gaps: the `platform` column is wrong (content always goes to both channels, per `CONTENT_STRATEGY_V1.md`), and the full prompt chain that produces a piece is currently invisible, which blocks content quality iteration.

**Primary outcome:** a single page where Yaron can see exactly what prompt produced a piece, what came out of each render step, when it's scheduled per channel, and how it performed — and regenerate any step inline when quality is off.

---

## 2. Scope summary

**In scope (this spec):**

1. Drop `content_queue.platform` column (channel is implicit: both IG + TT by policy)
2. Add per-channel scheduling: `scheduled_at_ig`, `scheduled_at_tt`, `published_at_ig`, `published_at_tt`
3. Add `content_queue.generation_context` jsonb (content gen step only)
4. Create `prompt_executions` table — one row per LLM call in the chain
5. Create `content_metrics` table — append-only time series of per-channel metrics
6. Wire every agent that makes an LLM call to persist to `prompt_executions`
7. Build Apify-based metrics fetcher as v1 source (swappable later for Graph API)
8. Piece page UI restructure — 5 sections: Scheduling, Generation, Prompt Chain, Render, Analytics
9. Inline render preview (MP4 player for video, slide viewer for carousel, image for static)
10. Regenerate-from-step capability (prompt edit + re-run downstream)
11. Table UI — drop Platform column, keep Format as primary categorical, add fallback `UNCATEGORIZED` badge for null pillar (defensive)
12. `NOT NULL` + CHECK constraint on `content_queue.pillar` against the V1.1 taxonomy

**Out of scope (do not build):**

- Aggregate Analytics module (Phase 3, deferred)
- Instagram Graph API / TikTok Business API integration (blocked on credentials; Apify is v1 source)
- Publishing agent itself (separate spec)
- QA agent recalibration (separate spec)
- Any change to existing render profiles (Moving Images, Carousel, Avatar, etc. — unchanged)

---

## 3. Schema changes

All DDL via Supabase `apply_migration`, one migration per concern with descriptive snake_case slugs. Use `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` for idempotency. Verify each migration with a `SELECT COUNT(*)` or `information_schema.columns` check before proceeding to the next.

### 3.1. Migration: `drop_platform_add_channel_scheduling`

```sql
-- Drop legacy platform column
ALTER TABLE content_queue DROP COLUMN IF EXISTS platform;

-- Add per-channel scheduling
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS scheduled_at_ig timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at_tt timestamptz,
  ADD COLUMN IF NOT EXISTS published_at_ig timestamptz,
  ADD COLUMN IF NOT EXISTS published_at_tt timestamptz,
  ADD COLUMN IF NOT EXISTS published_url_ig text,
  ADD COLUMN IF NOT EXISTS published_url_tt text;

-- Optional per-piece channel override (rare; default = both channels)
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS channel_override text
    CHECK (channel_override IS NULL OR channel_override IN ('ig_only','tt_only'));

CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled_at_ig
  ON content_queue (scheduled_at_ig) WHERE scheduled_at_ig IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled_at_tt
  ON content_queue (scheduled_at_tt) WHERE scheduled_at_tt IS NOT NULL;
```

### 3.2. Migration: `enforce_pillar_taxonomy`

```sql
-- Backfill any null pillars as 'uncategorized' so NOT NULL doesn't fail
UPDATE content_queue SET pillar = 'uncategorized' WHERE pillar IS NULL;

-- Enforce taxonomy (V1.1: 6 pillars + defensive 'uncategorized' fallback)
ALTER TABLE content_queue
  ADD CONSTRAINT content_queue_pillar_taxonomy
  CHECK (pillar IN (
    'parenting',
    'health',
    'ai_magic',
    'tech',
    'trending',
    'financial',
    'uncategorized'
  ));

ALTER TABLE content_queue ALTER COLUMN pillar SET NOT NULL;
```

After this migration, review rows with `pillar = 'uncategorized'` manually and reassign via UI.

### 3.3. Migration: `add_generation_context`

```sql
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS generation_context jsonb;

-- Expected shape (documented, not enforced):
-- {
--   "model": "claude-sonnet-4-6",
--   "system_prompt": "...",
--   "user_prompt": "...",
--   "briefing_id": "uuid",
--   "briefing_slice": { ... },
--   "active_directives": [ { id, title, applied_at } ],
--   "pillar_input": "parenting",
--   "format_input": "moving_images",
--   "tokens_in": 4120,
--   "tokens_out": 890,
--   "cost_usd": 0.0142,
--   "agent_run_id": "uuid",
--   "created_at": "2026-04-18T10:22:00Z"
-- }
```

### 3.4. Migration: `create_prompt_executions`

```sql
CREATE TABLE IF NOT EXISTS prompt_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_queue(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  step_name text NOT NULL,
  step_order int NOT NULL,
  model text NOT NULL,
  system_prompt text,
  user_prompt text NOT NULL,
  rendered_output text,
  output_json jsonb,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10,6),
  status text NOT NULL CHECK (status IN ('ok','error','retry','skipped')),
  error_message text,
  latency_ms int,
  agent_run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- For regenerate-from-step: supersedes a prior execution
  supersedes_id uuid REFERENCES prompt_executions(id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_executions_content_id
  ON prompt_executions (content_id, step_order);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_agent
  ON prompt_executions (agent_name, created_at DESC);
```

### 3.5. Migration: `create_content_metrics`

```sql
CREATE TABLE IF NOT EXISTS content_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_queue(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('instagram','tiktok')),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('apify','graph_api','tiktok_api','manual')),

  -- Core metrics (null when unavailable on source)
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reach bigint,
  impressions bigint,
  profile_visits bigint,
  follows bigint,

  -- Video-specific
  watch_time_seconds numeric(10,2),
  avg_watch_duration_seconds numeric(10,2),
  completion_rate numeric(5,4),

  -- Derived (computed at snapshot time, not stored)
  -- save_rate, share_rate, engagement_rate — computed in UI/Edge Function

  raw_payload jsonb,  -- full source response for future re-parsing
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_metrics_content_channel
  ON content_metrics (content_id, channel, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_metrics_snapshot_at
  ON content_metrics (snapshot_at DESC);
```

### 3.6. Verification

After all migrations, run and confirm in logs:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'content_queue'
ORDER BY ordinal_position;

SELECT COUNT(*) FROM prompt_executions;      -- should be 0
SELECT COUNT(*) FROM content_metrics;        -- should be 0
SELECT COUNT(*) FROM content_queue WHERE pillar IS NULL;   -- should be 0
SELECT DISTINCT pillar FROM content_queue;    -- should be subset of taxonomy
```

---

## 4. Agent changes — prompt execution persistence

Every agent that makes an LLM call writes a row to `prompt_executions` immediately after the call completes (success, error, or retry). This is non-negotiable. Helper module required.

### 4.1. Shared helper: `agents/lib/prompt_logger.ts`

Single entry point for all agents:

```typescript
export async function logPromptExecution(params: {
  contentId: string;
  agentName: string;       // e.g. 'content_gen', 'slide_parser', 'media_query_gen'
  stepName: string;        // human-readable step
  stepOrder: number;       // 1..N in the chain for this contentId
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  renderedOutput?: string;
  outputJson?: object;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  status: 'ok' | 'error' | 'retry' | 'skipped';
  errorMessage?: string;
  latencyMs?: number;
  agentRunId?: string;
  supersedesId?: string;
}): Promise<{ id: string }>
```

This wraps the Supabase insert and returns the row id. All LLM calls across the codebase route through it.

### 4.2. Canonical step orders per render profile

These must be consistent so the UI can display the chain in order. Assign `step_order` from this table:

**Moving Images (Profile #1):**
1. `content_gen` (Sonnet)
2. `slide_parser` (Haiku)
3. `media_query_gen` (Haiku)
4. `media_screening` (Haiku) — one row per slide screened
5. `tts_script_prep` (deterministic, optional row with `model='none', status='skipped'` if no LLM)
6. `qa_evaluation` (Claude Vision)

**Carousel (Profile #4):**
1. `content_gen`
2. `slide_parser`
3. `image_prompt_gen` (Haiku — per-slide image prompts)
4. `qa_evaluation`

**Avatar / Ask Rachel (Profile #3, #6):**
1. `content_gen`
2. `avatar_script_prep` (Haiku — pacing, pauses, Rachel filter)
3. `interviewer_prompt_gen` (Ask Rachel only)
4. `qa_evaluation`

**AI Magic Video (Profile #5):**
1. `content_gen`
2. `magic_prompt_extract` (Haiku — the prompt being *demonstrated* inside the content)
3. `slide_parser`
4. `media_query_gen`
5. `qa_evaluation`

**Static Image (Profile #2):**
1. `content_gen`
2. `image_prompt_gen`
3. `qa_evaluation`

### 4.3. Content agent change

The content agent currently writes to `content_queue`. Additionally:

1. Populate `content_queue.generation_context` on insert with the full struct described in §3.3.
2. Write a `prompt_executions` row with `step_order=1, agent_name='content_gen'`.
3. Fail loudly on schema validation: if the Sonnet output doesn't include a valid `pillar` from the taxonomy, retry once; if still invalid, insert the piece with `pillar='uncategorized'` and `status='needs_review'` with a note. Do not drop.

### 4.4. All other agents

Add `logPromptExecution` calls to:
- `parse-slides-v2.ts`
- `media-sourcing.ts` (for Haiku query generation and screening)
- `qa-agent.ts`
- Any new agent introduced for Avatar, Ask Rachel, or AI Magic Video formats when they wire in

Every call requires a `contentId`. For cases where the agent operates on pre-content (e.g., briefing generation), use `content_id = null` is not allowed in the schema — those LLM calls stay in `agent_runs` only. `prompt_executions` is specifically for content-producing chains.

---

## 5. Metrics fetcher — new agent

### 5.1. Architecture

New standalone script: `agents/metrics-fetcher.ts`
Runs on GitHub Actions cron — see §5.3.
Data source: Apify actors we already have configured. No official API access yet.

### 5.2. Fetch logic

For every piece in `content_queue` where:
- `status IN ('published')`
- `published_url_ig IS NOT NULL` OR `published_url_tt IS NOT NULL`
- Last metric snapshot is older than the refresh cadence (see §5.3)

Fetch the post via Apify and write one row to `content_metrics` per channel.

**Apify actors (confirmed working, reuse):**
- Instagram post: `apify/instagram-post-scraper` (verify actor ID; fallback to hashtag scraper + filter if needed)
- TikTok post: `clockworks/free-tiktok-scraper` — accepts direct post URLs

All calls use `useApifyProxy: true`. Wrap each call in a 60s timeout with a single retry. On repeated failure, log to `agent_runs` with `status='error'` and skip this piece in this run.

### 5.3. Refresh cadence

Implement via a single `metrics-fetcher.yml` GitHub Action that runs every 6 hours. Inside the script, filter pieces by age bucket:

| Age since publish | Minimum interval before next snapshot |
|---|---|
| 0–72h | 6 hours |
| 72h–30d | 24 hours |
| 30d+ | stop refreshing (archived) |

Apify costs are non-trivial — compute cost per run and log to `agent_runs.cost_usd`. Target: <$0.50 per run.

### 5.4. Derived metrics

Computed in the Edge Function or UI at read time, not stored:

- `save_rate = saves / reach` (or `saves / views` if reach null)
- `share_rate = shares / reach`
- `engagement_rate = (likes + comments + shares + saves) / reach`
- `performance_vs_pillar` = this piece's engagement rate ÷ rolling 30-day average for its pillar on that channel

The Edge Function exposes a `GET /metrics/:content_id` endpoint that returns latest snapshot per channel + derived + time-series array.

---

## 6. Edge Function changes — `content-queue`

Extend the existing `content-queue` Edge Function (JWT disabled, public via anon) with the following endpoints. Keep the Edge Function structure clean — one handler per route.

### 6.1. New endpoints

```
GET    /pieces/:id                           → full piece payload for page
GET    /pieces/:id/prompt-chain              → ordered prompt_executions for piece
GET    /pieces/:id/render-output             → render_queue + storage URLs
GET    /pieces/:id/metrics                   → latest metrics per channel + time series
PATCH  /pieces/:id/schedule                  → update scheduled_at_ig / scheduled_at_tt
PATCH  /pieces/:id/pillar                    → reassign pillar (validated against taxonomy)
POST   /pieces/:id/regenerate-from-step      → see §7
```

### 6.2. `/pieces/:id` response shape (the single payload the page loads)

```typescript
{
  piece: ContentQueueRow,
  generation_context: GenerationContext | null,
  render: {
    queue_row: RenderQueueRow | null,
    profile: RenderProfileRow,
    output_urls: {
      video?: string,
      carousel_slides?: string[],
      static?: string
    },
    qa_score?: number,
    duration_ms?: number,
    cost_usd?: number
  },
  prompt_chain: PromptExecutionRow[],   // ordered by step_order
  metrics: {
    ig: { latest: MetricSnapshot | null, series: MetricSnapshot[] },
    tt: { latest: MetricSnapshot | null, series: MetricSnapshot[] },
    derived: { save_rate_ig, share_rate_ig, engagement_rate_ig, ... },
    performance_vs_pillar: { ig: number, tt: number }
  },
  schedule: {
    scheduled_at_ig: timestamp | null,
    scheduled_at_tt: timestamp | null,
    published_at_ig: timestamp | null,
    published_at_tt: timestamp | null,
    next_available_slot_ig: timestamp,
    next_available_slot_tt: timestamp
  }
}
```

One network call loads the whole page.

---

## 7. Regenerate-from-step

### 7.1. Contract

Input: `content_id`, `step_name` (one of the canonical step names in §4.2), optional `edited_prompt` (if user edited the prompt inline before regenerating).

Behavior:
1. Identify all `prompt_executions` rows for this content with `step_order >= target_step.step_order`.
2. Mark them as `superseded` by creating a new run that references them via `supersedes_id`.
3. Kick off the pipeline from that step forward. Each new LLM call creates a fresh `prompt_executions` row with `supersedes_id` pointing to the row it replaces.
4. If `edited_prompt` is provided, use it verbatim for that step; otherwise re-render the prompt using the current template + current directives.
5. Update `content_queue` row when new content output is produced.
6. Update `render_queue` row and trigger re-render if any downstream step affects the render.

### 7.2. UI implementation

Each step in the Prompt Chain section has:
- "View prompt" (expandable)
- "Edit & regenerate from here" (opens prompt editor + confirm modal)
- "Regenerate from here (no edits)" (direct re-run)

Old executions remain in the DB (via `supersedes_id`), so version history is preserved. UI shows "v1 / v2 / v3" badges on steps that have been regenerated.

### 7.3. Guardrails

- Block regeneration if piece is `published` (must be unpublished first — out of scope for this spec).
- Confirm modal if regenerating a step that will invalidate an approved render.
- Rate-limit: max 5 regenerations per piece per day (cost control).

---

## 8. UI changes

### 8.1. Table (pipeline list) — `/pipeline`

**Remove:**
- Platform column

**Add:**
- Nothing new; Format is already present and stays primary

**Defensive:**
- If `pillar = 'uncategorized'` render a muted gray `UNCATEGORIZED` badge (not crash the row)
- Search includes `hook`, `caption`, and `pillar` as before

### 8.2. Piece page — `/pipeline/:id`

Restructure into 5 sections, in this order, collapsible:

**Section 1 — Header (always visible)**
- Hook (large)
- Pillar badge (editable via dropdown; saves to `/pieces/:id/pillar`)
- Format badge (read-only; tied to render profile)
- Status badge
- Channels indicator: dual-icon IG + TT (both lit by default; dimmed if `channel_override` set)
- Quick actions: Approve / Reject / Regenerate / Delete

**Section 2 — Scheduling**
- IG: date-time picker bound to `scheduled_at_ig`, "Reschedule to next slot" button, "Published at" read-only
- TT: same for TT
- Conflict warning if another approved piece is already scheduled within 30 min of the selected time
- Link to published post when available

**Section 3 — Generation**
- Briefing source: link to parent briefing, list of `source_urls`
- Model used, tokens in/out, cost
- Directives active at generation time (expandable list, snapshot not live)
- "Full generation prompt" expandable — shows system_prompt + user_prompt verbatim

**Section 4 — Prompt Chain**
- Ordered list of `prompt_executions` rows for this piece
- Each step: step name, model, status, latency, cost, version badge (v1/v2/…)
- Expand: system_prompt, user_prompt, output preview
- Actions per step: "Edit & regenerate" / "Regenerate (no edits)"
- Show superseded versions in a collapsed "History" subsection per step

**Section 5 — Render**
- Status, render profile used, timing, duration, cost
- **Inline preview:**
  - Video: `<video controls>` element with MP4 URL
  - Carousel: horizontal swipeable slide viewer, one image per slide
  - Static: image thumbnail + full-size modal on click
- QA score (when QA agent runs)
- Download file buttons
- "Re-render" button (uses current approved content text, queues render job)
- Render logs/errors visible on failure

**Section 6 — Analytics (only shown when `published_at_ig` or `published_at_tt` set)**
- Two columns, one per channel
- Per channel: published timestamp + post link, metrics grid, retention mini-chart (if video), derived scores
- "Performance vs pillar average" prominent
- Empty state for unpublished channel: "Scheduled for [date]" or "Not scheduled"
- "Refresh now" button — triggers on-demand metrics fetch (respect rate limit)

### 8.3. Mobile responsiveness

The piece page is Yaron's primary approval surface. On mobile:
- Sections collapse by default except Header + Scheduling
- Render preview video plays inline
- Analytics shows in a single column, IG first then TT

---

## 9. File touch list (approximate)

**New files:**
- `agents/lib/prompt_logger.ts`
- `agents/metrics-fetcher.ts`
- `.github/workflows/metrics-fetcher.yml`
- `supabase/functions/content-queue/handlers/pieces.ts` (or split existing handler)
- `supabase/functions/content-queue/handlers/regenerate.ts`
- UI components under `ui/components/piece-page/` — one per section

**Modified files:**
- `agents/content.js` / `content-gen.ts` — wire `logPromptExecution` + `generation_context`
- `video/scripts/parse-slides-v2.ts` — wire `logPromptExecution`
- `video/scripts/media-sourcing.ts` — wire `logPromptExecution`
- `video/scripts/qa-agent.ts` — wire `logPromptExecution`
- `supabase/functions/content-queue/index.ts` — register new routes
- UI: `ui/pages/pipeline/index.tsx` — drop Platform column
- UI: `ui/pages/pipeline/[id].tsx` — full restructure

---

## 10. Build order (execution sequence for Claude Code)

Claude Code executes in this order. Each step must pass verification before proceeding.

1. **All migrations** (§3) applied in order, verified via `information_schema` queries
2. **Shared helper** `prompt_logger.ts` built + unit tested against Supabase
3. **Content agent wiring** — `generation_context` + `prompt_executions` logging
4. **Other agent wiring** — parse-slides, media-sourcing, qa-agent
5. **Edge Function endpoints** — `/pieces/:id` first (read path), then PATCH endpoints, then regenerate
6. **Metrics fetcher** + GitHub Action
7. **UI — table column removal** (trivial, fast win)
8. **UI — piece page restructure** — Header, Scheduling, Generation, Prompt Chain, Render, Analytics in that order
9. **Regenerate-from-step UI + wire-up**
10. **End-to-end test** — pick one existing piece, verify every section loads, regenerate a step, verify new prompt_executions rows, verify render preview renders, verify metrics widget shows empty state correctly

---

## 11. Verification checklist

Before declaring done, all of these must be green:

- [ ] `content_queue.platform` column does not exist
- [ ] `content_queue.pillar` is `NOT NULL` and CHECK-constrained to taxonomy
- [ ] Every pillar in the pipeline table renders a badge (no broken rows)
- [ ] `scheduled_at_ig` / `scheduled_at_tt` columns exist and are editable from the piece page
- [ ] Creating a new piece from the content agent writes a `prompt_executions` row with `step_order=1`
- [ ] Running a full Moving Images render writes ≥4 `prompt_executions` rows for that content_id
- [ ] `/pieces/:id` endpoint returns the full payload shape in §6.2
- [ ] Piece page loads all 5 sections (6 when published) in <1s
- [ ] Inline video preview plays the rendered MP4
- [ ] Regenerate-from-step on a test piece creates new `prompt_executions` rows with `supersedes_id` set
- [ ] Metrics fetcher GitHub Action runs successfully on a published test piece and writes to `content_metrics`
- [ ] Analytics widget renders with real Apify-sourced numbers
- [ ] Total Apify cost per metrics run <$0.50, logged to `agent_runs`
- [ ] Mobile view usable (sections collapse, video plays inline)

---

## 12. Open questions (defer, do not block)

- Graph API / TikTok Business API migration — when creds land, swap metrics source via `content_metrics.source` field. No schema change needed.
- Versioned piece comparison UI (side-by-side v1 vs v2) — useful but not critical; defer.
- Bulk regeneration across multiple pieces — defer until single-piece flow proven.

---

## 13. Non-negotiables

- **No patches.** Build the whole thing in one session. If a sub-component blocks, stop and re-plan, don't ship half.
- **No mocked data in the piece page.** Metrics section uses real Apify numbers from day one or an empty state — never mock numbers.
- **Every LLM call logs to `prompt_executions`.** If a call doesn't log, it's a bug.
- **Token economy holds.** Haiku for parsing/screening, Sonnet 4.6 only for content gen. Metrics fetching is deterministic — zero LLM calls.
- **Idempotent migrations.** Safe to re-run.
