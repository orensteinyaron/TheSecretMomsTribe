# Moving Images — Render Profile v2

**Slug:** `moving-images` | **Type:** video | **Status:** active

## Pipeline

| Step | Type | Service | Script |
|------|------|---------|--------|
| 1. Parse slides | deterministic | — | `video/scripts/parse-slides-v2.ts` |
| 2. Media sourcing | API | pexels | `video/scripts/media-sourcing.ts` |
| 3. Brand filter | deterministic | — | `video/scripts/brand-filter.ts` |
| 4. TTS generation | API | openai_tts | `video/scripts/audio-pipeline.ts` |
| 5. Timestamp extraction | API | whisper | `video/scripts/audio-pipeline.ts` |
| 6. Video render | deterministic | — | Remotion `KaraokeSlideshow` |
| 7. QA check | LLM | anthropic_haiku | `video/scripts/qa-agent.ts` |

## Required Services
`pexels`, `openai_tts`, `whisper`

## Output Spec
- Resolution: 1080x1920 (9:16 portrait)
- FPS: 30
- Format: MP4 (H.264)
- Duration: 30-65 seconds
- Audio: OpenAI TTS "nova" voice

## Cost
~$0.023/video (TTS + Whisper + Pexels free)

## Template
`video/src/templates/v2/KaraokeSlideshow.tsx`

3-layer composition:
1. **Background:** Pexels photos with Ken Burns motion (6 types) + crossfade transitions
2. **Captions:** Word-by-word karaoke synced via Whisper timestamps, pink highlight on active word
3. **Icons:** Animated SVG icons (pop, float, pulse, bounce) — max 2 on screen

## Timing
- Hook: 4 seconds (120 frames)
- Content: voiceover-driven (phrase groups from Whisper)
- CTA: 5 seconds (150 frames)
- Background crossfade: 0.2s (6 frames)
