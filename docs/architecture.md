# SMT System Architecture

## Overview

Content engine (builds audience) → Product layer (monetizes audience).
Five autonomous agents connected through Supabase as shared memory.

> **Agent Skills v1.0.0 (2026-05-11).** The four content-pipeline agents
> (orchestrator, research, strategist-daily, content-text-gen) load their
> behavior from versioned `SKILL.md` files at runtime via
> `agents/lib/skill_loader.js`. The deterministic safety net beneath them
> lives in `agents/lib/gate_validators.js` and
> `agents/lib/pillar_translation.js`. Orchestrator invocations land in
> the new `pipeline_runs` table; LLM outputs rejected by the gates land
> in `content_queue_rejected`; warn/error/critical events land in
> `escalations`. The trigger story is unchanged — the existing GitHub
> Actions cron (`.github/workflows/orchestrator.yml`) continues to fire
> the orchestrator, which now defaults to `--mode=daily`. See
> [agents/skills/README.md](../agents/skills/README.md) for the
> contract-wins precedence rule and load order.

---

## Agent Pipeline

```
Research Agent (daily 7am)
    ↓ writes daily_briefings
Content Generation Agent (triggered after research)
    ↓ writes content_queue
Approval UI (Yaron reviews, 5-10 min/day)
    ↓ updates content_queue status
Publishing Agent (posts approved content)
    ↓ updates scheduled_posts
Learning Agent (weekly Sunday night)
    ↓ writes performance_data + updates lessons
    ↓ feeds back into Research + Content agents
```

---

## Layer 1 — Research Agent (`agents/research.js`)

Runs every morning at 7am Israel time. Scans signal across:
- Reddit: r/Parenting, r/Mommit, r/teenagers
- TikTok: trending sounds, hashtags, viral content in mom niche
- Instagram: trending reels and content in parenting space
- Google Trends: what moms are searching right now
- News: parenting + AI headlines

**Output:** Daily briefing — top 5 content opportunities with
recommended angles. Saved to `daily_briefings` table.

**Runtime instructions:** `agents/research.instructions.md`

---

## Layer 2 — Content Generation Agent (`agents/content.js`)

Takes daily briefing → generates ready-to-post content:
- Hook (0-3 seconds)
- Full caption + hashtags
- The AI magic output (story / meal plan / conversation script)
- Image generation prompt if visual
- Suggested audio/format for TikTok

**Output:** Content queue — 3 TikTok posts + 1 IG post per day,
fully produced. Saved to `content_queue` table with status `pending_approval`.

**Runtime instructions:** `agents/content.instructions.md`

---

## Layer 3 — Approval UI (`ui/approval/`)

Simple mobile-first React web app.
Yaron opens it each morning. For each post:
- Preview exactly how it looks
- Approve / Edit / Reject
- Adjust posting time if needed

**Target:** 5-10 minutes per day maximum.

---

## Layer 4 — Publishing Agent (`agents/publish.js`)

Approved content → posted to IG and TikTok at optimal time.
APIs: Instagram Graph API + TikTok Content Posting API.
Each `(content_id, channel)` row in `scheduled_posts` is updated from
`pending` → `posted` (or `failed`) with `post_url` + `external_post_id`.

**Runtime instructions:** `agents/publish.instructions.md`

---

## Layer 5 — Learning Agent (`agents/learning.js`)

Pulls performance data weekly. What worked, what didn't.
Feeds insights back into Research and Content agents.

**Output:** Weekly performance report + updated content weights.
Writes to `performance_data` and `lessons` tables.

---

## Supabase Schema (Project: fvxaykkmzsbrggjgdfjj)

| Table | Purpose | Writer |
|---|---|---|
| `daily_briefings` | Research output | Research Agent |
| `content_queue` | Posts awaiting approval | Content Agent / Approval UI |
| `scheduled_posts` | Per-channel state for each piece (pending/scheduled/posted/failed/skipped). One row per (content_id, channel). | Content Agent (inserts pending rows) / Publishing Agent (updates to posted/failed) |
| `performance_data` | Analytics snapshots | Learning Agent |
| `lessons` | Knowledge base | Learning Agent / Manual |

**Enums:** `channel` (instagram, tiktok), `content_status` (draft, pending_approval, approved, rejected), `content_type` (wow, trust, cta)

### Format vs channels (v2.0.0 — see `docs/specs/CHANNEL_MODEL_V1.md`)

Format and channels are independent dimensions. Format = render profile:
each piece has exactly one `render_profile_id` (FK to `render_profiles`,
slugs: `avatar-v1`, `moving-images`, `static-image`, `carousel`), which
produces one rendered output file. Channels = where it gets posted: every
piece targets `tiktok` and `instagram` by default. Per-channel state
(caption, scheduled_for, status, post_url, external_post_id,
failure_reason) lives in `scheduled_posts`, one row per `(content_id,
channel)`. The legacy `post_format` enum and the inline
`scheduled_at_ig`/`scheduled_at_tt`/`published_at_*` columns on
`content_queue` are dropped.

---

## Tech Stack

| Component | Tool |
|---|---|
| Database | Supabase (fvxaykkmzsbrggjgdfjj) |
| AI Generation | Anthropic API (Claude) |
| Image Generation | Flux / DALL-E (TBD) |
| Video/Reel Production | TBD |
| Social Publishing | Instagram Graph API + TikTok API |
| Approval UI | React (mobile-first) |
| Scheduling | GitHub Actions |
| Research Scraping | Apify |
| Orchestration | Claude Code agents |

---

## Build Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Research Agent + Approval UI | **In Progress** |
| 2 | Content Generation Agent | Planned |
| 3 | Publishing Agent (full automation) | Planned |
| 4 | Learning Agent + first AI product | Planned |
