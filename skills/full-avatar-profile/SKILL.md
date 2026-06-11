---
name: full-avatar-profile
description: Production pipeline for SMT's "Full Avatar" video format. Takes an approved script and a chosen character from the avatar library, produces a final 9:16 mp4 (with hook card opening, captions, watermark, smooth transitions) and a thumbnail PNG. Use this skill when the user asks for a Full Avatar video, an "Avatar Full" piece, or generation of a talking-head Rachel-style clip from an approved script. Does not handle research, ideation, script generation, or publishing — those are upstream/downstream phases.
---

# Full Avatar Profile — Production Skill

## What this skill does

Takes two inputs:
1. **Approved script** — JSON with scenes, dialogue, emotion tags, durations, and a `hook_overlay` field
2. **Character selection** — character ID from the avatar library (e.g. Rachel)

Produces three outputs (the **three-asset contract**: video + thumbnail + cover, all on the same `content_queue` row):
1. **Final mp4** — 9:16, 1080×1920, with: 2s hook card opening → 6 avatar clips with smooth crossfades → phrase captions → watermark (`final_asset_url`)
2. **Thumbnail PNG** — 1080×1920, the video's opening frame + purple hook banner (`thumbnail_asset_url`). This is the frame-faithful cover; TikTok uses it (its API/composer only supports frame-based covers).
3. **Cover PNG** — 1080×1920, a purpose-generated image (`cover_asset_url`): same woman, same room, same lighting and wardrobe as the reel, but different expression/pose/framing, so the IG grid doesn't read as N identical frontal Rachels. Staged as the IG Reels cover. See [Cover stage](#cover-stage-phasecover) below.

## When to use

Primary trigger: the **orchestrator** dispatches a content piece with `render_profile = avatar-v1` (or future Full Avatar variants). The orchestrator is the default caller — it routes approved scripts to this skill based on the piece's render profile.

Secondary trigger: a human user explicitly asks for a "Full Avatar" / "Avatar Full" video, or a talking-head video using a character from the avatar library.

Do **not** trigger this skill for: Moving Images, AI Magic Video, Carousel, Avatar+Visual 50/50, Ask Rachel. Those have their own skills with their own render_profile slugs.

## When NOT to use / when to escalate

- Script not yet approved — return error to caller, do not generate
- `render_profile` is not `avatar-v1` — return error, wrong skill
- Character not in the library — return error with list of available characters
- Script missing `hook_overlay` field — return error, do not invent one
- Caller asks for research/ideation/publishing — out of scope, return error

## Inputs

### Required
```json
{
  "script": {
    "title": "string",
    "hook_overlay": "string (3-6 words)",
    "scenes": [
      {
        "scene_id": "SCENE_1",
        "order": 1,
        "script": "spoken dialogue",
        "emotion_tags": "[thoughtful][warm]",
        "target_duration_s": 9
      }
    ]
  },
  "character_id": "rachel"
}
```

### Character library
Each character record contains:
- `character_id` — slug (e.g. `rachel`)
- `name` — display name
- `soul_id` — Higgsfield Soul 2.0 character ID
- `soul_still_media_id` — Higgsfield media UUID for the locked Soul-generated still (used as both `start_image` and `end_image`)
- `voice_id` — ElevenLabs voice ID
- `voice_settings` — stability, style, model
- `prompt_template` — the cleaned Seedance prompt (no feature instructions)

## Pipeline (in order)

1. **Validate inputs** — script has all required fields, character exists in library, scene durations sum to ≤45s
2. **Generate audio per scene** — ElevenLabs v3 with `eleven_v3` model, character's voice_id, emotion tags inline. Save each scene's mp3, measure actual duration
3. **Adjust scene durations** — set Seedance duration per scene to ceiling of measured audio duration, capped at 15s
4. **Generate avatar clips** — for each scene, call Seedance 2.0 via Higgsfield with:
   - `model: seedance_2_0`
   - `start_image` and `end_image`: character's soul_still_media_id
   - `audio`: scene's uploaded mp3
   - `prompt`: character's prompt_template (verbatim — never inject feature descriptions)
   - `aspect_ratio: 9:16`, `resolution: 720p`, `mode: std`
   - Submit sequentially (proxy-friendly), poll until all complete
5. **Run QA agent** — patched identity-markers QA on all clips. If any clip scores <3 on identity-markers OR shows hard-fail hallucinations (forehead wrinkles, dropped moles, missing markers), pause and surface to user before stitching
6. **Generate hook card PNG** — call `generate-hook-card.ts --still-url=<state.start_image_url>` (PR-B made `--still-url` required; pass the same Soul-locked URL the v5 phaseInit picked for this render, available at `state.start_image_url` in `v5-state.json`). Output: 1080×1920 PNG
7. **Stitch clips** — call `stitch-avatar.ts` with:
   - Ordered scene list
   - 200ms xfade + acrossfade between clips
   - Hook card PNG as 2s held opening
   - PhraseCaptions style (no background band, white text + shadow)
   - BrandWatermark
