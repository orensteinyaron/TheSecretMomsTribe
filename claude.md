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

> **Hard content rule (no dashes):** NEVER use em dashes (—) or double hyphens (--) in published content: posts, captions, hooks, slides, scripts. Rewrite with periods, commas, parentheses, or colons. Full rule in `/prompts/brand-voice.md` (Punctuation rules). Applies to published content, not internal docs/code.

---

## Agent Skills v1.0.0 (lives under `/agents/skills/`)

The four content-pipeline agents load their behavior from versioned
`SKILL.md` files at runtime, not from hardcoded SYSTEM_PROMPT constants.
Updating any skill file updates the agent — no code change required.

| Canonical slug          | Path                                  |
|-------------------------|---------------------------------------|
| `smt_orchestrator`      | `agents/skills/smt_orchestrator/`     |
| `smt_research`          | `agents/skills/smt_research/`         |
| `smt_strategist_daily`  | `agents/skills/smt_strategist_daily/` |
| `smt_content_text_gen`  | `agents/skills/smt_content_text_gen/` |

The cross-agent contract at `agents/skills/SMT_PIPELINE_CONTRACT.md` is
prepended to every skill. **Contract wins:** if a SKILL appears to
override the contract, that is a SKILL bug.

### Load order

`loadSkill(slug)` (in `agents/lib/skill_loader.js`) assembles the system
prompt as:

1. `SMT_PIPELINE_CONTRACT.md` body
2. `<slug>/SKILL.md` body
3. (`smt_content_text_gen` only) companion files: brand-voice, content-dna,
   visual-design, FACE_OF_SMT_V1 — translated by the loader from their
   on-disk paths to the canonical names referenced in the SKILL frontmatter.

### Pillar translation boundary

SKILL files speak canonical pillars: `ai_magic`, `parenting_insights`,
`health`, `tech_for_moms`, `trending`, `financial`.

The `content_queue.content_pillar` column speaks DB pillars: `ai_magic`,
`parenting`, `health`, `tech`, `trending`, `financial`.

The single boundary is `agents/lib/pillar_translation.js`. Applied by the
orchestrator at insert time. When the DB constraint is migrated to
canonical names, the entire intended diff is "delete that file."

### Gate validators

`agents/lib/gate_validators.js` is the deterministic safety net under the
LLM. Every rule the SKILL files describe (AI Magic four-field gate, base
schema, pillar routing, defensive verbatim-quote check, strategist
invention detection) is mirrored as a pure-function check the agents call
on every LLM output. Failures route to `content_queue_rejected` with the
raw LLM output preserved.

### Trigger

The pipeline is triggered by the existing GitHub Actions cron workflow
(`.github/workflows/orchestrator.yml`, unchanged); the orchestrator's
mode-based CLI is invoked directly from the workflow as before. The
orchestrator defaults to `--mode=daily` when no mode flag is passed, so
the existing `node agents/orchestrator.js` invocation continues to work.

---

## Claude Code Skills (lives under `/skills/`)

Distinct from Agent Skills (above): those load into agents at runtime via skill_loader.js; these are Claude Code session skills under /skills/, invoked conversationally.

These are invoked by Claude in a conversational/render context (not by the
agent pipeline) — each is a self-contained Claude Code skill with frontmatter
that auto-triggers on matching phrases.

