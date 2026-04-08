import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
} from "remotion";
import { CTA_OVERLAY_FRAMES } from "./types";
import { TEXT_SHADOW } from "../v2/types";

interface CTAOverlayProps {
  text: string;
  totalFrames: number;
}

export const CTAOverlay: React.FC<CTAOverlayProps> = ({ text, totalFrames }) => {
  const frame = useCurrentFrame();
  const ctaStart = totalFrames - CTA_OVERLAY_FRAMES;

  if (frame < ctaStart) return null;

  const localFrame = frame - ctaStart;
  const opacity = interpolate(localFrame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 200,
        opacity,
      }}
    >
      <div
        style={{
          color: "#FFFFFF",
          fontFamily: "Georgia, serif",
          fontWeight: 700,
          fontSize: 44,
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
