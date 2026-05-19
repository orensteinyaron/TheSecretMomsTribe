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

Replaces the legacy HeyGen-based `video/scripts/generate-avatar-video.ts`.
**Operational spec:** `/docs/specs/AVATAR_FULL_V5.md` (transport, gate
definitions, output paths, follow-ups). **Build plan + history:**
`/docs/superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md`.

### Architecture
Hybrid orchestration. The **Claude Code session** orchestrates by interleaving
Higgsfield MCP `generate_video` calls (Seedance 2.0, `medias=[start_image,
audio]`) with invocations of `video/scripts/render-avatar-full-v5.ts
--phase=<name>`. State flows through `workdir/v5-state.json` (typed in
`video/lib/v5-state.ts`).

There is no production Node SeedanceClient in v5.0 — MCP is the transport.
The `SeedanceClient` interface exists at `video/lib/seedance/SeedanceClient.ts`
as the swap point for v5.x (`HttpSeedanceClient` or `BytePlusClient`).

### Phases (`--phase=…`)
| Phase | Owner | Purpose |
|---|---|---|
| `init` | CLI | Load `content_queue` row, normalize `avatar_config.clips`, write initial state |
| `tts` | CLI | Per-clip ElevenLabs MP3 → Supabase `post-images/avatar-full-v5/audio/` |
| *(MCP)* | Session | `generate_video` per clip with motion-prompt + start_image + audio MP3 URL |
| `record` | CLI | Capture Seedance result fields. **Aborts at >300 Higgsfield credits.** |
| `verify` | CLI | Whisper WER + speech-coverage gate. Exit codes: 0=PASS, 2=retry-fast, 3=surface-to-human |
| `face-metrics` | CLI | First+last frames → mediapipe sidecar → eye_y/face_x per endpoint |
| `manifest` | CLI | Transitions manifest (motion-blur gating + crop offsets) |
| `compose` | CLI | Remotion `AvatarV5Composition` → `workdir/final.mp4` |
| `upload` | CLI | Final MP4 → `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4` |
| `qa` | CLI | Shell out to `video/qa/run.ts` with `avatar-v1` profile (informational only) |
| `summary` | CLI | Human-review block: per-clip WER, per-cut bridge timestamps, motion-blur cuts, total cost, Phase 9 fallback hint |

### How To Invoke

In a Claude Code session that has the Higgsfield MCP loaded:

```
cd video/
WORKDIR=$(mktemp -d /tmp/v5-XXXXX)
npx tsx scripts/render-avatar-full-v5.ts --phase=init    --workdir=$WORKDIR --content-id=<uuid>
npx tsx scripts/render-avatar-full-v5.ts --phase=tts     --workdir=$WORKDIR
# For each clip:
#   Claude calls mcp__78d93fcf-…__generate_video with seedance_2_0 + medias[start_image, audio_url]
#   then `--phase=record --clip-id=… --job-id=… --video-url=… --cost-credits=… --mode=std`
#   then `--phase=verify --clip-id=…`  (retry on exit 2; surface on exit 3)
npx tsx scripts/render-avatar-full-v5.ts --phase=face-metrics --workdir=$WORKDIR
npx tsx scripts/render-avatar-full-v5.ts --phase=manifest --workdir=$WORKDIR
npx tsx scripts/render-avatar-full-v5.ts --phase=compose  --workdir=$WORKDIR
npx tsx scripts/render-avatar-full-v5.ts --phase=upload   --workdir=$WORKDIR
npx tsx scripts/render-avatar-full-v5.ts --phase=qa       --workdir=$WORKDIR
npx tsx scripts/render-avatar-full-v5.ts --phase=summary  --workdir=$WORKDIR
```

### Cost ceilings
- **Target:** under $6 / ~180 Higgsfield credits (for the 7-clip deepfakes piece).
- **Hard ceiling:** 400 credits (~$16). Orchestrator auto-aborts and surfaces. Revisable per-piece.
- Whisper + ffmpeg + mediapipe + Supabase + Sonnet QA add ~$0.65.

### Pre-flight
1. Higgsfield MCP loaded (verify with `models_explore`)
2. `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set (loaded from `<SMT-root>/.env`)
3. Python venv ready: `cd bin/face-metrics && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
4. `ffmpeg` / `ffprobe` on PATH

### Validation
`video/scripts/validate-avatar-v5-passthrough.ts` renders a single existing
Seedance MP4 through `AvatarV5Composition` and Whisper-compares input/output.
Used to verify **YAR-129 Finding 4 (embedded audio passes through cleanly)**
before spending Higgsfield credits. Costs ~$0.002 (Whisper only).

### Per-bridge ear-check (Phase 9)
`--phase=summary` lists each cut individually with its timestamp so a reviewer
can ear-check each bridge moment specifically:
```
SCENE_01 → SCENE_02  at t=8.900s  [BRIDGE]  + motion blur
SCENE_02 → SCENE_03  at t=16.733s  [BRIDGE]
```
If any bridge sounds rough: edit `workdir/v5-state.json`, set
`transitions_manifest.transitions[i].bridge_enabled=false`, rerun compose +
upload + summary. Per-cut fallback to hard cut, not all-or-nothing.

### What v5.0 does NOT do
- Flip `content_queue.status` — final video surfaces to a human-review queue.
- Touch the legacy HeyGen `generate-avatar-video.ts` — retired in a separate PR after v5 ships one approved piece.
- Implement punch-in (115% emphasis-line scale) — deferred to v5.1. See `docs/specs/AVATAR_FULL_V5.md` "Follow-ups".
- Implement the register system schema extension (YAR-129 Gap 2) — deferred to v5.2.
- Run unattended from GitHub Actions — needs HTTP transport (YAR-129 cost-architecture spike) first.
