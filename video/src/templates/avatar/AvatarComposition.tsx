import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { type AvatarCompositionProps } from "./types";
import { AvatarClipSequence } from "./AvatarClipSequence";
import { SplitScreen } from "./SplitScreen";
import { BrollInsert } from "./BrollInsert";
import { CTAOverlay } from "./CTAOverlay";
import { PhraseCaptions } from "../shared/PhraseCaptions";
import { BrandWatermark } from "../shared/BrandWatermark";
import { PILLAR_COLORS } from "../v2/types";

export const AvatarComposition: React.FC<AvatarCompositionProps> = ({
  clips,
  phraseTimings,
  hookText,
  ctaText,
  totalDurationSec,
  pillar,
  audioFile,
}) => {
  const colors = PILLAR_COLORS[pillar] ?? PILLAR_COLORS.default;
  const fps = 30;
  const totalFrames = Math.round(totalDurationSec * fps);

  const avatarClips = clips.filter((c) => c.type === "avatar");
  const splitClips = clips.filter((c) => c.type === "split");
  const brollClips = clips.filter((c) => c.type === "broll");

  const fakeSlidesForCaptions = [
    {
      text: "",
      phraseGroups: phraseTimings,
      visualSegments: [],
      pexelsQueries: [],
    },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1: Avatar video clips */}
      <AvatarClipSequence clips={avatarClips} />

      {/* Layer 2: Split-screen inserts */}
      {splitClips.map((clip, i) => (
        <SplitScreen key={`split-${i}`} clip={clip} />
      ))}

      {/* Layer 3: B-roll inserts */}
      {brollClips.map((clip, i) => (
        <BrollInsert key={`broll-${i}`} clip={clip} />
      ))}

      {/* Layer 4: Phrase captions — positioned at bottom for avatar */}
      <PhraseCaptions
        slides={fakeSlidesForCaptions}
        voiceoverStartSec={0}
        position="bottom"
      />

      {/* Layer 5: CTA text overlay (last 3s) */}
      <CTAOverlay text={ctaText} totalFrames={totalFrames} />

      {/* Layer 6: Brand watermark */}
      <BrandWatermark accentColor={colors.accent} />

      {/* Layer 7: Master audio track */}
      {audioFile && <Audio src={staticFile(audioFile)} />}
    </AbsoluteFill>
  );
};
