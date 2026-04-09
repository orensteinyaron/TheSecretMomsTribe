import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  staticFile,
  useVideoConfig,
} from "remotion";
import { type ResolvedClip } from "./types";

interface AvatarClipSequenceProps {
  clips: ResolvedClip[];
}

/**
 * Renders avatar clips with HARD CUTS (no crossfade).
 * Each clip plays its own HeyGen-baked audio for perfect lip sync.
 * FPS comes from useVideoConfig() (set to 25 in Root.tsx to match HeyGen output).
 */
export const AvatarClipSequence: React.FC<AvatarClipSequenceProps> = ({
  clips,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        if (!clip.videoFile) return null;

        const startFrame = Math.round(clip.startSec * fps);
        const durationFrames = Math.round(clip.durationSec * fps);

        return (
          <Sequence
            key={`clip-${i}`}
            from={startFrame}
            durationInFrames={durationFrames}
            layout="none"
          >
            <AbsoluteFill>
              <OffthreadVideo
                src={staticFile(clip.videoFile)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
                volume={1}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
