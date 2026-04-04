# SMT Video Pipeline

Programmatic video generation for The Secret Moms Tribe using [Remotion](https://remotion.dev) (React → MP4).

## Quick Start

```bash
cd video/
npm install

# Preview in Remotion Studio (browser)
npm run studio

# Generate a single video from approved content
SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... npx tsx scripts/generate-video.ts <content-id>

# Batch generate (all approved posts without video)
SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... npx tsx scripts/batch-generate.ts --limit 5

# Skip TTS or images for faster iteration
npx tsx scripts/generate-video.ts <id> --no-tts --no-images
```

## Architecture

```
content_queue (Supabase)
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│ Slide Parser │───▶│ OpenAI TTS   │───▶│ Remotion     │──▶ MP4
│ (Haiku/det.) │    │ (voiceover)  │    │ (render)     │
└─────────────┘    └──────────────┘    └──────────────┘
                    ┌──────────────┐         │
                    │ DALL-E 3     │─────────┘
                    │ (bg images)  │
                    └──────────────┘
```

## Templates

### TextSlideshow
Primary format. Hook → 3-5 content slides → CTA. Each slide has:
- Main text (sans-serif, light weight)
- Emphasis text (serif, italic, brand pink)
- Subtext (sans-serif, medium)
- SVG illustration (heart/child/brain/words/grow)
- Optional DALL-E background image (blurred, 30% opacity)

**Timing**: hook 7s → slides 9s each → CTA 6s  
**Dimensions**: 1080×1920 (9:16 portrait)  
**FPS**: 30

## Cost Per Video

| Component | Cost |
|-----------|------|
| Slide parsing (Haiku) | ~$0.001 |
| Voiceover (OpenAI TTS) | ~$0.008 |
| Background images (DALL-E × 4) | ~$0.32 |
| **Total with images** | **~$0.33** |
| **Total without images** | **~$0.01** |

## File Structure

```
video/
├── src/
│   ├── index.ts              # Remotion entry point
│   ├── Root.tsx               # Composition registry
│   └── templates/
│       └── TextSlideshow.tsx  # Main video template
├── scripts/
│   ├── generate-video.ts      # Single video pipeline
│   ├── batch-generate.ts      # Batch processor
│   └── parse-slides-ai.ts     # AI slide parser (Haiku)
├── out/                        # Rendered videos
├── package.json
└── tsconfig.json
```

## Environment Variables

```
SUPABASE_URL=https://fvxaykkmzsbrggjgdfjj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...   # Optional, for AI slide parser
```

## Adding New Templates

1. Create `src/templates/YourTemplate.tsx`
2. Register in `src/Root.tsx` as a new `<Composition>`
3. Add matching props interface
4. Update generate script to select template based on `post_format`
