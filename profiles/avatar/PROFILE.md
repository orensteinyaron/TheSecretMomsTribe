# Avatar Full — Render Profile v1

**Slug:** `avatar-v1` | **Type:** video | **Status:** active

## Required Services
- `heygen` (avatar-studio) — Creator plan, $24-29/mo
- `elevenlabs` (voice-tts-elevenlabs) — Starter plan, $5/mo
- `pexels` — B-roll (existing)
- `whisper` — Timestamps (existing)

## Pipeline
1. ElevenLabs TTS → full audio
2. Whisper → word timestamps
3. Audio segmenter → per-clip MP3s
4. HeyGen Studio → avatar video clips
5. Pexels → B-roll visuals (Format 2 only)
6. Remotion → final composite with captions, transitions, overlays
7. QA check

## Cost
Variable cost: ~$2.10/piece
- Seedance × 6 clips ~$1.50
- ElevenLabs (6 scenes ~40s) ~$0.05
- Whisper (full audio) ~$0.01
- Sonnet QA (per-frame identity-markers vision call) ~$0.55
- Hook card render $0
- Stitch + watermark $0

Subscriptions (orthogonal to per-piece cost): HeyGen Creator $24–29/mo,
ElevenLabs Starter $5/mo. The HeyGen subscription is for the legacy HeyGen
pipeline path; the current Soul 2.0 pipeline (per
`skills/full-avatar-profile/SKILL.md`) uses ElevenLabs for TTS and Higgsfield
Seedance for avatar generation. The `cost_estimate_usd` column in
`render_profiles` is variable cost only — subscription cost belongs in a
separate fixed-cost ledger if/when one exists.

## Thumbnails
Hook card produced by `video/scripts/generate-hook-card.ts`, persisted as
`content_assets.asset_type='thumbnail'`. The same hook card is used as the
2-second held opening frame of the final mp4. One thumbnail per render.

## Output Spec
- Resolution: 1080x1920 (9:16 portrait)
- FPS: 30
- Format: MP4 (H.264)
- Duration: 15–60s (sweet spot 20–35s; per
  `skills/full-avatar-profile/SKILL.md` §A1)
- Audio: ElevenLabs `eleven_v3`, character's locked `voice_id`
- Composition: 2s hook card opening → 6 avatar clips with 200ms (12-frame) crossfade → phrase captions (white text + shadow, no background band) → brand watermark

## Env Vars Required
- `ELEVENLABS_API_KEY`
- `HEYGEN_API_KEY`
- `OPENAI_API_KEY` (existing)
- `PEXELS_API_KEY` (existing)