| Skill | Path | Purpose |
|---|---|---|
| `full-avatar-profile` | `skills/full-avatar-profile/SKILL.md` | Production pipeline for Avatar Full video format — script → Soul 2.0 stills → Seedance clips → stitch → QA |
| `content-lifecycle` | `skills/content-lifecycle/SKILL.md` | Piece lifecycle management — backfills, lifecycle transitions, status conventions |
| `avatar-full-wardrobe-rotation` | `skills/avatar-full-wardrobe-rotation/SKILL.md` | Look axis + picker orchestration for Rachel: looks (cooldown=3) × locations (tier-aware 5/7 primary) → `pickCombination`. Look lifecycle (bootstrap + approve + retire). Look/still axis only — location lifecycle lives in the `location` skill. |
| `location` | `skills/location/SKILL.md` | Location axis for Rachel: structured set definitions (camera, position, background, lighting, props, walls + floor) + Rachel-in-location canonical reference images via nano_banana_pro. Wardrobe-swap stills anchor against the locked canonical via `medias[role:image]` so the same kitchen/studio appears identically across every render. Sub-flows: `bootstrapLocation`, `generateAnchoredStill`, `getLocationReference`, `updateLocationReference`, `approveLocation`, `retireLocation`. |
| `carousel-builder` | `skills/carousel-builder/SKILL.md` | Renderer for the `carousel` render profile (SMT_PIPELINE_CONTRACT Stage 4, currently "TBD"). Turns an approved `content_queue` row (`render_profile_slug='carousel'`) into a swipeable image set → IG 1080×1350 + TikTok 1080×1920 PNGs. Brand palette/typography loaded from canon (never asked), pillar drives slide arc, re-validates the pillar gate (verbatim `ai_magic` artifacts, `financial` disclaimer slide, `trending` 72h window). DB-flip-on-approval — no render field written until Yaron approves. When it ships, bump the contract to v2.2.0. |

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
| **Avatar/Video constants (Soul Rachel, voice id, v5 defaults)** | `video/lib/avatar-constants.ts` — canonical source; do not hardcode the Rachel CDN URL anywhere else |
| **Avatar Full v5 spec (in build)** | `docs/specs/AVATAR_FULL_V5.md` + plan at `docs/superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md` |
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

---

## Known Issues

### Higgsfield `generate_image` — `count` parameter silently capped at 1
**Observed:** Every `mcp__78d93fcf-...__generate_image` call delivers `batch_size: 1` regardless of the `count` value passed (1, 3, 4 — all return one candidate). Confirmed across PR-A revision and PR-C smoke runs.

**Mitigation in code:** `LOCATION_BOOTSTRAP_CANDIDATES` and `ANCHORED_STILL_CANDIDATES` in `video/lib/location/flows/constants.ts` are set to 1. The candidate-array shape is preserved through the flow / result types so a future Higgsfield fix that honours `count=N` requires only flipping the constant. Raising the constant without a transport fix would cause `generateAnchoredStill`'s count-mismatch assertion to throw at runtime.

**Status:** Pending Higgsfield support ticket (Yaron). Do NOT raise the constants until the ticket is resolved.

### Higgsfield `show_generations` — submitted `nano_banana_pro` displays as `nano_banana_2`
**Observed:** Requests submitted with `model: 'nano_banana_pro'` appear in the `show_generations` history view labelled `nano_banana_2`. Same behaviour for the kitchen canonical generated in PR-A revision and the PR-C smoke runs — so it is not a new regression.

**Open question:** Display-only quirk vs. silent model downgrade at submission time? Output quality has been acceptable in both PRs, so functionally we have proceeded — but the labelling discrepancy is unexplained.

**Status:** Pending Higgsfield support ticket (Yaron). Do NOT rename the model name string in the SKILL runtime or elsewhere until the ticket is resolved. Canonical comment block in `video/lib/location/flows/constants.ts`.

---

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
- health: purple/soft pink

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

---

## Avatar Full v5 (Seedance pipeline)

**Shipped 2026-05-19.** Replaces the legacy HeyGen-based `video/scripts/generate-avatar-video.ts` (retirement deferred). Hybrid orchestration: a Claude Code session interleaves Higgsfield MCP `generate_video` calls (Seedance 2.0, `medias=[start_image, audio]`) with invocations of `video/scripts/render-avatar-full-v5.ts --phase=<name>`. State flows through `workdir/v5-state.json`. Phase sequence: **`init` → `tts` → (MCP `generate_video` + `record` + `verify` per clip) → `face-metrics` → `normalize-clips` → `face-metrics` (re-measure) → `manifest` → `compose` → `upload` → `qa` → `summary`**. Full spec, lessons learned, and locked component designs: **[`docs/specs/AVATAR_FULL_V5.md`](docs/specs/AVATAR_FULL_V5.md)**.

### Non-negotiable v5.0 invariants (do not drift; spec wins on conflict)

