import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from "remotion";
import { type ResolvedClip, CROSSFADE_FRAMES } from "./types";

interface AvatarClipSequenceProps {
  clips: ResolvedClip[];
}

/**
 * Renders avatar clips using Remotion Sequences.
 * Each clip gets its own Sequence so OffthreadVideo plays from frame 0.
 * Crossfade: during overlap, both outgoing and incoming clips are visible.
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

        // Extend each clip by CROSSFADE_FRAMES so it overlaps with the next
        const extendedDuration = durationFrames + (i < clips.length - 1 ? CROSSFADE_FRAMES : 0);

        return (
          <Sequence
            key={`clip-${i}`}
            from={startFrame}
            durationInFrames={extendedDuration}
            layout="none"
          >
            <ClipRenderer
              clip={clip}
              clipIndex={i}
              totalClips={clips.length}
              durationFrames={durationFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface ClipRendererProps {
  clip: ResolvedClip;
  clipIndex: number;
  totalClips: number;
  durationFrames: number;
}

/**
 * Renders a single clip with fade-in/fade-out.
 * useCurrentFrame() here is LOCAL to the Sequence (starts at 0).
 */
const ClipRenderer: React.FC<ClipRendererProps> = ({
  clip,
  clipIndex,
  totalClips,
  durationFrames,
}) => {
  const localFrame = useCurrentFrame();

  // Fade in (not on first clip)
  const fadeIn = clipIndex > 0
    ? interpolate(localFrame, [0, CROSSFADE_FRAMES], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  // Fade out (not on last clip) — fade out at the END of the original duration
  const fadeOut = clipIndex < totalClips - 1
    ? interpolate(
        localFrame,
        [durationFrames - CROSSFADE_FRAMES, durationFrames],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;

  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={staticFile(clip.videoFile!)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        volume={0}
      />
    </AbsoluteFill>
  );
};
