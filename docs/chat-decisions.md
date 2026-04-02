# SMT Chat Decisions Log

Captures strategic decisions made in Claude Code sessions.

---

## 2026-04-02 — Project Bootstrap

### Decision: Start from scratch with AI-first content
- Both accounts are Day Zero (10 IG followers, 0 TT followers)
- Previous educational series format failed (1-3 likes)
- New strategy: 60% Wow (AI magic) / 30% Trust (memes) / 10% CTA
- No cross-posting — native content per platform

### Decision: Supabase as shared memory
- All agent outputs written to Supabase tables
- Enables Claude Chat to surface data in strategy sessions
- Schema: daily_briefings, content_queue, published_posts,
  performance_data, lessons

### Decision: Modular agent architecture
- Each agent is a standalone script with its own instructions file
- GitHub Actions for scheduling (not Supabase cron)
- Approval UI is the only human touchpoint

### Decision: Content-first, product-second
- Phase 1-3: Build audience via content engine
- Phase 4: Launch AI product/service once audience exists
- First product ideas TBD after reaching 10K followers
