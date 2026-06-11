# SMT Visual Design Guide
## The Look of The Secret Moms Tribe

---

## Design Philosophy

**Editorial warmth meets modern clarity.**

SMT visuals feel like a premium parenting magazine that lives on your phone. Not clinical. Not cutesy. Not AI-generated looking. Every frame should feel intentional, warm, and immediately recognizable as "ours."

The design should make moms think: "This account looks different from everything else in my feed."

---

## Surfaces: two visual languages

SMT runs **two distinct visual systems.** This guide documents the **video /
composed-image** surface. Carousels use a separate system. See "Carousel Visual
System" near the end, and `skills/carousel-builder/SKILL.md`, which is the source
of truth for carousels.

| Surface | Typography | Core palette |
|---|---|---|
| **Video + composed images** (Remotion templates, DALL-E stills, hook/caption overlays) | Georgia serif headlines, sans body | deep purple `#63246a`, mauve `#b74780` |
| **Carousels** (IG 1080×1350 / TikTok 1080×1920) | Poppins, one heavy geometric sans | indigo `#220758`, violet `#7941EA`, gradient to magenta/coral |

Everything below describes the **video / composed-image** surface unless a
section says otherwise.

---

## Brand Assets

| Asset | Location | Use |
|-------|----------|-----|
| Logo (circle, transparent) | `/assets/brand/SMT_LOGO_small.png` | Watermark on all composed images |
| Logo (full lockup) | `/assets/brand/BRANDING_KIT_profile_image_4.jpg` | Profile images |
| Brand font (Blankspot) | `/assets/brand/Blankspot-owlw4.ttf` | "smt" script branding element only |
| Color palette reference | `/assets/brand/BRANDING_KIT3-26.jpg` | Official palette source |

---

## Official Color Palette

### Primary
| Color | Hex | Use |
|-------|-----|-----|
| Deep Purple | #63246a | Primary brand color. Headers, accents, pillar chips. |
| Mauve Pink | #b74780 | Secondary. Highlights, CTA elements, warm accents. |
| Black | #000000 | Dark backgrounds, primary text on light backgrounds. |
| Light Gray | #efedea | Light background option. Cards, slide backgrounds. |
| Off-White | #fcfcfa | Lightest background. Clean, airy slides. |

### Derived
| Color | Hex | Use |
|-------|-----|-----|
| Purple Light | #7d3585 | Lighter purple for gradients, hover states |
| Pink Light | #d4699e | Lighter pink for subtle accents |
| Text on dark | #fcfcfa | Off-white text on dark/purple backgrounds |
| Text on light | #000000 | Black text on light/gray backgrounds |
| Muted on dark | rgba(252,252,250,0.3) | Handles, secondary text on dark |
| Muted on light | rgba(99,36,106,0.3) | Handles, secondary text on light |

