---
name: smt-pipeline-contract
description: The single source of truth for what each agent owes the next in the SMT content pipeline. Every agent loads this file in addition to its own SKILL.md. If a field in this contract is missing on input, the agent MUST abort with a structured error instead of fabricating it. Use this whenever debugging a pipeline failure, designing a new agent, or changing the schema of any handoff between Research Agent, Strategist - Daily Pulse, or Content Agent - Text Gen.
version: 2.0.0
last_updated: 2026-05-17
owner: Yaron Orenstein
---

# SMT Pipeline Contract v2.0.0

## Changelog
- **v2.1.0 (2026-05-19):** ADDITIVE. New Stage 4: Rendering section documents the per-render-profile pipelines downstream of ContentGen + caption polish. Avatar Full v5.0 (`render_profile_slug=avatar-v1`) is the first profile with a locked phase sequence (init → tts → record/verify per clip → face-metrics → **normalize-clips (REQUIRED)** → face-metrics → manifest → compose → upload → qa → summary). Documents the v5.0 invariants (embedded-audio passthrough, Whisper-verify-every-clip, SMTHookOverlay canonical, captions from Seedance MP4 not ElevenLabs MP3, motion blur defaults disabled, DB-flip-on-approval). Spec: `docs/specs/AVATAR_FULL_V5.md`. No agent prompts change; no breaking validation. Stages 1-3.5 unchanged.
- **v2.0.0 (2026-05-17):** BREAKING. `post_format` enum deprecated. Format is now `render_profile_slug` (one of `avatar-v1`, `moving-images`, `static-image`, `carousel`). Per-channel state (captions, schedule, posting) moves to a new `scheduled_posts` table. Legacy fields (`post_format`, `scheduled_at_ig`, `scheduled_at_tt`, `published_at_ig`, `published_at_tt`, `published_url_ig`, `published_url_tt`, `channel_override`) are hard-rejected by `gate_validators.rejectLegacyFormatFields`. See `docs/specs/CHANNEL_MODEL_V1.md`.
- **v1.0.0 (2026-05-11):** initial contract — pillar routing law, AI Magic strict gate, defensive verbatim quote check.

This document is the **handoff schema** between agents. It is enforced at the row level. Every agent in the pipeline reads this file at startup and validates inputs against it before doing any work.

The pipeline is:

```
Research Agent
    │ produces: opportunity[]
    ▼
Strategist - Daily Pulse
    │ produces: briefing (curated, gated opportunity[])
    ▼
Content Agent - Text Gen
    │ produces: content_queue row
    ▼
[Render → Publish → Metrics → Learning]
```

## Non-negotiable principles

These are inviolable. Any agent that violates them must abort with `status='failed'` and a structured error.

1. **No fabrication.** No agent invents source content. If a field requires a verbatim artifact from a real source, the field must contain that artifact byte-for-byte or the row must be rejected. An agent never "fills in" what it thinks the source said.

2. **Gates over guesses.** Every agent runs a hard schema check before generating anything. If required fields are missing, the agent aborts. It does not attempt to recover by inferring.

3. **Pillar routing is structural, not optional.** A row's `content_pillar` is determined by the type of evidence carried in the row, not by the agent's editorial preference. The routing rules in this contract are the only valid mapping.

4. **One pillar per row.** A row belongs to exactly one pillar. If evidence supports multiple pillars, the row must be split or the strongest-evidenced pillar chosen with the rest discarded.

5. **Errors are first-class output.** Every agent's response schema includes a `rejected[]` array alongside its primary output. Rejected items carry a reason and the failing field. Rejection is not failure — it is the correct behavior when gates are not met.

## Pillar routing rules (the law)

A row's pillar is determined entirely by what evidence the underlying signal carries. The Research Agent assigns pillar by running this checklist top-down and stopping at the first match.

### `ai_magic` — STRICT GATE
A signal qualifies as `ai_magic` if and only if **all four** of the following are true:

