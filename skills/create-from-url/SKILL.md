---
name: create-from-url
description: >
  Manually-triggered "validated remixing" flow. Yaron gives a URL to a piece of
  content (a mom creator's carousel, a viral TikTok/Reel, etc.); this skill
  captures and analyzes it, then RECREATES an SMT version through the brand book +
  DNA (a Rachel piece, not a copy), gets Yaron's approval on the concept, renders
  the asset via the existing renderers (carousel-builder or the avatar/video
  pipeline), gets Yaron's approval on the finished asset, then enqueues it and
  hands off to smt_publisher. This is a parallel ingestion path that bypasses the
  research/strategist agents but rejoins the SAME rails (content_queue +
  scheduled_posts → publisher). Triggers on: "make the SMT version of this <url>",
  "remix this <url>", "recreate this for us", "here's a viral one, do our version".
  Loads SMT_PIPELINE_CONTRACT.md; the contract wins on conflict. It remixes, it
  never copies — and the AI Magic verbatim gate still applies.
version: 1.1.0
last_updated: 2026-06-10
owner: Yaron Orenstein
---

# SMT Create-from-URL v1.0.0

A manual, on-demand way to turn a proven piece of content into an SMT piece. It is
the standardized version of the ad-hoc "here's a creator's carousel, make our
version" request.

It is **orchestration only**. It does not re-implement rendering or publishing —
it captures, analyzes, recreates the concept in our voice, and then drives the
existing skills:
- **carousel-builder** for carousels,
- the **avatar/video pipeline** (`full-avatar-profile`) for video,
- **smt_publisher** for posting.

## Where it sits

```
[manual] URL → CAPTURE → ANALYZE → SMT-RECREATE (concept)
   → [approval #1: concept]
   → RENDER (carousel-builder | avatar/video)
   → [approval #2: finished asset]
   → ENQUEUE (content_queue + scheduled_posts) → smt_publisher
```

The normal pipeline is `Research → Strategist → ContentGen → ...`. This skill
**replaces the first three stages for one piece** with a human-supplied source,
then rejoins at `content_queue`/`scheduled_posts` exactly like an
agent-generated, web-app-approved piece. Everything downstream is unchanged.

---

## 0. Contract conformance & IP discipline (read first)

`SMT_PIPELINE_CONTRACT.md` is authoritative.

- **Remix, never copy.** We recreate the *idea and the proven structure* in
  Rachel's voice and SMT brand — we do not reproduce the source's wording,
  images, or design. The output must stand on its own as original SMT content.
  If you find yourself pasting the source's sentences, stop — that's copying.
- **AI Magic gate still applies.** If the recreated piece would be `ai_magic`, the
  contract's strict gate holds: a real, verbatim prompt + real, verbatim output +
  named tool + public source. We never fabricate a prompt/output to fill a remix.
  Most creator-carousel remixes are `parenting_insights` or `health`, where
  original copy in our own words is the norm.
- **One pillar per piece**, routed by the contract's rules — pick the pillar that
  fits the recreated content, not the source's framing.
- **Attribution (locked: no credit by default).** These are format/structure
  remixes rebuilt as original SMT content, so we do not credit the source. The
  output must stand on its own — if it can't without leaning on the creator's
  specific creative or footage, it isn't finished being recreated. (Exception
  stays only for cases where we directly reuse someone's actual footage/asset,
  e.g. Tech-for-Moms Tier 1 — not applicable to a normal text/carousel remix.)
- **No fabrication of source facts.** Capture what's actually there; if the
  capture is partial, say so — don't invent what the source "probably" said.

---

## 1. CAPTURE — pull the source down

Goal: get the source's media + text + metadata into a structured capture object.

- Try `web_fetch` first for open web pages.
- **Instagram / TikTok block direct fetch** (robots-disallowed) — do NOT stop
  there. Use the Apify path immediately (project canon): TikTok =
  `clockworks/free-tiktok-scraper`, Instagram = the IG post/hashtag scraper. Never
  accept "can't access" as final.
