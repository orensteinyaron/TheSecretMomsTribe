import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

import type { Phrase } from "../../../lib/phrase-grouper.js";

// Plain CSS font-family fallback (matches SMTHookOverlay). Avoids the
// @remotion/google-fonts nested-version dep clash that fires when the
// orchestrator CLI imports this module indirectly via AvatarV5Composition.
const CAPTION_FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * AvatarV5 phrase captions.
 *
 * Renders per-clip phrase captions in the bottom-third, synchronized to
 * Whisper word-level timestamps (sourced from the Seedance MP4's embedded
 * audio — Finding 4). Each clip's phrases are CLIP-LOCAL (start_s 0
 * relative to clip start); this component is mounted inside the clip's
 * <Sequence> so Remotion handles the global offset automatically.
 *
 * Style (per Yaron's v5 spec):
 *   - White Inter Bold 700, 52px, UPPERCASE
 *   - Bottom-third position (paddingBottom 140), above brand watermark area
 *   - Minimal drop shadow (2px offset, ~60 % opacity black, 2px blur) —
 *     just enough to keep white text legible on Rachel's hair or a light
 *     kitchen background, NOT the chunky decorative shadow the legacy
 *     PhraseCaptions component carried
 *   - Per-phrase 3-frame fade in/out — soft pulse-on per phrase
 */

const FADE_FRAMES = 3;
const CAPTION_SHADOW = "0 2px 2px rgba(0,0,0,0.6)";

type Props = {
  phrases: Phrase[];
};

export const AvatarV5Captions: React.FC<Props> = ({ phrases }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (!phrases || phrases.length === 0) return null;

  // Find the currently active phrase (one whose [start_s, end_s) contains t).
  const active = phrases.find((p) => t >= p.start_s && t < p.end_s);
  if (!active) return null;

  const phraseStartFrame = Math.round(active.start_s * fps);
  const phraseEndFrame = Math.round(active.end_s * fps);
  const frameInPhrase = frame - phraseStartFrame;
  const phraseFrames = Math.max(1, phraseEndFrame - phraseStartFrame);

  const fadeIn = interpolate(frameInPhrase, [0, FADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frameInPhrase,
    [phraseFrames - FADE_FRAMES, phraseFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 140,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          color: "#FFFFFF",
          fontFamily: CAPTION_FONT,
          fontWeight: 700,
          fontSize: 52,
          textTransform: "uppercase",
          textAlign: "center",
          letterSpacing: 2,
          textShadow: CAPTION_SHADOW,
          padding: "0 60px",
          lineHeight: 1.25,
          maxWidth: 950,
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};
