---
name: carousel-builder
description: >
  Builds The Secret Moms Tribe Instagram + TikTok carousels. Implements the
  `carousel` render profile (SMT_PIPELINE_CONTRACT Stage 4). Turns an approved
  content_queue row (render_profile_slug='carousel') into a swipeable image set,
  exported as Instagram 1080x1350 and TikTok 1080x1920 PNGs. Triggers on:
  "make a carousel", "build a carousel for <signal/row>", "carousel about X",
  "swipe post", "IG carousel", "TikTok photo post". Brand details are loaded
  from SMT canon, never asked. Conforms to the pipeline contract — the contract
  wins on any conflict, and this skill re-validates the pillar gate before
  rendering. Does NOT write any DB render field until Yaron approves.
version: 1.2.0
last_updated: 2026-06-11
owner: Yaron Orenstein
---
# SMT Carousel Builder v1.2.0

## Changelog
- **v1.2.0 (2026-06-11):** Cover hero image. Slide 1 now carries a full-bleed,
  brand-compliant narrative background image (a warm, golden-hour scene that
  represents the carousel's story — an expressive face that makes a parent
  recognize the moment is encouraged, not avoided), with the cover flipping to
  dark-slide chrome over a brand-tinted **bottom** scrim. The subject sits **high
  in frame** so the scrim + headline never cover the face. Interior slides are
  unchanged (dot-grid system). See Section 4.1. No change to pillar logic, copy
  rules, or the approval/DB gates. (Faces policy: the old "no faces" rule is
  retired for scene/cover imagery — see `prompts/visual-design.md` Image Rules.)
- **v1.1.0 (2026-06-09):** Design-system update. Footer globe logo removed; the
  wordmark lockup now sits flush at the left content margin (80px). Swipe arrow
  re-anchored to be vertically centered on the footer lockup (was floating high).
  See Section 7. No change to copy, pillar logic, or the approval/DB gates.
- **v1.0.0 (2026-06-08):** Initial carousel renderer. Locked palette + typography
  (sampled from live SMT carousels), pillar-driven slide arc, dual IG/TikTok
  export, DB-flip-on-approval.

This skill is the renderer for the `carousel` render profile. In
`SMT_PIPELINE_CONTRACT.md` v2.1.0 that profile is listed as **"TBD — not yet
implemented."** This skill is that implementation. When it ships, bump the
contract (v2.2.0 changelog: carousel pipeline locked, entry point = this skill).
It is a Claude Code session skill (peer to `full-avatar-profile`,
`content-lifecycle`). It is invoked conversationally, produces a reviewable
preview, and only exports + hands off after Yaron approves.
---
## 0. Contract conformance — read this first
`SMT_PIPELINE_CONTRACT.md` is authoritative. If anything here disagrees with the
contract, **the contract wins** and you flag the disagreement in your output.
Hard rules inherited from the contract:
- **One pillar per piece.** The pillar is already set on the `content_queue`
  row. It drives the slide sequence. Do not re-route or multi-tag.
- **Defensive gate re-validation.** Research/Strategist/ContentGen already
  passed the row through its pillar gate. This skill re-checks the gate before
  rendering:
  - `ai_magic` → the row MUST carry verbatim `original_prompt` (≥10 chars),
    verbatim `original_output` (≥30 chars), `ai_tool_name`, and a public
    `source_url`. The carousel renders these **byte-for-byte**. You may add
    framing copy around them; you may **not** edit, paraphrase, or invent them.
    If any are missing → abort this row with a `rejected[]` entry. Never
    fabricate a prompt or output to fill a slide.
  - `financial` → first-person framing only, no products/stocks/crypto/tax/legal,
    and a **mandatory disclaimer slide** + caption disclaimer.
  - `trending` → check `expires_at`; if past the 72h window, flag and ask before
    rendering.
- **No fabrication, ever.** If a slide needs a real artifact (a quote, a result,
  a screenshot) and it isn't on the row, you stop — you do not invent it.
- **DB-flip-on-approval.** This skill writes image assets to disk/storage and
  shows a preview. It does **NOT** write `render_status`, `final_asset_url`,
  `metadata.video_url`, or `render_profile_id` confirmation until Yaron
  approves. This mirrors the Avatar Full v5 invariant. Approval is a human gate.
