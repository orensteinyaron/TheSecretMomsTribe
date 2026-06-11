// Cover hook-banner overlay — the purple SMT hook band applied to the
// generated cover image, with brand styling from the carousel visual system
// (skills/carousel-builder/SKILL.md): INK #220758, BRAND_PRIMARY #7941EA,
// Poppins ExtraBold. Same hook_overlay text as the video.
//
// IG GRID SAFE ZONE: the grid crops reel covers to 3:4. On a 1080×1920
// canvas the surviving region is the vertical center 1080×1440 — rows
// 240..1680. The band (including its -2° rotation overshoot) must sit
// entirely inside that region, or the hook gets chopped on the grid.

import sharp from "sharp";

export const COVER_W = 1080;
export const COVER_H = 1920;

// Brand styling (carousel visual system).
export const INK = "#220758";
export const BRAND_PRIMARY = "#7941EA";
export const OFF_WHITE = "#FCFCFA";

// IG 3:4 center-crop safe zone on a 9:16 canvas.
export const IG_GRID_SAFE_TOP_Y = (COVER_H - (COVER_W * 4) / 3) / 2; // 240
export const IG_GRID_SAFE_BOTTOM_Y = COVER_H - IG_GRID_SAFE_TOP_Y; // 1680

// Band geometry. Rotated -2° like the canonical hook card / SMTHookOverlay,
// with ±100px edge bleed so the rotated corners never expose the background.
export const BAND_ROTATION_DEG = -2;
export const BAND_EDGE_BLEED_PX = 100;
export const BAND_HEIGHT = 280;
/** Band vertical center — low in the frame but inside the 3:4 safe zone. */
export const BAND_CENTER_Y = 1480;
export const BAND_TOP_Y = BAND_CENTER_Y - BAND_HEIGHT / 2; // 1340
export const BAND_BOTTOM_Y = BAND_CENTER_Y + BAND_HEIGHT / 2; // 1620

/**
 * Worst-case extra vertical extent from rotating the (bled) band by -2°:
 * half-width × sin(2°). Used by the safe-zone assertion + its test.
 */
export const BAND_ROTATION_OVERSHOOT_PX = Math.ceil(
  ((COVER_W / 2 + BAND_EDGE_BLEED_PX) * Math.abs(Math.sin((BAND_ROTATION_DEG * Math.PI) / 180))),
);

/** The INK under-band shadow is offset +10px below the band. */
export const BAND_SHADOW_OFFSET_PX = 10;

export function assertBannerInsideSafeZone(): void {
  const top = BAND_TOP_Y - BAND_ROTATION_OVERSHOOT_PX;
  const bottom = BAND_BOTTOM_Y + BAND_SHADOW_OFFSET_PX + BAND_ROTATION_OVERSHOOT_PX;
  if (top < IG_GRID_SAFE_TOP_Y || bottom > IG_GRID_SAFE_BOTTOM_Y) {
    throw new Error(
      `cover banner leaves the IG 3:4 safe zone: band ${top}..${bottom} vs safe ${IG_GRID_SAFE_TOP_Y}..${IG_GRID_SAFE_BOTTOM_Y}`,
    );
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Length-responsive font sizing (hook-overlay-fit lesson: a fixed font
// overflows long hooks). textLength additionally hard-caps the line width.
const BAND_TEXT_WIDTH = 920;
const PRIMARY_MAX_FONT = 92;
const PRIMARY_MIN_FONT = 56;
const CAP_ADVANCE_RATIO = 0.62; // ExtraBold all-caps avg glyph advance / font-size

export function fitBannerFontSize(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return PRIMARY_MAX_FONT;
  const fit = Math.floor(BAND_TEXT_WIDTH / (chars * CAP_ADVANCE_RATIO));
  return Math.max(PRIMARY_MIN_FONT, Math.min(PRIMARY_MAX_FONT, fit));
}

export function bannerSvg(hookPrimary: string, hookSecondary?: string): string {
  const primary = escapeXml(hookPrimary.toUpperCase());
  const secondary = hookSecondary ? escapeXml(hookSecondary.toUpperCase()) : null;
  const fontSize = fitBannerFontSize(hookPrimary);
  const primaryBaseline = secondary ? BAND_CENTER_Y - 18 : BAND_CENTER_Y + fontSize * 0.36;
  const fontFamily = "'Poppins', 'Helvetica Neue', 'Arial Black', sans-serif";
  return `<svg width="${COVER_W}" height="${COVER_H}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(${BAND_ROTATION_DEG} ${COVER_W / 2} ${BAND_CENTER_Y})">
    <rect x="${-BAND_EDGE_BLEED_PX}" y="${BAND_TOP_Y + BAND_SHADOW_OFFSET_PX}" width="${COVER_W + 2 * BAND_EDGE_BLEED_PX}" height="${BAND_HEIGHT}" fill="${INK}" fill-opacity="0.55"/>
    <rect x="${-BAND_EDGE_BLEED_PX}" y="${BAND_TOP_Y}" width="${COVER_W + 2 * BAND_EDGE_BLEED_PX}" height="${BAND_HEIGHT}" fill="${BRAND_PRIMARY}"/>
    <text x="${COVER_W / 2}" y="${primaryBaseline}"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="800"
          fill="${OFF_WHITE}"
          text-anchor="middle"
          letter-spacing="1"
          textLength="${Math.min(BAND_TEXT_WIDTH, Math.round(primary.length * fontSize * CAP_ADVANCE_RATIO))}"
          lengthAdjust="spacingAndGlyphs">${primary}</text>
    ${secondary ? `<text x="${COVER_W / 2}" y="${BAND_CENTER_Y + 72}"
          font-family="${fontFamily}"
          font-size="40"
          font-weight="700"
          fill="${OFF_WHITE}"
          fill-opacity="0.95"
          text-anchor="middle"
          letter-spacing="1">${secondary}</text>` : ""}
  </g>
</svg>`;
}

export interface ComposeBannerInput {
  /** The generated cover image (any size — cover-fit resized to 1080×1920). */
  baseImage: Buffer;
  hookPrimary: string;
  hookSecondary?: string;
}

/** Resize to 1080×1920 and composite the hook band. Returns PNG bytes. */
export async function composeCoverWithBanner(input: ComposeBannerInput): Promise<Buffer> {
  assertBannerInsideSafeZone();
  const base = await sharp(input.baseImage)
    .resize(COVER_W, COVER_H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: Buffer.from(bannerSvg(input.hookPrimary, input.hookSecondary)), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
