# SMT Task List

## Phase 1 — Research Agent + Approval UI

- [x] Scrape baseline metrics (IG + TikTok)
- [x] Set up Supabase schema (5 tables)
- [x] Create modular project architecture
- [ ] Implement Research Agent (agents/research.js)
  - [ ] Reddit scraper via Apify
  - [ ] TikTok trend scanner via Apify
  - [ ] Instagram trend scanner via Apify
  - [ ] Google Trends integration
  - [ ] Anthropic API for briefing synthesis
- [ ] Build Approval UI (ui/approval/)
  - [ ] React scaffold
  - [ ] Supabase auth
  - [ ] Content preview cards
  - [ ] Approve/reject/edit flow
- [ ] Set up GitHub Actions secrets in repo

## Phase 2 — Content Generation Agent

- [ ] Implement Content Agent (agents/content.js)
- [ ] Anthropic API integration for content generation
- [ ] Image generation pipeline (DALL-E or Flux)

## Phase 3 — Publishing Agent

- [ ] Configure Instagram Graph API
- [ ] Configure TikTok Content Posting API
- [ ] Implement Publishing Agent (agents/publish.js)

## Phase 4 — Learning Agent

- [ ] Implement performance data fetching
- [ ] Implement Learning Agent (agents/learning.js)
- [ ] Weekly report generation

## Avatar cover stage (2026-06-11)

- [x] Migration: `content_queue.thumbnail_asset_url` + `cover_asset_url`; services fallback chain `gemini_nano_banana` → `higgsfield_soul` (applied to fvxaykkmzsbrggjgdfjj + mirrored in `supabase/migrations/`)
- [x] `video/lib/cover/` — Gemini Nano Banana client, tone/Haiku directive + last-5 variance, brand banner (IG 3:4 safe zone), matches-reference QA gate, fallback-chain runner
- [x] `render-avatar-full-v5.ts --phase=cover` / `--phase=cover-record` — thumbnail persistence + cover generation + hard post-check (both URLs non-null + fetchable)
- [x] Publisher: IG stages `cover_asset_url`, TikTok keeps frame-based thumbnail (documented limitation)
- [x] create-from-url concept brief: optional `tone` field → `metadata.tone`
- [x] Approval UI: video + thumbnail + cover side-by-side in ContentDetailPage
- [ ] Yaron: add `GEMINI_API_KEY` to `.env`, then flip `services.gemini_nano_banana` to `active`
- [ ] First live cover render: eyeball grid-crop framing + calibrate the identity QA threshold on 2 covers before trusting auto-pass