- **Errors are first-class.** Anything you drop goes into `rejected[]` with a
  reason and the failing field.
Input to this skill: a `content_queue` row id (or signal id) where
`render_profile_slug='carousel'`. If Yaron just says "make a carousel about X"
without a row, treat X as the brief, build it, but flag that it isn't yet a
queued piece so it gets backfilled into `content_queue` on approval.
---
## 1. Brand is loaded from canon — do NOT ask for it
This is the biggest difference from a generic carousel tool. **Never** ask for
brand name, handle, colors, fonts, logo, or language. Load them from SMT canon:
- **Brand:** The Secret Moms Tribe (SMT)
- **Handles:** IG `@thesecretmomstribe` · TikTok `@secret.moms.tribe`
- **Language:** English (US). Override only if the piece is explicitly localized.
- **Voice:** Brand Voice Bible — warm, real, mom-to-mom, zero corporate sheen.
  No "unlock," no "game-changer," no exclamation spam. She talks like a friend
  who's three kids deep and tells the truth.
- **Punctuation:** NEVER render em dashes (—) or double hyphens (--) in slide copy
  or captions. Rewrite with periods, commas, parentheses, or colons. Brand canon hard rule.
- **Palette + typography:** locked in Sections 2–3 below, sampled from the live
  SMT brand reference. Treat the Visual Design Guide as the authority if it ever
  supersedes these; otherwise these are canon.
The **only** things you ask Yaron for:
1. Which `content_queue` row / signal to build (if not already given).
2. Any image assets the piece needs (screenshots, reference photos) — most
   pillars are type-driven and may need none.
