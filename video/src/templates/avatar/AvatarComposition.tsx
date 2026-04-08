import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { type AvatarCompositionProps } from "./types";
import { AvatarClipSequence } from "./AvatarClipSequence";
import { SplitScreen } from "./SplitScreen";
import { BrollInsert } from "./BrollInsert";
import { HookOverlay } from "./HookOverlay";
import { CTAOverlay } from "./CTAOverlay";
import { PhraseCaptions } from "../shared/PhraseCaptions";
import { BrandWatermark } from "../shared/BrandWatermark";
import { BrandFilter } from "../shared/BrandFilter";
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
      <AvatarClipSequence clips={avatarClips} />

      {splitClips.map((clip, i) => (
        <SplitScreen key={`split-${i}`} clip={clip} />
      ))}

      {brollClips.map((clip, i) => (
        <BrollInsert key={`broll-${i}`} clip={clip} />
      ))}

      <BrandFilter intensity="light" />

      <PhraseCaptions
        slides={fakeSlidesForCaptions}
        voiceoverStartSec={0}
      />

      <HookOverlay text={hookText} />

      <CTAOverlay text={ctaText} totalFrames={totalFrames} />

      <BrandWatermark accentColor={colors.accent} />

      {audioFile && <Audio src={staticFile(audioFile)} />}
    </AbsoluteFill>
  );
};
