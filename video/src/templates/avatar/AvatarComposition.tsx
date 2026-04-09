import React from "react";
import { AbsoluteFill } from "remotion";
import { type AvatarCompositionProps } from "./types";
import { AvatarClipSequence } from "./AvatarClipSequence";
import { SplitScreen } from "./SplitScreen";
import { BrollInsert } from "./BrollInsert";
import { PhraseCaptions } from "../shared/PhraseCaptions";
import { BrandWatermark } from "../shared/BrandWatermark";
import { PILLAR_COLORS } from "../v2/types";

export const AvatarComposition: React.FC<AvatarCompositionProps> = ({
  clips,
  phraseTimings,
  totalDurationSec,
  pillar,
}) => {
  const colors = PILLAR_COLORS[pillar] ?? PILLAR_COLORS.default;

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
      {/* Layer 1: Avatar video clips (each plays its own lip-synced audio) */}
      <AvatarClipSequence clips={avatarClips} />

      {/* Layer 2: Split-screen inserts */}
      {splitClips.map((clip, i) => (
        <SplitScreen key={`split-${i}`} clip={clip} />
      ))}

      {/* Layer 3: B-roll inserts */}
      {brollClips.map((clip, i) => (
        <BrollInsert key={`broll-${i}`} clip={clip} />
      ))}

      {/* Layer 4: Phrase captions — ONLY text layer. 3-4 words at a time. */}
      <PhraseCaptions
        slides={fakeSlidesForCaptions}
        voiceoverStartSec={0}
        position="bottom"
      />

      {/* Layer 5: Brand watermark */}
      <BrandWatermark accentColor={colors.accent} />

      {/* NO CTAOverlay — captions already show words phrase by phrase */}
      {/* NO HookOverlay — Marry speaks the hook, no text overlay needed */}
      {/* NO master Audio — each HeyGen clip has lip-synced audio baked in */}
    </AbsoluteFill>
  );
};