If a canon value can't be resolved, say so explicitly and stop — do not
substitute a guessed color or font.
---
## 2. Color system — locked from the SMT brand reference
These hex values are sampled from the live SMT carousels (the "Mothers Are
Sharing Lies About Motherhood" series). They are the brand palette. Confirm
against the Visual Design Guide if it ever updates, but do not invent or drift.
```
INK            = #220758   // deep indigo-purple — ALL primary text, headlines, big numerals, quotes
BRAND_PRIMARY  = #7941EA   // brand violet — wordmark, section accents, the "primary" purple
BRAND_LIGHT    = #9B6BF0   // violet lightened ~20% — pills/tags on dark, hover states
BRAND_DARK     = #160734   // near-black with purple tint — DARK_BG base, gradient anchor
LIGHT_BG       = #FBFBFB   // warm near-white with a faint dot-grid texture (never pure #fff)
LIGHT_BORDER   = #ECEAF2   // ~1 shade darker than LIGHT_BG — dividers on light slides
DARK_BG        = #160734   // dark-slide background (purple-tinted near-black)
CORAL          = #E94B6C   // coral/rose accent — eyebrow kickers, end of the signature gradient
MAGENTA        = #B443AD   // magenta — middle of the signature gradient, logo plum range
```
**The signature gradient** is the single most recognizable brand mark — it's the
swipe arrow and the divider line under the wordmark. Always left→right:
```
SMT_GRADIENT = linear-gradient(90deg, #7941EA 0%, #B443AD 50%, #E94B6C 100%)
               // violet → magenta → coral
```
Dark-slide brand gradient (for full-bleed gradient slides): same stops at 135°.
⚠️ Always interpolate the **actual hex** into the HTML. Never leave a token name
as a literal string in the output — it renders as invalid.
---
## 3. Typography — one heavy geometric sans, used everywhere
The brand runs a **single heavy geometric sans-serif** for everything —
headlines, body, big numerals, eyebrow kickers. No serif, no pairing. The
reference uses what looks like a paid geometric face (Mont / Gilroy family);
the closest free Google Font that matches the rounded-geometric, very-heavy feel
is **Poppins**. Default to Poppins until the exact licensed font is confirmed in
the Visual Design Guide.
```
HEADING / NUMERALS : Poppins 800 (ExtraBold)
BODY / QUOTES      : Poppins 600 (SemiBold)   // the brand sets body BOLD, not regular
EYEBROW / LABELS   : Poppins 700, UPPERCASE, letter-spacing ~2px
HANDLE / FOOTER    : Poppins 500–600
```
Size scale (at the 1080×1350 master; preview is the 0.4 scale of these):
- Cover headline: 64–84px, weight 800, line-height ~1.02, letter-spacing -1px, INK
- Body / quote: 30–40px, weight 600, line-height ~1.25, INK
- Big item numeral ("01", "02"): 90–120px, weight 800, INK
- Eyebrow kicker: 18–22px, weight 700, uppercase, +2px tracking, CORAL
- Wordmark: 30px, weight 700, BRAND_PRIMARY
- Handle: 18px, weight 500, INK at ~70% opacity
- Counter pill: 20px, weight 700
Everything is **left-aligned** with generous left margin. Text is INK on light
slides, LIGHT_BG (#FBFBFB) on dark slides.
---
## 4. Slide 1 — the hook (stop the scroll in <1s)
Slide 1 exists to stop the scroll, not to introduce the brand.
- **Never** lead with the brand name as the headline.
- Carry the piece's **`hook_overlay`** (the SMT 3–6 word on-screen hook
  convention) as the slide-1 headline treatment. The spoken/long hook and the
  `hook_overlay` are independent — slide 1 uses the overlay version.
- Put visual proof on slide 1 when the pillar has it (a real screenshot, a real
  number, a real result).
Hook formats (mom audience, English):
| Format | Example |
|---|---|
| Quiet confession | "Nobody told me parenting would wreck my body" |
| Number + payoff | "3 things I stopped apologizing for this year" |
| Question that lands | "Why does bedtime feel like a hostage negotiation?" |
| Concrete result | "This 2-line prompt planned our whole week" |
| Expectation flip | "The 'lazy' parenting move that actually worked" |

### 4.1 Cover hero image (mandatory on slide 1)
The cover slide carries a **full-bleed background image that represents the
carousel's narrative** — the editorial "magazine cover" for the piece. This
applies to **slide 1 only**; interior slides keep the dot-grid system (Section 7).

**The image follows SMT brand image rules** (`prompts/visual-design.md` → "Image
Rules"). Non-negotiable:
- **Show the emotional moment — faces welcome.** A parent has to recognize the
  situation in half a second, so a readable, expressive face (a crying toddler, a
  worn-out parent) is the goal, not something to avoid. Keep it to **one subject**
  (one child) so the feeling reads instantly. (The old "no faces" rule is retired
  for scene/cover imagery.)
- **Compose for the overlay.** The hero subject (face + upper body) sits **high in
  the frame** with calmer negative space in the **lower third**, because the
  legibility scrim + headline live at the **bottom**. The face must stay clear of
  the scrim.
- **Warm, golden-hour light.** Muted warm palette (amber, soft cream, dusty
  blush, muted sage). Never neon, cool, clinical, or oversaturated.
- **Editorial photography that reads real, not AI** — real, lived-in environments
  (kitchen, living room, car, park, bedroom). No text or words baked into the image.
- **Anti-hallucination prompt language (always append).** Image models drop or
  merge body parts, especially with children and emotional poses. Every cover scene
  brief MUST include: *"one full, complete, anatomically correct body with natural
  proportions; head, torso, both arms and both legs all present and connected;
  correct hands with five fingers; no missing, extra, merged, or distorted body
  parts; subject fully separated from the floor and background."* This is not
  optional — a vague brief is how you get the "torso with no lower body melting
  into the rug" failure.
- **Scene = the piece's story (the moment, not the solution).** Derive a one-line
  scene brief from the carousel's emotional hook (e.g. a tantrum/calm piece → "a
  cute toddler mid-meltdown, red flushed face, teary, messy hair, standing in a
  warm living room, a parent watching with empathy in the soft background").
  The scene shows the recognizable moment; it does not illustrate the literal hook text.

**Brand-tint via the scrim, not the photo.** Do not recolor the photograph. Tie
it to the carousel's violet/indigo family with the legibility scrim below.

**Cover legibility + chrome — the cover renders as a DARK slide:**
- Full-bleed `<img>` (`object-fit:cover`, `z-index:0`), per Section 8 (base64
  `data:` URI, generated via Python, MIME verified with `file`).
- A bottom-anchored scrim for text contrast: `linear-gradient(to top, #160734 0%,
  rgba(22,7,52,0.86) 38%, rgba(22,7,52,0) 72%)` over the photo (`z-index:1`). The
  brand-tinted near-black (`DARK_BG #160734`) is what ties the photo to the palette.
- Headline sits in the **lower third** over the scrim (mirrors the editorial cover
  band), Poppins 800, color `LIGHT_BG #FBFBFB`, with a subtle shadow
  `0 2px 8px rgba(0,0,0,0.45)`. Optional one-line sub in `BRAND_LIGHT #9B6BF0`.
- Use the **dark-slide chrome variants** (Section 7): counter pill in `#FBFBFB`,
  wordmark `BRAND_LIGHT #9B6BF0`, handle white ~72%, gradient arrow unchanged. The
  cover still omits the eyebrow kicker; a "PART N" tag stays optional bottom-right.

**Generation (DB-flip rules unchanged — this is a render asset, not a DB write):**
- Primary: **Gemini 2.5 Flash Image** ("nano banana", `gemini-2.5-flash-image`,
  `GEMINI_API_KEY`) with `generationConfig.imageConfig.aspectRatio:"3:4"` and
  `responseModalities:["IMAGE"]`. This is the same model family the avatar cover
  stage uses. **Why primary, not DALL-E:** OpenAI's `gpt-image-1` (the only image
  model on our key — `dall-e-3` 404s) **moderation-blocks emotional child imagery**
  (a crying/distressed toddler returns `moderation_blocked`). Since covers now lead
  with a recognizable emotional moment, Gemini is the reliable path.
- Fallback: `gpt-image-1` (`size:"1024x1536"`) for non-distress scenes, then
  Higgsfield `generate_image`. Save the cover into the per-piece output dir.
- Cover-crop to 4:5 biased toward the top so the subject's face stays high and the
  bottom scrim never covers it (`object-position:50% ~22%`).
- If no scene can be generated (no key, all tiers fail), fall back to the plain
  `LIGHT_BG` dot-grid cover (pre-1.2 behavior) and flag it in the preview — never
  ship a blank or off-brand cover, and never bake text into the generated image.

**Cover QA gate (MANDATORY — runs on every candidate before it is shown).**
Generate ≥2 candidates and **inspect each one** (Read the image) before surfacing
anything to Yaron. Fail closed on:
- **Anatomy / hallucination:** the subject must be one coherent, complete body —
  head + torso + both arms + both legs present and connected, body clearly
  separated from floor/furniture, hands with a plausible finger count, no warped or
  doubled faces, no merged/extra/missing limbs. (This is the check that should have
  caught the "baby with no lower body" candidate. If you would not believe it was a
  real photo, it fails.)
- **Brand + composition:** warm/golden-hour, on-palette, face high enough that the
  bottom scrim won't cover it, no baked-in text.
A failing candidate is discarded and regenerated with a corrected prompt (up to ~3
tries). Only candidates that pass the gate are shown for approval. **Never surface,
and never let Yaron have to catch, a hallucinated asset.**
---
## 5. Pillar → slide sequence (the SMT core)
The pillar on the row picks the sequence. This replaces generic "7-slide
standard." Light/dark alternation still creates rhythm; the **arc** is what's
pillar-specific. Adapt slide count to the content — not every piece fills every
slot.
**Content mix law:** the account is **60% Wow / 30% Trust / 10% CTA**. So **most
carousels do NOT end on a hard CTA** — they end on a save-prompt or a landing
line. A hard CTA slide appears only when the piece is part of the ~10% CTA
content. This is a deliberate break from generic carousel templates that always
close on a sell.
### `parenting_insights` (default; mostly Trust/Wow)
1. Hook (the moment / the tension)
2. The honest middle — what it actually feels like
3. The reframe / the insight
4. What it looks like in practice (1–2 concrete moves)
5. Soft close — a line she'll want to save. No hard CTA.
### `health` (Trust-builder; rarely any CTA)
1. Hook (the hidden load / the feeling)
2. Name it — the thing no one says out loud
3. Validation — you're not broken, you're carrying a lot
4. One small shift (gentle, not prescriptive; no medical claims)
5. Gentle landing line.
### `ai_magic` (curatorial — REAL artifacts only)
1. Hook (the result / the magic, not the tool)
2. **The real prompt** — verbatim, in the prompt/quote box, attributed
3. **The real output** — verbatim (excerpt if long, mark as excerpt)
4. Why it matters for a mom's actual day
5. Tool credit + source + soft CTA (this pillar can carry a light CTA)
   → If prompt/output aren't verbatim on the row, **abort** — do not stage it.
### `tech_for_moms` (lead with the result)
1. Hook — the result first ("I stopped losing the schedule")
2. The problem it kills
3. The app/tool (named, honest)
4. How it works (2–3 numbered steps)
5. Soft CTA / "save this."
### `trending` (72h window)
1. Hook — the moment everyone's reacting to
2. What's actually happening
3. The two sides / the take
4. SMT's grounded angle (we don't dunk; we steady)
5. Close. Flag urgency in handoff — this expires.
### `financial` (first-person only)
1. Hook — first-person framing ("Here's how I started thinking about…")
2. The shift in mindset (no products, no tickers, no tax/legal advice)
3. What I do now (still first-person, general)
4. **Mandatory disclaimer slide** ("Not financial advice…")
5. Soft close. Caption also carries the disclaimer.
---
## 6. Channels & dimensions — one design, two canvases
Channels are independent in the contract. This skill renders **both** from a
single design system.
| Channel | Canvas | Notes |
|---|---|---|
| Instagram | **1080×1350 (4:5)** | Native carousel. This is the master design. |
| TikTok photo mode | **1080×1920 (9:16)** | Same 4:5 slide centered on a brand-tinted 9:16 canvas with top/bottom safe-zone bands. |
TikTok safe zone: keep all critical content inside the central 1080×1350 area.
The right rail (like/comment/share/profile) and the bottom caption eat the
edges — bands + centering keep the design clean and uncropped. Do not just
stretch the 4:5 art to 9:16.
**Captions are per-channel and are NOT written by this skill.** Per the contract
(Stage 3.5), the Haiku polish step produces:
- TikTok caption: short, hook-first, hashtag-dense. ≤100 chars target, hard cap 150.
- Instagram caption: longer prose, hashtags at end/first comment. ≤400 target, cap 2200.
This skill **surfaces** those captions in the preview so Yaron sees the full
post, but it renders visuals only. The on-screen text is the real payload.
---
## 7. Slide anatomy — the real SMT chrome (every slide)
The live brand does **not** use a bottom progress bar (that was the generic
template). The real fixed chrome is: a counter pill top-right, a persistent
footer lockup bottom-left, and the gradient arrow bottom-right. Match this.
**Background (every slide):** LIGHT_BG `#FBFBFB` with a faint dot-grid texture
(repeating ~2px dots at ~24px spacing, INK at ~3% opacity). Dark slides use
DARK_BG `#160734` with the dots at white ~5%.
**Counter pill (top-right, every slide):** `N/total` (e.g. "1/10"), Poppins 700,
INK text, inside a pill with a 2px INK/violet outline, transparent fill,
~14px×8px padding, fully rounded.
**Footer lockup (bottom-left, every slide):** logo removed in v1.1. The text
lockup sits flush at the left content margin (80px), aligned with the eyebrow,
numeral, title, and body. Stacked top to bottom:
1. Wordmark "The Secret Moms Tribe", Poppins 700, BRAND_PRIMARY `#7941EA` on
   light slides, BRAND_LIGHT `#9B6BF0` on dark slides.
