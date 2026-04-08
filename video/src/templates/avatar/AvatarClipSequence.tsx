import React from "react";
import {
  AbsoluteFill,
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

export const AvatarClipSequence: React.FC<AvatarClipSequenceProps> = ({
  clips,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const activeIdx = clips.findIndex(
    (c) => currentSec >= c.startSec && currentSec < c.startSec + c.durationSec,
  );

  if (activeIdx === -1) return null;

  const renderClip = (clip: ResolvedClip, opacity: number) => {
    if (!clip.videoFile || opacity <= 0) return null;
    return (
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={staticFile(clip.videoFile)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          volume={0}
        />
      </AbsoluteFill>
    );
  };

  const activeClip = clips[activeIdx];
  const activeStartFrame = Math.round(activeClip.startSec * fps);
  const localFrame = frame - activeStartFrame;

  const fadeIn = activeIdx > 0
    ? interpolate(localFrame, [0, CROSSFADE_FRAMES], [0, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      })
    : 1;

  const prevClip = activeIdx > 0 ? clips[activeIdx - 1] : null;
  const prevOpacity = prevClip ? (1 - fadeIn) : 0;

  return (
    <>
      {prevClip && renderClip(prevClip, prevOpacity)}
      {renderClip(activeClip, fadeIn)}
    </>
  );
};
