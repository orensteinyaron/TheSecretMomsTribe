# SMT System Architecture

## Overview

Content engine (builds audience) → Product layer (monetizes audience).
Five autonomous agents connected through Supabase as shared memory.

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
    ↓ writes published_posts
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
Confirmation logged to `published_posts` table.

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
| `published_posts` | What went live | Publishing Agent |
| `performance_data` | Analytics snapshots | Learning Agent |
| `lessons` | Knowledge base | Learning Agent / Manual |

**Enums:** `platform` (instagram, tiktok), `content_status` (draft, pending_approval, approved, rejected), `content_type` (wow, trust, cta)

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