- If automated capture fails entirely, ask Yaron to paste screenshots / the asset
  directly into chat (the working fallback for IG image analysis).

Capture object:
```
{
  source_url, platform, creator_handle, engagement (views/likes/saves if visible),
  format: "carousel" | "video" | "image",
  slides: [{ index, on_screen_text, image_description }]   // for carousel
  | transcript_or_script, on_screen_text, hook,            // for video
  caption, hashtags
}
```

For a carousel, capture **each slide's text and role** (hook / item / CTA). For a
video, capture the hook, the beat sequence, and any on-screen text.

---

## 2. ANALYZE — extract the transferable structure

Pull out what made it work — the parts we can legitimately reuse (structure is not
copyrightable; specific expression is). Produce:

```
{
  hook_type,                 // e.g. "quiet confession", "number + payoff", "expectation flip"
  beat_sequence,             // the arc, slide-by-slide or scene-by-scene
  why_it_worked,             // 1-2 lines: the emotional/structural lever
  format,                    // carousel | video | image
  candidate_pillar,          // routed per the contract
  candidate_age_range,
  smt_angle                  // how Rachel would tell this truthfully, in our world
}
```

This is the creative brief for recreation — never a transcript to paraphrase.

---

## 3. SMT-RECREATE — rebuild it as a Rachel piece

Re-express the idea through brand + DNA:
- Load SMT canon (FACE_OF_SMT_V1, brand voice, content DNA, the locked palette/type
  from carousel-builder for carousels).
- Write fully original copy in Rachel's voice — warm, real, mom-to-mom. New hook,
  new lines, our framing. The source is the brief, not the script.
- Set the `hook_overlay` (3–6 words, on-screen) per SMT convention.
- Map to a render profile: a source carousel → `carousel`; a source talking-head /
  story video → `avatar-v1`; a text/slideshow video → `moving-images`.
- Honor the pillar gate (esp. `ai_magic` verbatim rule; `financial` first-person +
  disclaimer).

Output a **concept brief**: pillar, format, hook, hook_overlay, the slide texts or
the script, the proposed caption, and an optional **tone** (one word from the
emotional register of the piece, e.g. `warm`, `concerned`, `excited`, `playful`,
`reassuring`, `urgent`, `curious`). The tone rides to
`content_queue.metadata.tone` at enqueue (`RemixEnqueuePlan.tone`); the avatar
cover stage (`--phase=cover`) uses it to derive the cover's expression
directive deterministically and skip the Haiku call. Optional — when omitted,
the cover stage derives the directive from {hook, script summary} with one
cheap Haiku call.

---

## 4. APPROVAL #1 — concept

Show Yaron the concept brief next to a short note on the source (what it was, why
it worked). He approves / edits / rejects. Do not render until he approves. Fix
only what he flags; don't rebuild the whole concept on a small note.

---

## 5. RENDER — reuse the existing renderers

Hand the approved concept to the right renderer — do not reimplement rendering.

