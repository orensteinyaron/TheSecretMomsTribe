import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  interpolate,
  staticFile,
} from "remotion";
import { type ResolvedClip, CROSSFADE_FRAMES } from "./types";

interface AvatarClipSequenceProps {
  clips: ResolvedClip[];
}

/**
 * Renders avatar clips with OVERLAPPING crossfade transitions.
 *
 * Key design:
 * - Each clip uses its OWN audio (volume=1) for perfect lip sync
 * - NO master audio track — HeyGen bakes lip-synced audio into each clip
 * - Clips OVERLAP by CROSSFADE_FRAMES — clip N+1 starts before clip N ends
 * - During overlap: outgoing clip fades 1→0, incoming clip fades 0→1
 * - At midpoint of crossfade, combined opacity = ~1 (no black flash)
 */
export const AvatarClipSequence: React.FC<AvatarClipSequenceProps> = ({
  clips,
}) => {
  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        if (!clip.videoFile) return null;

        // startSec already accounts for overlap (set by orchestrator)
        const startFrame = Math.round(clip.startSec * 30);
        const durationFrames = Math.round(clip.durationSec * 30);

        return (
          <Sequence
            key={`clip-${i}`}
            from={startFrame}
            durationInFrames={durationFrames}
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

const ClipRenderer: React.FC<ClipRendererProps> = ({
  clip,
  clipIndex,
  totalClips,
  durationFrames,
}) => {
  const localFrame = useCurrentFrame();

  // Fade in from 0→1 over CROSSFADE_FRAMES (not on first clip)
  const fadeIn = clipIndex > 0
    ? interpolate(localFrame, [0, CROSSFADE_FRAMES], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  // Fade out from 1→0 over CROSSFADE_FRAMES at end (not on last clip)
  const fadeOut = clipIndex < totalClips - 1
    ? interpolate(
        localFrame,
        [durationFrames - CROSSFADE_FRAMES, durationFrames],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;

  const opacity = Math.min(fadeIn, fadeOut);

  // During fade-in, mute this clip's audio (outgoing clip still plays)
  // During fade-out, keep audio playing (incoming clip is still muting)
  const audioVolume = clipIndex > 0
    ? interpolate(localFrame, [0, CROSSFADE_FRAMES], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={staticFile(clip.videoFile!)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        volume={audioVolume}
      />
    </AbsoluteFill>
  );
};
