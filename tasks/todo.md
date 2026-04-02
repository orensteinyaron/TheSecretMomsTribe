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