- The source contains a **verbatim AI prompt** that was actually entered by a real person into a real tool (`original_prompt`, copy-pasteable as-is).
- The source contains the **verbatim AI output** that resulted from that prompt (`original_output`, the actual text/image/result the AI returned).
- The source identifies the **AI tool used** (`ai_tool_name`, e.g. "ChatGPT", "Claude", "Midjourney").
- The source URL is **publicly accessible and the artifact is visible at that URL** (not behind a login wall, not paraphrased by the scraper).

If any of these four is missing, the row **cannot** be `ai_magic`. Falling back to another pillar is allowed only if that pillar's gate is met.

A mom *asking* a question (e.g. "how do I tell my 4yo about her absent dad?") is **never** an AI Magic signal. It is a Parenting Insights signal. The question is not a prompt; the empathy in the responses is not an output.

### `parenting_insights`
Signals about parenting situations, emotional dynamics, child development, family communication. Mom-to-mom conversations on Reddit/IG/TikTok asking for advice or describing a moment with their kid land here by default. No verbatim AI artifact required.

### `health`
Signals about maternal mental load, burnout, nervous system, postpartum recovery, identity, marriage stress. Trust-builder content.

### `tech_for_moms`
Signals about specific apps, devices, services, or shortcuts that solve a mom's real-life logistical problem. Lead with the result, not the tool. Distinct from `ai_magic`: `tech_for_moms` is "I found a great app for tracking kids' schedules"; `ai_magic` requires a verbatim prompt + output.

### `trending`
Time-sensitive cultural moments: viral takes, news stories, studies the parenting internet is currently fighting about. Has a 72h expiry window.

### `financial`
First-person framing only. No specific products, stocks, crypto, tax, or legal. Mandatory caption disclaimer.

## Format and channels (v2.0.0)

A piece has **exactly one format** (a render profile) and **at least one channel** (where it gets posted). These are independent dimensions.

### Format = render profile

Format is the slug of one row in the `render_profiles` table. The four canonical slugs are:

- `avatar-v1` — Rachel speaking, full avatar or avatar+visual. Stored in `render_profiles.output_spec.formats: ["full_avatar","avatar_visual"]`; the specific variant is carried by `avatar_config.format` on the piece.
- `moving-images` — slideshow video (hook → slides → CTA) with TTS + Pexels b-roll.
- `static-image` — single PNG (1080×1920).
- `carousel` — IG-style multi-slide image set.

`post_format` (the legacy enum that conflated channel and format) is dropped. The Content Agent emits `render_profile_slug` directly. Any agent that emits a legacy `post_format` field is hard-rejected by `gate_validators.rejectLegacyFormatFields`.

### Channel = where it gets posted

Channels are independent of format. Every piece, by default, targets BOTH:

- `tiktok`
- `instagram`

Other channels (YouTube Shorts, Threads, Bluesky) are not supported in v2.0.0; expansion happens via `ALTER TYPE channel ADD VALUE` when a channel is committed to.

Per-channel state lives in `scheduled_posts (content_id, channel)`:

```
scheduled_posts:
  id, content_id, channel, status, caption, scheduled_for, published_at,
  post_url, external_post_id, failure_reason, created_at, updated_at

  status: 'pending' | 'scheduled' | 'posted' | 'failed' | 'skipped'
  UNIQUE (content_id, channel)
```

When ContentGen produces a piece, the orchestrator:
1. Inserts the row into `content_queue` with `render_profile_id` set.
2. Inserts one `scheduled_posts` row per target channel with `status='pending'` and the channel-native caption.

The legacy inline columns on `content_queue` (`scheduled_at_ig`, `scheduled_at_tt`, `published_at_ig`, `published_at_tt`, `published_url_ig`, `published_url_tt`, `channel_override`) are dropped. Do not read or write any of them.

### Caption-per-channel

Captions are platform-native:

- **TikTok caption:** short, hook-first, hashtag-dense. On-screen text is the real payload. Target ≤100 chars, hard cap 150.
- **Instagram caption:** longer prose, storytelling, hashtags buried at end or in first comment. Target ≤400 chars, hard cap 2200.

A piece carries:
- `caption` on `content_queue` — the LLM's base/storytelling caption (used as fallback when a channel-specific variant is absent).
- `caption` on each `scheduled_posts` row — the platform-native variant for that channel.

The platform-native variants are produced by a separate Haiku polish step (1 call per channel = 2 calls per piece by default). The base caption from the main LLM is the input; the Haiku output is what the publish agent reads.

## Required fields by pillar

Every row that leaves any agent must conform to the pillar-specific schema below. Fields marked **REQUIRED** are gate fields — missing one causes rejection.

### All rows (regardless of pillar)
```
{
  "content_pillar": <one of the six>,             // REQUIRED
  "signal_id": <uuid of the source signal>,      // REQUIRED
  "source_url": <real, fetchable URL>,           // REQUIRED
  "source_platform": "reddit" | "tiktok" | "instagram" | "hacker_news" | "web",  // REQUIRED
  "source_creator": <username/handle if available, null if scraped>,
  "engagement": { "upvotes": int, "comments": int, "views": int },
  "age_range": "toddler" | "little_kid" | "school_age" | "teen" | "universal",  // REQUIRED
  "channel_type": "ai_native" | "mom_parenting" | "general",     // REQUIRED
  "signal_strength": int 1-10,
  "captured_at": ISO8601 timestamp
}
```

### Additional REQUIRED fields when `content_pillar == "ai_magic"`
```
{
  "original_prompt": <verbatim AI prompt from source, copy-pasteable, ≥10 chars>,   // REQUIRED
  "original_output": <verbatim AI output from source, ≥30 chars>,                   // REQUIRED
  "ai_tool_name": <tool used, e.g. "ChatGPT", "Claude", "Midjourney">,              // REQUIRED
  "artifact_excerpt_or_full": "full" | "excerpt"                                     // REQUIRED
}
```

If any of these four are missing or appear paraphrased, the row is **not** AI Magic. Reject or re-route.

### Additional fields for other pillars
- `trending`: `expires_at` (signal + 72h) REQUIRED.
- `financial`: `disclaimer_text` REQUIRED in caption.
- All other pillars: no additional required fields beyond the base.

## Handoff stages

### Stage 1: Research Agent → Strategist
Research outputs:
```json
{
  "opportunities": [<row>, <row>, ...],
  "rejected": [
    {"signal_id": "...", "reason": "ai_magic_gate_failed: missing original_output", "field": "original_output"},
    ...
  ],
  "stats": { "scanned": int, "kept": int, "rejected": int, "by_pillar": {...} }
}
```

Every row in `opportunities[]` already conforms to the schema above. The Strategist may *not* receive a row missing required fields. If Research's gate logic is uncertain about a row, the row goes into `rejected[]`, never into `opportunities[]`.

### Stage 2: Strategist → Content Agent
Strategist outputs a briefing:
```json
{
  "briefing_id": <uuid>,
  "opportunities": [<row>, ...],            // a subset of Research's, possibly re-ordered
  "priorities": [<signal_id>, ...],          // ordered by priority for the day
  "coverage_targets": { "ai_magic": int, "parenting_insights": int, ... },
  "rejected_from_research": [...],           // pass-through
  "notes_for_content_gen": <string>          // editorial guidance, NEVER includes invented content
}
```

The Strategist may re-rank but may **not** alter the gate-verified fields (`original_prompt`, `original_output`, etc.). The Strategist may **not** add invented examples (e.g. `"Show the prompt (e.g., 'My 4yo is asking…')"` — this is the exact failure mode that caused the May 11 incident).