2. A thin **SMT_GRADIENT** divider line directly under the wordmark.
3. The handle "@thesecretmomstribe" (Poppins 500, INK ~70% on light, white ~72%
   on dark) with a small paper-plane glyph to its left.

> **v1.1 change:** the circular globe logo (`assets/brand/SMT_LOGO_small.png`) is
> no longer placed on carousel slides (removed per Yaron, 2026-06-09). Brand
> identity carries on the wordmark. Do not re-add the logo unless the design
> system changes again.
**Gradient arrow (bottom-right, every slide EXCEPT the last):** a chunky
right-pointing arrow filled with SMT_GRADIENT (violet→magenta→coral). Removed on
the final slide. **Vertically centered on the footer lockup** — the arrow's
center and the footer text block's center share the same baseline, so the swipe
cue reads level with the wordmark, not floating above it.
**Eyebrow kicker (top-left, every slide EXCEPT the cover):** the series title in
CORAL `#E94B6C`, Poppins 700, uppercase, +2px tracking (e.g. "MOTHERS ARE SHARING
'LIES' ABOUT MOTHERHOOD"). The cover slide omits the eyebrow (it carries the full
headline instead) and may add a "PART N" tag bottom-right in INK.
```js
// Counter pill — top-right
function counterPill(index, total, isDark) {
  const ink = isDark ? '#FBFBFB' : '#220758';
  return `<div style="position:absolute;top:40px;right:40px;z-index:10;
    border:2px solid ${ink};border-radius:999px;padding:6px 18px;">
    <span style="font-family:'Poppins',sans-serif;font-weight:700;font-size:20px;color:${ink};">${index + 1}/${total}</span>
  </div>`;
}
// Gradient arrow — bottom-right, all slides except the last
function gradientArrow() {
  return `<div style="position:absolute;bottom:44px;right:40px;z-index:10;width:96px;height:64px;">
    <svg viewBox="0 0 96 64" width="96" height="64">
      <defs><linearGradient id="smtgrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#7941EA"/><stop offset="50%" stop-color="#B443AD"/><stop offset="100%" stop-color="#E94B6C"/>
      </linearGradient></defs>
      <path d="M4 32 H70 M58 14 L82 32 L58 50" fill="none" stroke="url(#smtgrad)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>`;
}
```
The `ai_magic` prompt/output box is the canonical place verbatim prompt + output
render — keep it visually distinct (boxed, quoted, attributed, INK on a faint
violet tint), and always credit the source handle (e.g. "—u/qqvxii", underlined,
matching the reference's attribution style).
---
## 8. Handling user-provided images (keep — battle-tested)
These rules apply from the first HTML generation, not just at export.
⚠️ Critical:
- **Never** use relative paths (`photo.png`) — they break everywhere except the
  HTML's own folder.
- **Never** use `background:url(filepath)` with base64 — 1.5MB inline strings
  crash the parser. Use an `<img>` tag with `object-fit:cover`.
- **Always** embed as a base64 `data:` URI.
- **Always** generate the HTML via Python `Path.write_text()` — shell heredocs
  interpolate `$` and backticks and corrupt base64.
- **Always** check the real format with `file` — a `.png` may actually be JPEG;
  wrong MIME breaks rendering.
```python
import base64
from pathlib import Path
img_path = Path("/path/to/image.png")
mime = "image/jpeg"  # set from the `file` command output
b64 = base64.b64encode(img_path.read_bytes()).decode()
data_uri = f"data:{mime};base64,{b64}"
html = f"""
<div style="position:relative;width:100%;height:100%;">
  <img src="{data_uri}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;">
  <div style="position:absolute;inset:0;background:rgba(255,255,255,0.35);z-index:1;"></div>
  <!-- slide content z-index:2+ -->
</div>
"""
Path("/home/claude/carousel.html").write_text(html, encoding="utf-8")
```
Dark slides: use `rgba(0,0,0,0.45)` overlay instead of the light one.
---
## 9. Review flow — the SMT approval gate
Never skip to export. Yaron is the approver.
1. Generate the HTML preview first (IG-frame wrapper, English copy). Surface the
   per-channel captions alongside it.
2. Show it and ask: **"Which slides need a fix before export?"**
3. Fix only the named slides — never rebuild the whole set unless the direction
   fundamentally changes.
4. On explicit approval ("approved", "ship it", "export") → run both export
   passes → **then** the pipeline may flip the DB render fields. Not before.
---
## 10. Export — Playwright, two passes
Keep the layout at design width and scale up with `device_scale_factor`. Do not
set the viewport to the output resolution (it reflows the layout).
Install only if missing:
```bash
python3 -c "import playwright" 2>/dev/null || pip3 install playwright
python3 -c "from playwright.sync_api import sync_playwright; sync_playwright().__enter__().chromium" 2>/dev/null || python3 -m playwright install chromium
```
**Instagram pass (4:5 → 1080×1350):** viewport 420×525, `device_scale_factor =
1080/420 ≈ 2.5714`.
**TikTok pass (9:16 → 1080×1920):** render the same 420×525 slide centered on a
420×747 canvas (9:16) with brand-tinted top/bottom bands, then
`device_scale_factor = 1080/420 ≈ 2.5714` → 1080×1920. Critical content stays in
the central 4:5 safe area.
```python
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
INPUT_HTML = Path("/path/to/carousel.html")
OUT = Path("/path/to/output"); OUT.mkdir(parents=True, exist_ok=True)
TOTAL_SLIDES = 5  # set per piece
async def export(channel, view_w, view_h, out_w):
    scale = out_w / view_w
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": view_w, "height": view_h},
                                       device_scale_factor=scale)
        await page.set_content(INPUT_HTML.read_text(encoding="utf-8"), wait_until="networkidle")
        await page.wait_for_timeout(3000)  # let Google Fonts load
        await page.evaluate("""() => {
            document.querySelectorAll('.ig-header,.ig-dots,.ig-actions,.ig-caption').forEach(el => el.style.display='none');
            const frame = document.querySelector('.ig-frame');
            frame.style.cssText = 'width:420px;height:525px;max-width:none;border-radius:0;box-shadow:none;overflow:hidden;margin:0;';
            const vp = document.querySelector('.carousel-viewport');
            vp.style.cssText = 'width:420px;height:525px;aspect-ratio:unset;overflow:hidden;cursor:default;';
            document.body.style.cssText = 'padding:0;margin:0;display:block;overflow:hidden;';
        }""")
        # TikTok pass: wrap the 420x525 viewport in a 420x747 brand-banded canvas here.
        await page.wait_for_timeout(500)
        for i in range(TOTAL_SLIDES):
            await page.evaluate("""(idx) => {
                const t = document.querySelector('.carousel-track');
                t.style.transition = 'none';
                t.style.transform = 'translateX(' + (-idx * 420) + 'px)';
            }""", i)
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / f"{channel}_slide_{i+1}.png"),
                                  clip={"x":0,"y":0,"width":view_w,"height":view_h})
            print(f"{channel} slide {i+1}/{TOTAL_SLIDES}")
        await browser.close()
