import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import {
  type SlideData,
  type PhraseGroup,
  PHRASE_CROSSFADE,
  TEXT_SHADOW,
} from "../v2/types";

interface PhraseCaptionsProps {
  slides: SlideData[];
  voiceoverStartSec: number;
}

interface FlatPhrase extends PhraseGroup {
  index: number;
}

export const PhraseCaptions: React.FC<PhraseCaptionsProps> = ({
  slides,
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

  // ONE style only: white, 60px, weight 800, drop shadow. No color variation.
  const fontSize = 60;
  const color = "#FFFFFF";

  // Clip to 4 words max
  const displayText = activePhrase.words
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");

  return (
    <AbsoluteFill>
      {/* Dark gradient band behind text */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "35%",
          height: "30%",
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, rgba(0,0,0,0.4) 65%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Caption text — locked to exactly 2 styles */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            opacity,
            transform: "scale(1)",
            color,
            fontFamily: "sans-serif",
            fontWeight: 800,
            fontSize,
            textTransform: "uppercase",
            textAlign: "center",
            letterSpacing: 3,
            textShadow: TEXT_SHADOW,
            padding: "0 60px",
            lineHeight: 1.2,
            maxWidth: 950,
          }}
        >
          {displayText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
