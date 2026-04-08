import React from "react";
import { AbsoluteFill } from "remotion";

interface BrandWatermarkProps {
  accentColor: string;
}

export const BrandWatermark: React.FC<BrandWatermarkProps> = ({
  accentColor,
}) => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "flex-end",
        padding: 40,
      }}
    >
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: 14,
          color: "#FFFFFF",
          opacity: 0.3,
        }}
      >
        @thesecretmomstribe
      </div>
    </AbsoluteFill>
  );
};
