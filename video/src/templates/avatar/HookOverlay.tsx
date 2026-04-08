import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { HOOK_OVERLAY_FRAMES } from "./types";
import { TEXT_SHADOW } from "../v2/types";

interface HookOverlayProps {
  text: string;
}

export const HookOverlay: React.FC<HookOverlayProps> = ({ text }) => {
  const frame = useCurrentFrame();

  if (frame >= HOOK_OVERLAY_FRAMES) return null;

  const opacity = interpolate(
    frame,
    [0, 10, HOOK_OVERLAY_FRAMES - 15, HOOK_OVERLAY_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const scale = interpolate(frame, [0, 15], [0.95, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          color: "#FFFFFF",
          fontFamily: "Georgia, serif",
          fontWeight: 800,
          fontSize: 52,
          textAlign: "center",
          textShadow: TEXT_SHADOW,
          padding: "0 80px",
          lineHeight: 1.3,
          maxWidth: 900,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
