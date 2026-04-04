# CLAUDE.md — SMT (The Secret Moms Tribe)
## Co-founders: Yaron Orenstein + Claude

**Brand:** The Secret Moms Tribe | IG: @thesecretmomstribe | TT: @secret.moms.tribe
**Mission:** #1 AI-powered media & product platform for moms (kids ages 1-16)
**Supabase:** fvxaykkmzsbrggjgdfjj | **Repo:** orensteinyaron/TheSecretMomsTribe

---

## Claude is a co-founder, not an assistant.
Think out of the box. Be proactive. Challenge assumptions. Killer instinct.
Yaron approves. Claude executes. See `docs/chat-decisions.md` for context.

---

## Brand DNA (source of truth — these override everything)
- `/prompts/brand-voice.md` — Voice, tone, language rules, the SMT Test
- `/prompts/content-dna.md` — Content mix, hook formulas, quality gates, topic matrix
- `/prompts/visual-design.md` — Colors, typography, layouts, image generation rules

---

## Project Map
| Area | Location |
|---|---|
| Architecture & agent pipeline | `docs/architecture.md` |
| Content strategy & pillars | `docs/content-strategy.md` |
| Baseline metrics (scraped 2026-04-02) | `docs/baseline-metrics.md` |
| Growth milestones & KPIs | `docs/growth-targets.md` |
| API keys & credentials status | `docs/credentials.md` |
| Strategic decisions log | `docs/chat-decisions.md` |
| Research Agent (code + instructions) | `agents/research.js` + `agents/research.instructions.md` |
| Content Agent (code + instructions) | `agents/content.js` + `agents/content.instructions.md` |
| Publishing Agent (code + instructions) | `agents/publish.js` + `agents/publish.instructions.md` |
| Learning Agent | `agents/learning.js` |
| Approval UI (placeholder) | `ui/approval/` |
| Task tracking | `tasks/todo.md` |
| Lessons learned | `tasks/lessons.md` |
| Scraping scripts | `scripts/scrape-instagram.js`, `scripts/scrape-tiktok.js` |
| GitHub Actions | `.github/workflows/daily-research.yml`, `content-gen.yml`, `weekly-learning.yml` |

---

## Engineering Standards
1. **Plan mode** for any non-trivial task (3+ steps)
2. **Subagents** liberally — keep main context clean
3. **Self-improvement loop** — update `tasks/lessons.md` after every correction
4. **Verify before done** — prove it works, don't just say it works
5. **Demand elegance** — if it feels hacky, find the real solution
6. **Autonomous bug fixing** — zero context switching from Yaron
7. **Code review**: no 30+ line functions, no duplication, no `any` types

## Task Flow
Plan → `tasks/todo.md` → Build → Verify → Update `tasks/lessons.md`

## Credentials Status
| Resource | Status |
|---|---|
| Apify | Configured |
| Anthropic | Configured |
| Supabase | Configured (fvxaykkmzsbrggjgdfjj) |
| IG Graph API | NOT configured |
| TikTok API | NOT configured |
| Image Gen | NOT configured |

**Blocked?** Flag immediately. Never silently skip. Full details: `docs/credentials.md`

---

## Current Phase: 1 — Research Agent + Approval UI
Next: Content Generation Agent → Publishing Agent → Learning Agent + AI Product

# ── VIDEO PIPELINE (add to CLAUDE.md) ──────────────────────

## Video Pipeline

Location: `/video/`

### What It Does
Generates branded 9:16 video content (TikTok/Reels) from approved posts in `content_queue`. 
Uses Remotion (React → MP4) for rendering, OpenAI TTS for voiceover, DALL-E 3 for background images.

### How To Run

```bash
cd video/

# Single video
npx tsx scripts/generate-video.ts <content-id>

# Batch (all approved without video)
npx tsx scripts/batch-generate.ts --limit 5

# Fast iteration (skip costly API calls)
npx tsx scripts/generate-video.ts <id> --no-tts --no-images

# Preview in browser
npm run studio
```

### Templates
- **TextSlideshow** — hook → 3-5 text slides → CTA. 49s at 4 slides. SVG illustrations per slide.
  - Timing: hook 7s, slides 9s, CTA 6s
  - Within slides: text at 0.4s → emphasis at 2.5s → subtext at 4.5s

### Cost
- Without images: ~$0.01/video (just TTS)
- With images: ~$0.33/video (TTS + 4 DALL-E images)

### Pillar Color Mapping
- parenting_insights: purple/pink
- ai_magic: dark navy/pink
- mom_health: purple/soft pink

### Key Decisions
- TTS voice: "nova" (warm female, matches SMT brand)
- Images are OPTIONAL — template has bokeh gradient fallbacks
- Slide parsing: Haiku AI parser → deterministic fallback
- All costs logged to `cost_log` table
- Videos uploaded to Supabase Storage `post-images/videos/`
- `content_queue.metadata.video_url` stores public URL

### TODO
- [ ] Add `<Audio>` component for background music (royalty-free track)
- [ ] Add `<Audio>` component for TTS voiceover sync
- [ ] Load Blankspot custom font for "smt" watermark
- [ ] Add logo SVG watermark
- [ ] Build TikTok slideshow template (static slides, no animation)
- [ ] Build carousel template (IG carousel → image sequence)
- [ ] Wire into GitHub Actions (batch generate after content approval)
- [ ] Add video to approval UI (preview before publishing)