- **`normalize-clips.ts` is MANDATORY** between `--phase=face-metrics` and `--phase=manifest`. Architectural mitigation for [YAR-137](https://linear.app/yarono/issue/YAR-137) Seedance fidelity drift — without it, opening face position/size varies ±150 px across renders from the same Soul still. Audio passthrough preserved via `-c:a copy`.
- **`SMTHookOverlay` is canonical** at `video/src/templates/shared/SMTHookOverlay.tsx` — rotated `-2°`, edge bleed `left/right: -100 px`, lower-third (`top: 68%`), 1.0 s hard cut in/out on clip 1 only. Visual must match the `generate-hook-card.ts` SVG. Do NOT build a new hook overlay; do NOT remove rotation or bleed.
- **`AvatarV5Captions` uses Whisper word-level timestamps from the SEEDANCE MP4 audio, NOT the original ElevenLabs MP3.** Phrase grouping at `video/lib/phrase-grouper.ts` (MAX_WORDS=4, GAP_THRESHOLD=0.3s). Style is white Inter Bold 52 px UPPERCASE with **minimal** shadow `0 2px 2px rgba(0,0,0,0.6)` for legibility (not zero shadow, not chunky decorative shadow). Mount inside each clip's `<Sequence>` so Remotion handles the global time offset.
- **Embedded-audio passthrough via `OffthreadVideo`** — no `volume={0}`, no separate `<Audio>` track, ever. Audio bridge between clips is a 4-frame `<Sequence>` overlap, NOT an audio re-overlay.
- **Whisper-verify every clip** post-render against the locked script. WER < 0.15 + speech_coverage ≥ 0.5. Retry escalation: std → fast → surface-to-human. Never silently accept a failed clip.
- **Motion blur defaults to disabled.** Normalization makes per-cut deltas ≤ 2 px; the 40 px threshold no longer fires. Per-cut re-enable available via `transitions_manifest.transitions[i].needs_motion_blur=true` after eye-check.
- **Cost ceiling 700 cr (~$9.10)** per piece. Actual observed: 81 cr / 9 s std clip at 1080p; 7-clip Avatar Full ≈ 531 cr ($6.90) with zero retries. Orchestrator's `--phase=record` auto-aborts at >700.
- **DB-flip-on-approval.** `--phase=upload` writes the final MP4 to Supabase but does NOT touch `content_queue.render_profile_id` or `metadata.video_url`. Those flip only after human approval of the final render (manually or via a future approval UI).

### PR-B (YAR-136) — wardrobe × location combination per render

**Shipped 2026-05-23.** `phaseInit` now resolves a wardrobe × location combination via `pickCombination` (from the [wardrobe-rotation skill](video/lib/wardrobe-rotation/)), runs Soul-2.0 pass-through on the nano_banana_pro anchored still ([video/lib/location/flows/generate-anchored-still.ts](video/lib/location/flows/generate-anchored-still.ts)) so identity is locked to canonical Rachel, and persists `look_id` / `location_id` / `still_id` back to `content_queue.avatar_config` with a re-SELECT post-write verify. The resolved Soul-locked URL lives on `v5-state.json` as `state.start_image_url` — `phaseQa` and the hook-card script consume it from there (no more hardcoded constant).

**`rachel_stills.soul_still_url` semantics changed:** the column now stores Soul-2.0 identity-locked outputs, not raw nano_banana_pro composition anchors. All 4 active rows backfilled at PR-B merge time via [scripts/backfill-soul-pass-through.ts](scripts/backfill-soul-pass-through.ts).

**RACHEL_SOUL_STILL_ID / RACHEL_SOUL_STILL_URL constants are deleted.** `RACHEL_SOUL_ID` (the Higgsfield Soul character UUID) lives in [video/lib/avatar-constants.ts](video/lib/avatar-constants.ts) and is re-exported from `wardrobe-rotation/index.ts`.

### Open follow-ups (do NOT block on these — v5.0 ships without them)

- [YAR-130](https://linear.app/yarono/issue/YAR-130) — Lip-sync analysis spike (MFCC + mouth ROI cross-correlation). `lip_sync` dimension is UNMEASURED in avatar-v1 QA today.
- [YAR-136](https://linear.app/yarono/issue/YAR-136) — PR-A (wardrobe), PR-C (location), PR-B (renderer integration) all shipped. Open: YAR-139 (bootstrap looks 03-11 + locations 03-08), YAR-140 (Seedance background drift mid-clip).
- [YAR-137](https://linear.app/yarono/issue/YAR-137) — Seedance fidelity (resolved via normalization for v5.0; open follow-ups: extend `motion-prompt-builder` with distance-lock language; evaluate Kling 3.0 / BytePlus alternatives).
