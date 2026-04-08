import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from "remotion";
import { type ResolvedClip, CROSSFADE_FRAMES } from "./types";

interface SplitScreenProps {
  clip: ResolvedClip;
}

export const SplitScreen: React.FC<SplitScreenProps> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const startFrame = Math.round(clip.startSec * fps);
  const durationFrames = Math.round(clip.durationSec * fps);
  const localFrame = frame - startFrame;

  if (localFrame < 0 || localFrame >= durationFrames) return null;

  const fadeIn = interpolate(localFrame, [0, CROSSFADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    localFrame,
    [durationFrames - CROSSFADE_FRAMES, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const isVideo = clip.visualType === "pexels_video";

  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
        {clip.visualFile && isVideo ? (
          <OffthreadVideo
            src={staticFile(clip.visualFile)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : clip.visualFile ? (
          <Img
            src={staticFile(clip.visualFile)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>

      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
        {clip.videoFile && (
          <OffthreadVideo
            src={staticFile(clip.videoFile)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            volume={0}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
