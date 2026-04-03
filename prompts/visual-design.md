# SMT Visual Design Guide
## The Look of The Secret Moms Tribe

---

## Design Philosophy

**Editorial warmth meets modern clarity.**

SMT visuals feel like a premium parenting magazine that lives on your phone. Not clinical. Not cutesy. Not AI-generated looking. Every frame should feel intentional, warm, and immediately recognizable as "ours."

The design should make moms think: "This account looks different from everything else in my feed."

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
- Headlines/hooks are ALWAYS serif (Georgia). This is the brand signature.
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
Background: DALL-E photo (warm, no text, no faces)
Gradient: black 45% top, 55% bottom (text readability)
Hook text: #fcfcfa, Georgia serif, bold, subtle text shadow
Pillar chip: #63246a at 90% opacity
Handle: rgba(252,252,250,0.3)
Logo: bottom-right, 60px, 80% opacity
```

---

## Image Rules (for DALL-E generation)

### What we generate:
- Warm, lifestyle-adjacent scenes with NO FACES visible
- Close-ups: hands, backs of heads, feet, over-shoulder angles
- Soft, golden-hour lighting always
- Muted, warm color palette — never oversaturated
- Real environments: kitchens, living rooms, cars, parks, bedrooms

### What we NEVER generate:
- Faces (never)
- Overly posed or stock-photo-feeling scenes
- AI-looking artifacts (weird hands, uncanny textures)
- Sterile/clinical environments
- Bright, oversaturated colors
- Multiple children in frame (keep focus tight)

### Image prompt structure:
```
[Camera angle], [subject without face], [action/gesture],
[environment], [lighting: warm/golden hour],
[color palette: warm amber, soft cream, dusty blush, muted sage],
[mood: tender/real/quiet/editorial-warm],
[style: editorial photography, not stock]
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
- Photos with golden light and no faces
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

## File Specs

| Format | Dimensions | Ratio |
|--------|-----------|-------|
| TikTok slideshow | 1080 x 1920 | 9:16 |
| TikTok text | 1080 x 1920 | 9:16 |
| IG carousel | 1080 x 1350 | 4:5 |
| IG static | 1080 x 1350 | 4:5 |
| IG story | 1080 x 1920 | 9:16 |

Export: PNG for all composed content. Max quality. Compression kills readability on mobile.
