# Static Image — Render Profile v1

**Slug:** `static-image` | **Type:** static | **Status:** draft

## Pipeline

| Step | Type | Service | Script |
|------|------|---------|--------|
| 1. Generate background | API | dall_e | `scripts/image-gen.js` |
| 2. Compose text overlay | deterministic | — | `scripts/compose.js` |
| 3. QA check | deterministic | — | inline (resolution + brightness) |

## Required Services
`dall_e` (fallback: `pexels`)

## Output Spec
- TikTok: 1080x1920 (9:16)
- Instagram: 1080x1350 (4:5) or 1080x1080 (1:1)
- Format: PNG
- Single image per post

## Cost
~$0.04-0.08/image (DALL-E 3 HD)

## Image Prompt Enhancement
- NO faces rule enforced
- Golden-hour lighting
- Color palette: warm amber, soft cream, dusty blush, muted sage
- Editorial photography style
- Text stripped from prompt (composited separately)
