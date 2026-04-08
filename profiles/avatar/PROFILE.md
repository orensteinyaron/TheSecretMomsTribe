# Avatar Video — Render Profile v1

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

## Env Vars Required
- `ELEVENLABS_API_KEY`
- `HEYGEN_API_KEY`
- `OPENAI_API_KEY` (existing)
- `PEXELS_API_KEY` (existing)