### Stage 3: Content Agent → content_queue + scheduled_posts
Content Agent reads the briefing and produces one piece per opportunity. For each piece:

1. Validate that the opportunity passes its pillar's gate (defensive — Research and Strategist should have already done this).
2. If pillar is `ai_magic`, the `ai_magic_output` field **must** quote `original_prompt` and `original_output` verbatim. The Content Agent may add framing language around them but may not modify them.
3. Emit `render_profile_slug` (NEVER `post_format` — that field is dropped). The slug must be one of `avatar-v1`, `moving-images`, `static-image`, `carousel`.
4. Emit `channels` array — the channels this piece targets. Default: `['tiktok', 'instagram']`.
5. Emit `caption` — the base/storytelling caption. The downstream Haiku polish step generates platform-native variants from this base.
6. If the gate fails at this stage, the Content Agent aborts on that row with a `rejected[]` entry. It does not generate a fallback.

The orchestrator persists the piece atomically:
- One `content_queue` row with `render_profile_id` resolved from `render_profile_slug`.
- One `scheduled_posts` row per channel in `pending` status, with the platform-native caption.

### Stage 3.5: Caption polish (Haiku, downstream of Stage 3)
For each piece × each channel, Haiku generates a platform-native caption from the base caption + hook + content metadata. The output is written to `scheduled_posts.caption` for that (content_id, channel) row. Failure here is non-fatal — the publish agent falls back to `content_queue.caption` if the per-channel caption is null.

### Stage 4: Rendering — per render-profile pipelines (post-ContentGen)

Stages 1-3.5 produce a `content_queue` row with `render_profile_slug` set; Stage 4 is the per-profile renderer that turns the row into a final MP4/PNG asset. The renderer is OUT-of-scope for the Orchestrator skill (which currently terminates at the ContentGen + caption-polish handoff), but its handoff schema is part of the contract so future automation can pick it up.

**Render profiles and their entry points:**

| `render_profile_slug` | Pipeline | Entry point | Spec |
|---|---|---|---|
| `avatar-v1` | **Avatar Full v5 (Seedance)** | `video/scripts/render-avatar-full-v5.ts --phase=<name>` driven from a Claude Code session w/ Higgsfield MCP loaded | [`docs/specs/AVATAR_FULL_V5.md`](../../docs/specs/AVATAR_FULL_V5.md) |
| `moving-images` | Slideshow with Pexels b-roll + TTS | `video/scripts/generate-video.ts` | (no v5-style spec; pre-dates the per-profile skill split) |
| `static-image` | Single PNG generated via DALL-E | `video/scripts/generate-hook-card.ts` (variant) | inline |
| `carousel` | Multi-slide image set | TBD — not yet implemented | — |

**Avatar Full v1 canonical phase sequence** (v5.0, shipped 2026-05-19):

```
init → tts → (MCP generate_video + record + verify per clip)
     → face-metrics → normalize-clips → face-metrics (re-measure)
     → manifest → compose → upload → qa → summary
```