8. **Generate the cover** — after the video upload completes, run the cover stage (`render-avatar-full-v5.ts --phase=cover`). Never blocks or alters the video flow. See [Cover stage](#cover-stage-phasecover).
9. **Upload to Drive** — push final assets to `Yarono/SMT/content/{content_id}/` (folder created if missing). See [Storage](#storage).
10. **Write `content_assets` rows** — one Supabase row per uploaded asset, joined to `content_queue` by `content_id`. See [Storage](#storage).
11. **Output** — return local paths + Drive IDs + QA verdict + cost. See [Outputs](#outputs).

## Cover stage (phaseCover)

Added 2026-06-11. The IG grid crops reel covers to 3:4 and, with first-frame
thumbnails only, every tile was a near-identical frontal Rachel — reading as
AI-replicated content. The cover stage generates a second, purpose-made visual
per piece. Implementation: `video/lib/cover/` + `--phase=cover` /
`--phase=cover-record` in `render-avatar-full-v5.ts`.

**Architecture — external model, reference-based (NOT Higgsfield):**
- Primary: **Gemini Nano Banana** (`gemini-2.5-flash-image`), called directly
  with `GEMINI_API_KEY` in `.env`. Cost reduction + future migration off
  Higgsfield.
- Identity comes ONLY from the reference image: the render's Soul-locked
  `start_image` (same `look_id`, `location_id`, lighting as the reel) is
  passed as the edit reference. The prompt says "same woman, same room, same
  lighting and wardrobe" + the expression/pose/framing directive. **Never
  describe Rachel's facial features in text** — same hallucination rule as
  Seedance prompts.
- Expression directive: when the concept brief carries `tone` metadata
  (`avatar_config.tone` ?? `metadata.tone`), it maps deterministically to
  {expression, gaze, pose} — no LLM call. Otherwise one cheap Haiku call maps
  {hook, script summary} → the same small JSON.

**Fallback chain** (registered in the `services` table:
`gemini_nano_banana` → `fallback_service_id` → `higgsfield_soul`):
1. Gemini Nano Banana
2. Gemini retry with an adjusted (identity-anchored) prompt
3. Soul 2.0 via Higgsfield — last resort, session-driven: `--phase=cover`
   exits 5, the Claude session generates via Higgsfield MCP using
   `state.cover.soul_fallback_prompt`, then records it with
   `--phase=cover-record --image-url=<url>`.

The tier that produced the final cover is logged in `metadata.cover.source`
(`gemini` | `gemini_retry` | `soul_higgsfield`).

**Variance rules** (`metadata.cover` stores {expression, framing,
composition_side}): any combination used in the last 5 covers is excluded;
framing rotates close-up → medium → three-quarter; composition drifts
slightly off-center. Same atmosphere as the reel — different energy in the
face and frame.

**Output spec:** 9:16 (1080×1920); the face and the hook text sit fully
inside the IG 3:4 center-crop safe zone (rows 240–1680); the purple hook
banner uses brand styling (band `BRAND_PRIMARY #7941EA`, shadow `INK
#220758`, Poppins ExtraBold, off-white text) with the same `hook_overlay`
text as the video.

**QA — mandatory gate, not advisory** (reference-based generation drifts
more than Soul):
- Identity scored as **"matches reference"** against the start_image (1–5;
  pass ≥ 3, the same bar as the clip identity-markers gate) — never
  feature-presence. Below threshold → next fallback tier.
- Scene continuity: location / wardrobe / lighting must match the reference
  still.
- Sameness: flag if the expression/framing combo matches the previous cover.
- Unmeasurable dimensions return `"unmeasured"` and the gate **fails closed**.

**Persistence + post-check:** one `content_queue` update writes
`thumbnail_asset_url` (the first-frame + hook PNG, previously transient, now
extracted from final.mp4 at 0.5s and uploaded) + `cover_asset_url` +
`metadata.cover`. The post-check re-reads the row, asserts both URLs are
non-null AND fetchable (HTTP HEAD) — any failure throws. No silent passes.

**Publishing routing:** IG Reels passes `cover_asset_url` as the cover
(browser composer "Edit cover" in Phase 1; `cover_url` on the container in
Phase 2). **TikTok limitation:** its API only supports frame-based covers
(`video_cover_timestamp_ms`), so TikTok keeps the current behavior — the
default first frame, which matches `thumbnail_asset_url` by construction.

**Cover cost per piece:** directive $0–0.001 (tone path is free) + Gemini
$0.039/image + Sonnet QA ~$0.02 ≈ **$0.06** (one-attempt happy path).

## Hard rules (do not violate)

- **Never inject feature descriptions into the Seedance prompt** when using a Soul 2.0 character. Soul carries identity. Adding "scar preserved" or "smooth forehead" or any feature directive causes hallucination.
- **QA scoring is "matches reference," not "feature present yes/no"** — use the patched identity-markers prompt that compares enumerated markers between reference still and generated frame.
- **Calibrate before trusting** — if the QA agent has been modified since the last calibration, manually score 2 clips first. Do not auto-pass new agent versions.
- **Hook overlay is mandatory** — every Full Avatar script must include `hook_overlay` (3-6 words, on-screen text version of the spoken opener). If missing, escalate to user. Do not generate one automatically.
- **Token economy** — use Haiku for QA framing, Sonnet only for the per-frame identity-markers vision call. Never call an LLM where deterministic code (ffmpeg, sharp, regex) suffices.
- **Single render file for cross-posting** — the same final mp4 ships to both Instagram and TikTok. Do not re-export per platform.

## Mandatory deterministic QA gates (added 2026-06-10 — every shipped defect left one behind)

The identity-markers vision QA is necessary but not sufficient: it shipped renders with a chopped-word click, two different backgrounds, and an overflowing hook because nothing measured those. These deterministic gates run automatically (in `normalize-clips` / `--phase=compose`) and a render that fails them must NOT be presented as done:

- **Audio-boundary gate** (`video/lib/audio-boundary-check.ts`, run in compose). Max sample-jump at each cut, counted ONLY in quiet/faded regions (a real splice click), must be ≤ 0.01. Gating by local energy is essential — an un-gated jump threshold false-positives on normal speech slope near the cut.
- **Tail-trim** (`video/lib/tail-trim.ts`, run in normalize). Silence-aware: removes Seedance trailing transients (mouth-click/breath after the last word) that otherwise click at the stitch. NOT a fixed `last_word + 0.1 s` pad (Whisper under-counts word-ends).
- **Background-scale gate** (`video/lib/background-consistency-check.ts`, run in normalize). All clips MUST share one normalize scale (ratio ≤ 1.02). Per-clip face-size scaling zooms clips differently → background decor cropped from some clips, kept in others → two different backgrounds. (A pixel/histogram output gate was tried and rejected: the intentional face-size variance dominates it.)
- **Hook-overlay fit** (`SMTHookOverlay.tsx`). Length-responsive font + hard width cap — a fixed 124 px font overflows long hooks. Eyeball the 0.4 s hook frame on every render.

## Debugging discipline for A/V artifacts (the expensive lessons)

- **Measure, never guess.** Decode to PCM and scan sample-jump / short-window RMS; use Whisper word-timestamps; render waveform/spectrogram PNGs and read them; compare raw-vs-normalized frames. Guessing (disable the bridge, re-roll the clip) cost multiple wrong fixes and wasted Higgsfield credits before one measurement found the cause.
- **A defect at a stitch/transition is a COMPOSITION bug, not a content bug.** Do not re-roll clips to fix a stitch — re-rolls waste credits AND introduce new Seedance variance (a re-roll here drifted Rachel's framing and face size, making things worse). Fix the compose.
- **Trust the code, not the comment.** The "audio bridge ramps in / tails out" comment described a cross-fade that was never implemented.
- **Remotion `volume` callbacks are per-frame (stepped) → they click on fast fades.** Bake sample-accurate `afade` cross-fades into the clip audio in `normalize-clips` instead; keep `OffthreadVideo` a pure passthrough (Finding 4).
- **A transform that fixes one property can break another** — face-size normalization broke background framing. Check side effects.

## Cost budget per piece

| Step | Cost |
|---|---|
| ElevenLabs (6 scenes ~40s) | ~$0.05 |
| Seedance × 6 clips | ~150 credits (~$1.50) |
| Whisper (full audio) | ~$0.01 |
| QA agent (Sonnet vision) | ~$0.55 |
| Hook card render | $0 |
| Stitch + watermark | $0 |
| **Total** | **~$2.10 per piece** |

If a run projects >$5, pause and surface to user.

## Wall-clock budget

- Audio generation: ~30s
- Seedance × 6 (sequential, ~25s each): ~3 min
- QA: ~30s
- Hook card: ~10s
- Stitch: ~50s
- **Total: ~5 min wall clock**

## Outputs

Local paths point to the tmp working directory and are valid for the duration of the run; durable references are the Drive IDs.

```json
{
  "content_id": "uuid",
  "final_mp4": {
    "local_path": "/tmp/avatar-stitch-<runId>/final.mp4",
    "drive_file_id": "1abc...",
    "drive_path": "Yarono/SMT/content/{content_id}/final.mp4"
  },
  "thumbnail_png": {
    "local_path": "/tmp/avatar-stitch-<runId>/thumbnail.png",
    "public_url": "https://.../thumbnail.png  (also persisted to content_queue.thumbnail_asset_url)",
    "drive_file_id": "1xyz...",
    "drive_path": "Yarono/SMT/content/{content_id}/thumbnail.png"
  },
  "cover_png": {
    "local_path": "/tmp/avatar-stitch-<runId>/cover.png",
    "public_url": "https://.../cover.png  (also persisted to content_queue.cover_asset_url)",
    "source": "gemini | gemini_retry | soul_higgsfield"
  },
  "qa_report": {
    "verdict": "PASS|FAIL|REVIEW",
    "drive_file_id": "1qa...",
    "drive_path": "Yarono/SMT/content/{content_id}/qa-report.md",
    "details": {...}
  },
  "transcript": {
    "drive_file_id": "1tr...",
    "drive_path": "Yarono/SMT/content/{content_id}/transcript.txt"
  },
  "duration_s": 40.41,
  "cost": { "currency": "USD", "amount": 2.07 },
  "scenes": [{ "scene_id": "SCENE_1", "job_id": "...", "duration_s": 9 }]
}
```

## Storage

After local stitch + thumbnail succeed, the skill uploads final assets to Google Drive and writes one metadata row per asset to Supabase `content_assets`. This is the durable boundary — anything downstream (publishing, analytics, audit) reads from `content_assets` + Drive, never from the tmp paths.

### Google Drive
- **Folder:** `Yarono/SMT/content/{content_id}/` (created if missing)
- **Files uploaded:**
  - `final.mp4` — stitched 9:16 video (the deliverable)
  - `thumbnail.png` — hook card matching the video's 2s opening frame
  - `qa-report.md` — full identity-marker QA output (per-clip + cross-clip + verdict)
  - `transcript.txt` — Whisper transcript with word-level timing
  - On `--keep-intermediates` (debugging only): `merged.mp4`, per-scene mp4s, per-scene mp3s

### Supabase `content_assets`
One row per uploaded asset, joined to `content_queue` by `content_id`. Schema (current minimum):

| column | type | notes |
|---|---|---|
| `id` | uuid | primary key |
| `content_id` | uuid | FK to `content_queue.id` |
| `asset_type` | text | `final_mp4` \| `thumbnail_png` \| `qa_report` \| `transcript` |
| `drive_file_id` | text | Google Drive file ID |
| `drive_path` | text | e.g. `Yarono/SMT/content/{content_id}/final.mp4` |
| `mime_type` | text | |
| `size_bytes` | bigint | |
| `duration_s` | numeric | null for non-video |
| `width` | int | null where N/A |
| `height` | int | null where N/A |
| `metadata` | jsonb | render params, QA verdict, scene job IDs, cost breakdown |
| `version` | int | starts at `1`; increments on each re-render |
| `supersedes_id` | uuid | nullable, FK to `content_assets.id` of the row this replaces (`null` for v1) |
| `is_current` | boolean | exactly one `true` per `(content_id, asset_type)` — enforced by partial unique index |
| `created_at` | timestamptz | default `now()` |

### Storage rules
- Drive folder is created lazily — first asset upload triggers folder creation.
- **Re-renders are versioned, never destructive.** For each `(content_id, asset_type)`, when a new render is uploaded:
  1. Find the existing current row by `(content_id, asset_type, is_current = true)`. If one exists:
     a. **Rename** its Drive file by appending `.v{old_version}` to the basename: e.g. `final.mp4` → `final.v1.mp4`, `thumbnail.png` → `thumbnail.v1.png`. Use Drive's `files.update` endpoint to rename in-place — the file ID stays the same.
     b. Update the old row: set `drive_path` to the new (suffixed) path, set `is_current = false`. Do NOT change its `drive_file_id`.
  2. Upload the new render to the unsuffixed Drive path (e.g. `final.mp4`).
  3. Insert a new row: `version = old.version + 1` (or `1` if no prior), `supersedes_id = old.id` (or `null`), `is_current = true`, with the new Drive file ID + path.
- The unsuffixed Drive path always points to the **latest** version. Older versions are suffixed `.v{n}` and stay in Drive forever — full render audit trail, no auto-delete.
- Database invariant: exactly one `is_current = true` row per `(content_id, asset_type)`, enforced by:
  ```sql
  CREATE UNIQUE INDEX content_assets_current_unique
    ON content_assets (content_id, asset_type)
    WHERE is_current = true;
  ```
- A row is only written AFTER its Drive upload (or rename, for the old row) succeeds. Never write a row pointing to a non-existent file.
- If a downstream step (publishing, etc.) needs an asset and no `is_current = true` row exists for that `(content_id, asset_type)`, treat the piece as not-yet-rendered. Do not fall back to tmp paths.

### Querying
```sql
-- Current asset for a piece
SELECT * FROM content_assets
WHERE content_id = $1 AND asset_type = 'final_mp4' AND is_current = true;

-- Full version history (newest first)
SELECT version, drive_path, created_at, metadata
FROM content_assets
WHERE content_id = $1 AND asset_type = 'final_mp4'
ORDER BY version DESC;

-- Walk the supersedes chain from any row back to v1
WITH RECURSIVE chain AS (
  SELECT * FROM content_assets WHERE id = $1
  UNION ALL
  SELECT a.* FROM content_assets a JOIN chain c ON a.id = c.supersedes_id
)
SELECT * FROM chain ORDER BY version;
```

## Failure modes & escalation

| Failure | Action |
|---|---|
| Seedance clip fails to render | Retry once. If second failure, surface to user with job ID |
| QA agent flags hallucination on any clip | Pause, surface report, ask user before regenerating |
| Audio scene exceeds 15s ceiling | Pause, ask user to shorten the script |
| Character not in library | Surface available characters, ask user to pick |
| Higgsfield balance insufficient | Pause, report current balance vs estimated cost |
| Any prompt drift detected (e.g. feature instruction snuck in) | Hard fail, do not generate, surface to user |
| Drive upload fails (network / quota / permission) | Retry once with backoff. On second failure, surface local paths + error and keep tmp intact so the run is recoverable |
| `content_assets` write fails | Same — surface, keep tmp + completed Drive uploads intact. Never delete a Drive file because the DB write failed |
| Drive rename of old version fails (during a versioned re-render) | Hard fail before uploading the new render. The old `is_current` row + file stay intact and unchanged. Surface + keep tmp |
| Two re-renders for the same `(content_id, asset_type)` race | Second insert fails on `content_assets_current_unique`. Surface error; first run completes normally. Manual intervention needed only if the second run already uploaded its Drive file (orphaned blob — leave it, it'll be picked up on next render) |

## Files this skill calls

- `video/scripts/elevenlabs-tts.ts` — audio generation
- `video/scripts/generate-hook-card.ts` — thumbnail PNG
- `video/scripts/stitch-avatar.ts` — clip stitching
- `video/scripts/qa-agent-avatar.ts` — QA pass
- `video/scripts/render-avatar-full-v5.ts --phase=cover` / `--phase=cover-record` — cover stage
- `video/lib/cover/` — Gemini client, directive + variance, banner, cover QA, fallback chain
- Higgsfield MCP — Seedance generation, media upload, Soul 2.0 cover fallback (tier 3)

## Character library (current)

| character_id | name | soul_id | notes |
|---|---|---|---|
| rachel | Rachel | 34a349a6-d6d9-423f-8c80-e4b4c8d6e770 | Mid-late 30s, three kids 5/11/15. Locked still: f757b09c-d94d-4ade-a076-4a1a496c641e |

To add a character: train Soul, generate locked still, store record in character library, run a calibration piece end-to-end before approving for production.

## Version

v1.2 — Jun 11, 2026. Added the cover stage (phaseCover): three-asset contract
(video + thumbnail + cover), external-model cover generation (Gemini Nano
Banana, reference-based — NOT Higgsfield), the
gemini_nano_banana → retry → higgsfield_soul fallback chain (services table),
variance rules (last-5 exclusion, framing rotation), the mandatory
matches-reference cover QA gate, and the IG-cover / TikTok-frame publishing
split. Requires GEMINI_API_KEY in .env.

v1.1 — Jun 10, 2026. Added the mandatory deterministic QA gates (audio-boundary, tail-trim, background-scale, hook-fit) and the A/V debugging-discipline section, from the first live create-from-url avatar render (YAR-153/155/156). The canonical pipeline is Avatar Full v5 (`docs/specs/AVATAR_FULL_V5.md`); this skill's v1.0 single-still / stitch description is conceptual — defer to the v5 spec on conflict.

v1.0 — May 9, 2026. Built from Test 5 v2 pipeline.