### Rules:
- The brand lives in the purple/pink family. Every accent derives from #63246a or #b74780.
- Light backgrounds (#fcfcfa, #efedea) for daytime/practical content.
- Dark backgrounds (#63246a→#000 gradient) for emotional/nighttime content.
- Each content pillar uses a pillar color from the brand family (see below).

---

## Typography

### Brand Script: Blankspot
**Use:** ONLY for the "smt" branding element. Never for body text or hooks.
File: `/assets/brand/Blankspot-owlw4.ttf`

### Hook Headlines: Georgia (serif)
**Use:** Main hook text on all composed images. Large, bold.
Fallback: 'Times New Roman', serif

### Body / UI Text: Helvetica Neue (sans-serif)
**Use:** Captions, labels, pillar chips, handle, slide body text.
Fallback: Helvetica, Arial, sans-serif

### Rules:
- Headlines/hooks are ALWAYS serif (Georgia) **on video and composed images**. This is the brand signature for those surfaces. Carousels are the exception: they use Poppins (see "Carousel Visual System").
- Body text is ALWAYS sans-serif.
- Never use more than 2 fonts in one piece of content.
- Never use all-caps for more than 3 words in a row.
- Text always has breathing room — generous line spacing (1.4-1.6x).

---

## Pillar Visual Signatures

All pillars use the purple/pink brand family for cohesion:

| Pillar | Color | Hex | Background | Visual Cue |
|--------|-------|-----|------------|------------|
| AI Magic | Deep Purple | #63246a | Dark (purple→black) | ✦ sparkle divider |
| Parenting Insights | Mauve Pink | #b74780 | Light (#fcfcfa) | Minimal, text-forward |
| Tech for Moms | Deep Purple | #63246a | Light (#fcfcfa) | Smart, modern |
| Mom Health | Purple Light | #7d3585 | Dark (purple→black) | Soft, calming |
| Trending | Mauve Pink | #b74780 | Dark (purple→black) | "NEW" / "JUST IN" tag |

---

## Layout Templates

### TikTok Slideshow / Text (1080x1920)

```
┌─────────────────────┐
│                      │
│     [pillar tag]     │  ← Small centered chip, pillar color
│                      │
│                      │
│   HOOK TEXT HERE     │  ← Georgia serif, white/black, ~50px
│   IN 2-3 LINES      │
│                      │
│                      │
│     ─── ✦ ───       │  ← Subtle divider
│                      │
│  @thesecretmomstribe │  ← Handle, small, muted
│                      │  ← Logo (bottom-right, 60px, 80% opacity)
└─────────────────────┘
```

### Instagram Carousel (1080x1350)

> Note: this serif layout is the video-era reference. Live carousels now follow the **Carousel Visual System** (below) and the `carousel-builder` skill (Poppins, indigo/violet, no logo). Do not use this serif template for carousels.

```
┌─────────────────────┐
│  ┌─────────────┐    │
│  │ pillar tag  │    │  ← Colored chip
│  └─────────────┘    │
│                      │
│   HOOK TEXT THAT     │  ← Georgia serif, ~44px
│   STOPS THE SCROLL   │
│                      │
│                      │
│   ─── ✦ ───         │
│                      │
│  @thesecretmomstribe │
│                      │  ← Logo (bottom-right)
└─────────────────────┘
```

**Interior slides (2-6):**
- Background: alternating #fcfcfa and #efedea
- Text: #000000, Helvetica Neue, 28-32px
- Accent: #63246a or #b74780 for highlights
- Logo: only on slide 1 and last slide

### Instagram Static (1080x1350)

```
┌─────────────────────┐
│                      │
│                      │
│                      │
│   "ONE POWERFUL      │  ← Georgia serif, centered, ~48px
│    STATEMENT THAT    │
│    HITS HARD."       │
│                      │
│                      │
│  @thesecretmomstribe │
│                      │  ← Logo (bottom-right)
└─────────────────────┘
```

Minimal. One statement. Warm background. This is the post moms screenshot.

---

## Composition Templates

### Template: Dark (purple→black gradient)
For: AI Magic, Mom Health, Trending
```
Background: linear gradient #63246a → #000000
Glow: subtle radial #7d3585 at 15% opacity
Hook text: #fcfcfa, Georgia serif, bold
Pillar chip: pillar color, white text
Handle: rgba(252,252,250,0.3)
Logo: bottom-right, 60px, 80% opacity
```

### Template: Light (off-white)
For: Parenting Insights, Tech for Moms
```
Background: #fcfcfa with subtle #efedea radial center
Hook text: #000000, Georgia serif, bold
Pillar chip: pillar color, white text
Handle: rgba(99,36,106,0.3)
Logo: bottom-right, 60px, 60% opacity
```

### Template: Photo (DALL-E background)
For: Scene-based posts (hands, kitchens, bedtime)
```
Background: generated photo (warm, no text; faces welcome when emotional)
Gradient: black 45% top, 55% bottom (text readability)
Hook text: #fcfcfa, Georgia serif, bold, subtle text shadow
Pillar chip: #63246a at 90% opacity
Handle: rgba(252,252,250,0.3)
Logo: bottom-right, 60px, 80% opacity
```

---

## Image Rules (for generated scene imagery)

> **Faces policy (updated 2026-06-11 — supersedes the old "no faces ever" rule).**
> Faces are **allowed and encouraged** when the emotion is the point of the image
> (a child mid-tantrum, a tired parent, a tender exchange). The previous strict
> faceless aesthetic ("Model B") is **retired** for scene/cover imagery — it made
> our covers abstract and hard to resonate with. The single most important driver
> of a save/click is a parent recognizing the moment, and that usually means a
> readable, expressive face. Rachel's avatar-identity rules are separate and
> unaffected (see `FACE_OF_SMT_V1.md`).

### What we generate:
- Warm, real, emotionally resonant moments. **Show faces and expressions** when
  they carry the feeling (crying, overwhelmed, relieved, delighted).
- Real, lived-in environments: kitchens, living rooms, cars, parks, bedrooms.
- Soft, golden-hour lighting always.
- Muted, warm color palette — never oversaturated.
- Tight focus, usually one subject (one child), so the emotion reads instantly.

### What we NEVER generate:
- AI-looking artifacts (malformed hands, extra fingers, uncanny/melted faces,
  garbled textures). If a face is in frame it must read as a **real photograph**.
- Overly posed or stock-photo-feeling scenes.
- Sterile/clinical environments.
- Bright, oversaturated colors.
- Cluttered frames with competing subjects.

### Image prompt structure:
```
[Camera angle / shot type], [subject + expression if emotional],
[action/gesture], [environment], [lighting: warm/golden hour],
[color palette: warm amber, soft cream, dusty blush, muted sage],
[mood: tender/real/quiet/editorial-warm],
[composition note: where the subject sits in frame, where text space goes],
[style: editorial photography, real, not stock, not AI-looking]
```

---

## Grid Aesthetic (Instagram)

```
Row pattern (every 3 posts):
[Dark bg] [Light bg] [Dark bg]
[Light bg] [Dark bg] [Light bg]
```

- Alternate dark/light backgrounds for visual rhythm
- Every 9th post can be a "statement" post for grid variety
- Color consistency: the grid should feel warm purple when zoomed out

---

## What SMT Looks Like vs. What It Doesn't

### SMT aesthetic ✅
- Clean text on warm, breathing backgrounds
- Serif headlines that feel magazine-editorial
- Purple/pink brand family with warm neutrals
- Photos with golden light; real, expressive faces welcome when they carry the emotion
- Generous white space
- Logo watermark on every composed image

### Not SMT ❌
- Neon colors or bold primary colors
- Busy Canva templates with 15 elements per slide
- Stock photos of smiling families
- Random accent colors not from the brand palette
- Cluttered layouts with borders, stamps, stickers
- AI-generated images that look obviously AI

---

## Carousel Visual System

Carousels do **not** use the Georgia-serif / `#63246a` video look. They run their
own locked system, sampled from the live SMT carousels. **Source of truth:
`skills/carousel-builder/SKILL.md` (Sections 2, 3, 7).** Summary, kept in sync
with the skill:

- **Typography:** Poppins, one heavy geometric sans for everything (no serif, no
  pairing). Headlines + numerals 800, body 600, eyebrow 700 uppercase.
- **Palette:** INK `#220758` (all text), violet `#7941EA` (wordmark + accent),
  signature gradient `#7941EA → #B443AD → #E94B6C` (swipe arrow + divider line),
  light bg `#FBFBFB` with dot-grid, dark bg `#160734`, coral `#E94B6C` (eyebrow
  kickers).
- **Chrome (v1.1):** counter pill top-right, coral eyebrow kicker top-left, big
  item numeral, footer wordmark lockup flush at the left margin (logo removed in
  v1.1), swipe arrow bottom-right vertically centered on the footer.
- **Cover hero image (v1.2):** slide 1 carries a full-bleed, brand-compliant
  narrative photo (warm, golden-hour, emotionally resonant per the "Image Rules"
  above — faces welcome) under a bottom scrim, with the cover flipping to
  dark-slide chrome. The subject sits high in frame so the bottom scrim + headline
  never cover the face. Interior slides keep the dot-grid. Source of truth:
  carousel skill Section 4.1.
- **Dimensions:** IG 1080×1350, TikTok 1080×1920 (the 4:5 slide centered on a
  brand-banded 9:16 canvas).

Do not edit these values here. Change them in the carousel skill, then mirror the
summary above.

---

## File Specs

| Format | Dimensions | Ratio |
|--------|-----------|-------|
| TikTok slideshow | 1080 x 1920 | 9:16 |
| TikTok text | 1080 x 1920 | 9:16 |
| IG carousel | 1080 x 1350 | 4:5 |
| IG static | 1080 x 1350 | 4:5 |
| IG story | 1080 x 1920 | 9:16 |

Export: PNG for all composed content. Max quality. Compression kills readability on mobile.