The **`normalize-clips` step is REQUIRED** between the first `face-metrics` pass and `manifest`. It is the architectural mitigation for [YAR-137](https://linear.app/yarono/issue/YAR-137) Seedance fidelity drift — without it, opening face position/size varies ±150 px across renders from the same Soul still. See AVATAR_FULL_V5.md "Post-process normalization (REQUIRED)" for the full rationale.

**v5.0 non-negotiable invariants** (do not drift — change the spec, the code, AND this contract together or none):
- Embedded-audio passthrough via `OffthreadVideo` — no `<Audio>` re-overlay, ever
- Whisper-verify every clip post-render against the locked script (WER < 0.15, coverage ≥ 0.5)
- Retry escalation per clip: std → fast → surface-to-human
- `SMTHookOverlay` canonical: rotated -2°, ±100 px edge bleed, lower-third, 1.0 s hard cut, clip 1 only
- `AvatarV5Captions` derived from Whisper word-level timestamps on the **Seedance MP4** (not the ElevenLabs MP3)
- Motion blur defaults to disabled (normalization makes it visually unneeded)
- DB writes are gated on human approval: `--phase=upload` writes the final MP4 to Supabase but does NOT touch `content_queue.render_profile_id` or `metadata.video_url`. Those flip only after human approval.

**Cost envelope (per Avatar Full piece, observed actuals):** ~531 Higgsfield credits + ~$0.013 Whisper ≈ **$7 total**. Ceiling 700 cr (`--phase=record` auto-aborts above).

**Open follow-ups (do not block on these):** [YAR-130](https://linear.app/yarono/issue/YAR-130) lip-sync analysis spike; [YAR-136](https://linear.app/yarono/issue/YAR-136) wardrobe rotation across 11 locked looks (required before the SECOND Avatar Full piece — current pipeline reuses Look #1); [YAR-137](https://linear.app/yarono/issue/YAR-137) Seedance fidelity follow-ups (motion-prompt distance-lock language; model alternatives evaluation).

**Future automation:** when a renderer-orchestrator skill ships (peer to `smt_orchestrator`), it will pick up `content_queue` rows where `render_profile_slug='avatar-v1'` and `status='approved'`, execute the phase sequence above, and surface the result to a human-review queue. The Skills v2.0.0 architecture supports this addition without breaking the existing Research → Strategist → ContentGen contract.

### Fail-closed: legacy field rejection
Any output from any agent containing `post_format`, `scheduled_at_ig`, `scheduled_at_tt`, `published_at_ig`, `published_at_tt`, `published_url_ig`, `published_url_tt`, or `channel_override` is hard-rejected by `gate_validators.rejectLegacyFormatFields`. The orchestrator writes the raw output to `content_queue_rejected` and escalates. This catches any LLM regression to the v1.0.0 shape.

## Failure modes the contract prevents

This contract is designed to make these specific failures impossible:

1. **Fabricated AI prompts.** A signal that is not a verbatim AI artifact cannot enter the AI Magic pillar. The gate is the same at every stage. (May 11 incident.)

2. **Mis-routed pillars.** A Parenting Insights signal cannot be silently relabeled `ai_magic` because the editorial inputs to the content agent told it to "show the prompt."

3. **Cascading invention.** The Strategist cannot inject example prompts into its handoff. Editorial guidance is restricted to ordering, prioritization, and pillar mix — never to content invention.

4. **Silent rejection.** Anything dropped must appear in `rejected[]` with a reason. We can audit what was thrown out and why. Drift in the rejection rate is itself a learning signal.

5. **Cross-pillar bleed.** A row has exactly one pillar. No multi-tagging, no fallback inference at generation time.

## Versioning and learning loop

This contract is versioned. Any change to it requires:
- A new `version` in the frontmatter.
- A migration note in `CHANGELOG.md`.
- A regression test set (a stored input + expected output + expected rejected[]) that the new contract must pass.

When an incident occurs (like the May 11 fabrication), the workflow is:
1. Reproduce the failure with the affected `signal_id` against the current contract.
2. Identify which gate should have caught it.
3. If the gate is missing or weak, strengthen it in the contract and bump the version.
4. Add the failing case to the regression test set.
5. Re-run all skills against the regression set before deploying.

The contract gets smarter with every incident. Agents don't drift, because their behavior is defined here and validated against this file at runtime.

## How agents load this contract

Each agent's SKILL.md instructs it to read `SMT_PIPELINE_CONTRACT.md` at startup. The agent's system prompt is the concatenation of:

```
[Agent SKILL.md]
+
[SMT_PIPELINE_CONTRACT.md]
+
[Brand Voice Bible, Content DNA Framework, Visual Design Guide — for ContentGen only]
```

The agent treats the contract as authoritative. If its SKILL.md and the contract disagree, the contract wins, and the agent flags the disagreement in its output for review.
