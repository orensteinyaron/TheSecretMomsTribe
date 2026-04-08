import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Audio,
  staticFile,
  useCurrentFrame,
  interpolate,
} from "remotion";
import {
  type KaraokeSlideshowProps,
  HOOK_FRAMES,
  CTA_FRAMES,
  PILLAR_COLORS,
  TEXT_SHADOW,
  FPS,
} from "./types";
import { BackgroundSequence } from "./BackgroundSequence";
import { PhraseCaptions } from "../shared/PhraseCaptions";
import { BrandWatermark } from "../shared/BrandWatermark";

// ── Hook: static title card (no animation, no phrase splitting) ──

const HookOverlay: React.FC<{ hookText: string }> = ({ hookText }) => {
  const frame = useCurrentFrame();
  // Fade out in last 10 frames to crossfade into content
  const fadeOut = interpolate(frame, [HOOK_FRAMES - 10, HOOK_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: 64,
          fontWeight: 800,
          textTransform: "uppercase",
          color: "#FFFFFF",
          textShadow: TEXT_SHADOW,
          textAlign: "center",
          padding: "0 70px",
          lineHeight: 1.2,
          letterSpacing: 2,
          maxWidth: 950,
        }}
      >
        {hookText}
      </div>
    </AbsoluteFill>
  );
};

// ── CTA: static text block with handle ──

const CTAOverlay: React.FC<{ ctaText: string; accentColor: string }> = ({
  ctaText,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  // Fade in over first 10 frames
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 50,
          padding: "0 70px",
        }}
      >
        {/* CTA text — static, full block */}
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 56,
            fontWeight: 800,
            textTransform: "uppercase",
            color: "#FFFFFF",
            textShadow: TEXT_SHADOW,
            textAlign: "center",
            lineHeight: 1.2,
            letterSpacing: 2,
            maxWidth: 900,
          }}
        >
          {ctaText}
        </div>

        {/* Handle */}
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 28,
            fontWeight: 700,
            color: accentColor,
            letterSpacing: 3,
            textShadow: TEXT_SHADOW,
          }}
        >
          @thesecretmomstribe
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Main Composition ──

export const KaraokeSlideshow: React.FC<KaraokeSlideshowProps> = (props) => {
  const {
    hookText,
    hookImage,
    slides,
    ctaText,
    ctaStartSec,
    pillar,
    voiceoverFile,
    totalDuration,
  } = props;

  const colors = PILLAR_COLORS[pillar] || PILLAR_COLORS.default;
  const totalFrames = Math.round(totalDuration * FPS);
  const hookSec = HOOK_FRAMES / FPS;

  // CTA starts at the Whisper-detected timestamp, or falls back to last 5s
  const ctaFrame = ctaStartSec
    ? Math.round(ctaStartSec * FPS)
    : totalFrames - CTA_FRAMES;
  const ctaDuration = totalFrames - ctaFrame;
  const voiceoverFrames = ctaFrame - HOOK_FRAMES;

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a1a" }}>
      {/* Layer 1: Background sequence — full duration */}
      <BackgroundSequence
        slides={slides}
        totalDuration={totalDuration}
        hookImage={hookImage}
      />

      {/* Hook: static title card — first 4 seconds */}
      <Sequence from={0} durationInFrames={HOOK_FRAMES}>
        <HookOverlay hookText={hookText} />
      </Sequence>

      {/* Layer 2: Phrase captions — during voiceover only */}
      {slides.length > 0 && (
        <Sequence from={HOOK_FRAMES} durationInFrames={voiceoverFrames}>
          <PhraseCaptions slides={slides} voiceoverStartSec={hookSec} />
        </Sequence>
      )}

      {/* CTA: static text block — timed to when voice starts reading CTA */}
      <Sequence from={ctaFrame} durationInFrames={ctaDuration}>
        <CTAOverlay ctaText={ctaText} accentColor={colors.accent} />
      </Sequence>

      {/* Audio — starts after hook */}
      {voiceoverFile && (
        <Sequence from={HOOK_FRAMES}>
          <Audio src={staticFile(voiceoverFile)} />
        </Sequence>
      )}

      {/* Brand watermark — persistent */}
      <BrandWatermark accentColor={colors.accent} />
    </AbsoluteFill>
  );
};
