import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND_PURPLE } from "../v2/types";

/**
 * Locked SMT hook overlay style for Avatar Full + future video formats.
 *
 * Spec (do not drift):
 * - Full-width purple block (#63246a — BRAND_PURPLE)
 * - Block height ~20% of frame
 * - Positioned lower-middle (clear of brand watermark at bottom-right)
 * - Bold sans-serif all-caps white text, line 1 dominant, line 2 supporting
 * - Hard cut in/out (no fade) — UGC vibe, matches hard-cut concat
 * - 1-second total duration
 *
 * Documented in FACE_OF_SMT_V1.md "Hook Overlay Style" section. If the visual
 * needs to change, update both this component AND the doc — never one without
 * the other.
 */

export interface SMTHookOverlayProps {
  primary: string;
  secondary?: string;
  /** When the overlay enters (default 0s). */
  startSec?: number;
  /** How long the overlay is visible (default 1.0s). */
  durationSec?: number;
}

export const SMTHookOverlay: React.FC<SMTHookOverlayProps> = ({
  primary,
  secondary,
  startSec = 0,
  durationSec = 1.0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Hard cut in/out — no fade.
  if (t < startSec || t >= startSec + durationSec) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "55%",
          left: 0,
          right: 0,
          backgroundColor: BRAND_PURPLE,
          padding: "56px 60px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 900,
            fontSize: 124,
            letterSpacing: 4,
            color: "#fcfcfa",
            textTransform: "uppercase",
            lineHeight: 1,
            textAlign: "center",
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