asyncio.run(export("ig", 420, 525, 1080))      # → 1080x1350
asyncio.run(export("tiktok", 420, 747, 1080))  # → 1080x1920 (with brand bands)
```
Common export mistakes: setting viewport to output res (layout reflows — keep
420 width, scale via DPI); shell-generating HTML ($/backtick corruption);
skipping the font wait (fallback fonts render); not hiding IG chrome; leaving
`BRAND_PRIMARY` as a variable name; stretching 4:5 art to 9:16 for TikTok instead
of banding it.
---
## 11. Output handoff
On approval:
- Assets in a per-piece dir: `ig_slide_1..N.png` (1080×1350),
  `tiktok_slide_1..N.png` (1080×1920).
- Manifest: which `content_queue` row, pillar, slide count, per-channel caption.
- The pipeline may then flip `render_status='complete'` with `final_asset_url`
  and `render_completed_at` set together (the contract's atomic write). The
  per-channel captions live on `scheduled_posts`, not here.
- Anything dropped → `rejected[]` with reason + field.
---
## Open follow-ups (do not block on these)
- **Contract:** when this ships, bump `SMT_PIPELINE_CONTRACT.md` to v2.2.0 —
  carousel profile moves from "TBD" to locked, entry point = this skill.
- **Canon values:** confirm the exact SMT primary hex + heading/body pairing are
  resolvable from the Visual Design Guide at runtime so this skill never
  hardcodes brand values.
- **Future automation:** a renderer-orchestrator peer skill could auto-pick
  `render_profile_slug='carousel'`, `status='approved'` rows and run this flow
  to a human-review queue — same pattern proposed for `avatar-v1`.
