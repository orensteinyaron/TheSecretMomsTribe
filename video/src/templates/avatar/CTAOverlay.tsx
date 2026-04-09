import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { CTA_OVERLAY_FRAMES } from "./types";

const { fontFamily: interFont } = loadFont();

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
          fontFamily: interFont,
          fontWeight: 700,
          fontSize: 40,
          textAlign: "center",
          textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)",
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
