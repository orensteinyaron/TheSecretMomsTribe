import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import {
  type SlideData,
  type PhraseGroup,
  PHRASE_CROSSFADE,
} from "../v2/types";

// Load Inter font for captions
const { fontFamily: interFont } = loadFont();

type CaptionPosition = "center" | "bottom" | "middle";

interface PhraseCaptionsProps {
  slides: SlideData[];
  voiceoverStartSec: number;
  /** "center" = V2 default (35% from top), "bottom" = avatar (bottom 15%), "middle" = split screen */
  position?: CaptionPosition;
}

interface FlatPhrase extends PhraseGroup {
  index: number;
}

const CAPTION_SHADOW = "0 2px 6px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)";

export const PhraseCaptions: React.FC<PhraseCaptionsProps> = ({
  slides,
  position = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Flatten all phrase groups into one chronological list
  const flatPhrases: FlatPhrase[] = [];
  let idx = 0;
  for (const slide of slides) {
    for (const pg of slide.phraseGroups) {
      flatPhrases.push({ ...pg, index: idx });
      idx++;
    }
  }

  const currentTimeSec = frame / fps;

  // Find active phrase
  const activePhrase = flatPhrases.find(
    (p) => currentTimeSec >= p.startTime && currentTimeSec < p.endTime,
  );

  if (!activePhrase) return null;

  const phraseStartFrame = Math.round(activePhrase.startTime * fps);
  const phraseEndFrame = Math.round(activePhrase.endTime * fps);
  const frameInPhrase = frame - phraseStartFrame;
  const phraseDuration = phraseEndFrame - phraseStartFrame;

  // Fade in/out
  const fadeIn = interpolate(frameInPhrase, [0, PHRASE_CROSSFADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frameInPhrase,
    [phraseDuration - PHRASE_CROSSFADE, phraseDuration],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // Clip to 4 words max
  const displayText = activePhrase.words
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");

  // Position styles based on mode
  const positionStyles: React.CSSProperties = (() => {
    switch (position) {
      case "bottom":
        return {
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 140,
        };
      case "middle":
        return {
          justifyContent: "center",
          alignItems: "center",
        };
      case "center":
      default:
        return {
          justifyContent: "center",
          alignItems: "center",
        };
    }
  })();

  // Gradient band position
  const gradientStyles: React.CSSProperties = (() => {
    switch (position) {
      case "bottom":
        return {
          position: "absolute" as const,
          left: 0, right: 0, bottom: 0, height: "25%",
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)",
          pointerEvents: "none" as const,
        };
      case "middle":
        return {
          position: "absolute" as const,
          left: 0, right: 0, top: "35%", height: "30%",
          background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 35%, rgba(0,0,0,0.3) 65%, transparent 100%)",
          pointerEvents: "none" as const,
        };
      default:
        return {
          position: "absolute" as const,
          left: 0, right: 0, top: "35%", height: "30%",
          background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, rgba(0,0,0,0.4) 65%, transparent 100%)",
          pointerEvents: "none" as const,
        };
    }
  })();

  return (
    <AbsoluteFill>
      {/* Dark gradient band behind text */}
      <div style={gradientStyles} />

      {/* Caption text */}
      <AbsoluteFill style={positionStyles}>
        <div
          style={{
            opacity,
            color: "#FFFFFF",
            fontFamily: interFont,
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
          {displayText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
