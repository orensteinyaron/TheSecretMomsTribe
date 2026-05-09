---
name: full-avatar-profile
description: Production pipeline for SMT's "Full Avatar" video format. Takes an approved script and a chosen character from the avatar library, produces a final 9:16 mp4 (with hook card opening, captions, watermark, smooth transitions) and a thumbnail PNG. Use this skill when the user asks for a Full Avatar video, an "Avatar Full" piece, or generation of a talking-head Rachel-style clip from an approved script. Does not handle research, ideation, script generation, or publishing — those are upstream/downstream phases.
---

# Full Avatar Profile — Production Skill

## What this skill does

Takes two inputs:
1. **Approved script** — JSON with scenes, dialogue, emotion tags, durations, and a `hook_overlay` field
2. **Character selection** — character ID from the avatar library (e.g. Rachel)

Produces two outputs:
1. **Final mp4** — 9:16, 1080×1920, with: 2s hook card opening → 6 avatar clips with smooth crossfades → phrase captions → watermark
2. **Thumbnail PNG** — 1080×1920 hook card (matches the video's opening frame)

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
6. **Generate hook card PNG** — call `generate-hook-card.ts` with character's soul_still_media_id as background and `script.hook_overlay` as text. Output: 1080×1920 PNG
7. **Stitch clips** — call `stitch-avatar.ts` with:
   - Ordered scene list
   - 200ms xfade + acrossfade between clips
   - Hook card PNG as 2s held opening
   - PhraseCaptions style (no background band, white text + shadow)
   - BrandWatermark
8. **Upload to Drive** — push final assets to `Yarono/SMT/content/{content_id}/` (folder created if missing). See [Storage](#storage).
9. **Write `content_assets` rows** — one Supabase row per uploaded asset, joined to `content_queue` by `content_id`. See [Storage](#storage).
10. **Output** — return local paths + Drive IDs + QA verdict + cost. See [Outputs](#outputs).

## Hard rules (do not violate)

- **Never inject feature descriptions into the Seedance prompt** when using a Soul 2.0 character. Soul carries identity. Adding "scar preserved" or "smooth forehead" or any feature directive causes hallucination.
- **QA scoring is "matches reference," not "feature present yes/no"** — use the patched identity-markers prompt that compares enumerated markers between reference still and generated frame.
- **Calibrate before trusting** — if the QA agent has been modified since the last calibration, manually score 2 clips first. Do not auto-pass new agent versions.
- **Hook overlay is mandatory** — every Full Avatar script must include `hook_overlay` (3-6 words, on-screen text version of the spoken opener). If missing, escalate to user. Do not generate one automatically.
- **Token economy** — use Haiku for QA framing, Sonnet only for the per-frame identity-markers vision call. Never call an LLM where deterministic code (ffmpeg, sharp, regex) suffices.
- **Single render file for cross-posting** — the same final mp4 ships to both Instagram and TikTok. Do not re-export per platform.

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
    "local_path": "/tmp/hook-card-<runId>/option-a-bold-block.png",
    "drive_file_id": "1xyz...",
    "drive_path": "Yarono/SMT/content/{content_id}/thumbnail.png"
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
| `created_at` | timestamptz | default `now()` |

### Storage rules
- Drive folder is created lazily — first asset upload triggers folder creation.
- Re-runs for the same `content_id` overwrite Drive files in-place (same name) and update existing `content_assets` rows by `(content_id, asset_type)`. They do NOT create duplicate rows.
- A `content_assets` row is only written AFTER its corresponding Drive upload succeeds — never write a row pointing to a non-existent file.
- If a downstream step (publishing, etc.) needs an asset and the row is missing, treat the piece as not-yet-rendered. Do not fall back to tmp paths.

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

## Files this skill calls

- `video/scripts/elevenlabs-tts.ts` — audio generation
- `video/scripts/generate-hook-card.ts` — thumbnail PNG
- `video/scripts/stitch-avatar.ts` — clip stitching
- `video/scripts/qa-agent-avatar.ts` — QA pass
- Higgsfield MCP — Seedance generation, media upload

## Character library (current)

| character_id | name | soul_id | notes |
|---|---|---|---|
| rachel | Rachel | 34a349a6-d6d9-423f-8c80-e4b4c8d6e770 | Mid-late 30s, three kids 5/11/15. Locked still: f757b09c-d94d-4ade-a076-4a1a496c641e |

To add a character: train Soul, generate locked still, store record in character library, run a calibration piece end-to-end before approving for production.

## Version

v1.0 — May 9, 2026. Built from Test 5 v2 pipeline.
