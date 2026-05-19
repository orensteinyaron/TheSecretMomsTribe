import React from "react";
import { AbsoluteFill } from "remotion";

// Hook overlay rendered on top of clip 1 for the full duration of that
// clip. Inter font, white text, deep purple shadow for legibility.
// Brand colors per FACE_OF_SMT spec: deep purple #63246a, mauve pink
// #b74780. We use deep purple for the shadow so the text reads against
// any background.
//
// Note: Inter font is loaded via the existing @remotion/google-fonts
// pipeline at composition mount; we don't import here.

type Props = {
  text: string;
};

export const AvatarV5HookOverlay: React.FC<Props> = ({ text }) => {
  if (!text) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "6%",
          right: "6%",
          textAlign: "center",
          color: "#FFFFFF",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          fontWeight: 800,
          fontSize: 72,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          textShadow: "0 6px 28px rgba(99, 36, 106, 0.85), 0 2px 6px rgba(0,0,0,0.6)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