> **Critical (YAR-154): the renderers are content_queue-ROW-driven, not loose
> script.** The earlier wording here ("hand the script to `full-avatar-profile`,
> render, *then* insert a row in §7") is wrong and circular — the v5 renderer
> needs a row that §7 only created after rendering. The real flow creates a
> **draft** row first, renders against it, and §7 only flips it to approved.
> `video/scripts/write-avatar-config.ts` exists precisely to force a draft row
> through the renderer "without flipping `render_profile_id`."

**`avatar-v1` → Avatar Full v5** (`docs/specs/AVATAR_FULL_V5.md`; the
`full-avatar-profile` skill is the conceptual layer, v5 is the implementation):

1. **Create a DRAFT `content_queue` row** — status NOT `approved` (e.g. `draft`),
   `render_profile_id` left NULL. Pillar, hook (= the `hook_overlay`), caption,
   and provenance metadata (`source_url`, `creator_handle`) go on it now.
2. **Author `avatar_config`** and write it (via `write-avatar-config.ts` or a
   guarded SQL update — never flip status/`render_profile_id`):
   - `clips`: segment the approved script into ≥2 clips, each `{ id,
     expected_script }` — text VERBATIM, split only.
   - `look_id` + `location_id`: pin a render-ready Soul still (a `rachel_stills`
     row that already exists for that combo, so `init` doesn't try to generate
     one — `generateAnchoredStill` throws inside the Node renderer).
   - `voice_id` (Rachel), `register`, `hook`.
3. **Drive the v5 phases** (`render-avatar-full-v5.ts --phase=…` interleaved with
   Higgsfield MCP `generate_video`): `init → tts → (generate_video + record +
   verify per clip) → face-metrics → normalize-clips → face-metrics → manifest →
   compose → upload`. `upload` writes the final MP4 + `final_asset_url` +
   `render_status='complete'` but does **NOT** flip `render_profile_id` /
   `metadata.video_url` (those wait for approval #2).
4. **The deterministic QA gates are mandatory** (run automatically; a failing
   render is NOT done): audio-boundary, tail-trim, background-scale, hook-fit —
   see `full-avatar-profile/SKILL.md` "Mandatory deterministic QA gates".

Env prereqs the renderer needs (preflight): `video/` deps installed, the
`bin/face-metrics/.venv`, `ELEVENLABS_API_KEY` + `OPENAI_API_KEY` (in
`video/.env`), and Higgsfield credits.

- `carousel` → **carousel-builder**; `moving-images` → the slideshow pipeline.
  (Verify whether these are also row-driven before relying on the §7 "insert"
  wording for them — only the avatar path is confirmed here.)

Run the renderer's own preview/QA. Surface the result.

---

## 6. APPROVAL #2 — finished asset

Yaron reviews the rendered asset. This is the **same human gate** that web-app
approval provides for agent content, and it is what authorizes publishing. He
approves / requests fixes / rejects. Only an approved asset proceeds. Until then
the draft row stays `draft` / `render_profile_id` NULL — rendered but not live.

---

## 7. ENQUEUE + HANDOFF — rejoin the standard rails

On asset approval, the draft row from §5 **already exists** — do NOT insert a
second row. **UPDATE the existing draft row:**
1. Set status → `approved`, flip `render_profile_id` to the canonical render
   profile, confirm `final_asset_url` + `render_completed_at` (set by `upload`)
   and the human-approved flag. (`lib/create-from-url/enqueue.ts`'s
   `enqueuePiece` currently CREATEs a row with `finalAssetUrl` — for the
   avatar path it must be reconciled to update the pre-existing draft, not
   create a duplicate. Tracked in YAR-154.)
2. Insert one `scheduled_posts` row per target channel (`pending`), with the
   per-channel caption and `scheduled_for`.
3. Respect the §3 TikTok-carousel rule from the publisher: a carousel skips TikTok
   (Phase 1 browser) or converts to a slideshow MP4 — Yaron's call at approval #2.
4. Hand off to **smt_publisher**. From here it's the normal publish path.

Provenance: `source_url` + `creator_handle` were stored on the row's metadata at
§5 (internal traceability / dedupe). This is internal only — not public credit.

---

## Cadence note
Account cadence is **1 post/day, max 2** (updated 2026-06-09). Remix pieces count
against that budget — they don't post on top of it. A remix is an alternative
source for the day's piece, not extra volume.

## Token economy
Capture, structure extraction, and enqueue are deterministic where possible
(scrapers, parsing, templates). Use an LLM only for the genuinely creative steps
(analyze → recreate). Don't burn a model call on anything regex/templates handle.

## Open follow-ups
- If remix volume grows, consider a lightweight `remix_sources` table to dedupe
  (don't remix the same source twice) and to feed the Learning layer.
