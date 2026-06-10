import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND_PURPLE } from "../v2/types";

/**
 * Locked SMT hook overlay style for Avatar Full + future video formats.
 *
 * Aligned with the canonical hook-card SVG design in
 * `video/scripts/generate-hook-card.ts` (Option A — bold solid block):
 *  - Full-width purple block (#63246a — BRAND_PURPLE) with EDGE BLEED:
 *    block extends -100 px to +1180 px on a 1080 px frame, so the
 *    rotation corners don't expose the canvas background through the
 *    edges.
 *  - Tilted ~2° clockwise (`rotate(-2deg)`) — matches the static
 *    thumbnail design.
 *  - Lower-third positioned (top ~68 % of frame, block center ~y=1500
 *    on a 1920-tall frame ≈ 78 %), clear of the brand watermark at
 *    bottom-right.
 *  - Bold sans-serif all-caps white text, line 1 dominant, optional
 *    line 2 smaller and supporting.
 *  - Hard cut in/out (no fade) — UGC vibe, matches hard-cut concat.
 *  - 1-second total duration.
 *
 * Documented in FACE_OF_SMT_V1.md "Hook Overlay Style" section. If the
 * visual needs to change, update this component AND the doc AND
 * generate-hook-card.ts together — never one without the others.
 *
 * Restored 2026-05-19 per Phase 9 v2 eye-check: rotation + edge bleed
 * were missing from the v3-era SMTHookOverlay even though the
 * hook-card SVG had them; the video overlay now matches the static
 * thumbnail's stylistic intent.
 */

export interface SMTHookOverlayProps {
  primary: string;
  secondary?: string;
  /** When the overlay enters (default 0s). */
  startSec?: number;
  /** How long the overlay is visible (default 1.0s). */
  durationSec?: number;
  /** Block rotation in degrees (negative = clockwise). Default -2 to match the hook-card SVG. */
  rotationDeg?: number;
}

const EDGE_BLEED_PX = 100;

// Responsive primary sizing. The hook text MUST fit inside the visible 1080px
// frame (with margin for the -2° rotation) regardless of length — a fixed
// font-size overflowed long hooks (e.g. "THE LIE TRAP WE ALL FALL INTO").
// PRIMARY_FIT_WIDTH constrains the text box so it physically cannot overflow
// (it wraps), and the font-size scales down with length so a long hook lands
// on ~2 balanced lines instead of 3. Mirrors the fit-to-width intent of the
// canonical hook-card SVG (generate-hook-card.ts uses SVG textLength).
const PRIMARY_FIT_WIDTH = 940; // px — safe inside 1080 visible frame at -2°
const PRIMARY_MAX_FONT = 124;
const PRIMARY_MIN_FONT = 64;
const CAP_ADVANCE_RATIO = 0.64; // Helvetica-bold all-caps avg glyph advance / font-size

function fitPrimaryFontSize(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return PRIMARY_MAX_FONT;
  // Assume the hook lands on up to two balanced lines; size so the longer
  // line fits PRIMARY_FIT_WIDTH.
  const longestLineChars = chars <= 14 ? chars : Math.ceil(chars / 2);
  const fit = Math.floor(PRIMARY_FIT_WIDTH / (longestLineChars * CAP_ADVANCE_RATIO));
  return Math.max(PRIMARY_MIN_FONT, Math.min(PRIMARY_MAX_FONT, fit));
}

export const SMTHookOverlay: React.FC<SMTHookOverlayProps> = ({
  primary,
  secondary,
  startSec = 0,
  durationSec = 1.0,
  rotationDeg = -2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Hard cut in/out — no fade.
  if (t < startSec || t >= startSec + durationSec) return null;

  const primaryFontSize = fitPrimaryFontSize(primary);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          // Lower-third positioning — block center sits around y=78%.
          top: "68%",
          // Edge bleed so the rotated corners don't expose the canvas.
          left: -EDGE_BLEED_PX,
          right: -EDGE_BLEED_PX,
          backgroundColor: BRAND_PURPLE,
          padding: "56px 60px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: "center center",
        }}
      >
        <div
          style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 900,
            fontSize: primaryFontSize,
            letterSpacing: 4,
            color: "#fcfcfa",
            textTransform: "uppercase",
            lineHeight: 1.04,
            textAlign: "center",
            // Hard width cap so long hooks wrap instead of overflowing the
            // frame. Combined with fitPrimaryFontSize this keeps the hook on
            // ~2 balanced lines and fully inside the 1080px canvas.
            maxWidth: PRIMARY_FIT_WIDTH,
            whiteSpace: "normal",
            overflowWrap: "break-word",
          }}
        >
          {primary}
        </div>
        {secondary && (
          <div
            style={{
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              fontWeight: 600,
              fontSize: 44,
              letterSpacing: 1,
              color: "#fcfcfa",
              textTransform: "uppercase",
              textAlign: "center",
              opacity: 0.95,
            }}
          >
            {secondary}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
