import React from "react";
import { AbsoluteFill } from "remotion";

interface BrandFilterProps {
  intensity?: "light" | "normal";
}

export const BrandFilter: React.FC<BrandFilterProps> = ({
  intensity = "normal",
}) => {
  const opacity = intensity === "light" ? 0.03 : 0.08;

  return (
    <AbsoluteFill
      style={{
        background: `rgba(0, 0, 0, ${opacity})`,
        mixBlendMode: "multiply",
        pointerEvents: "none",
      }}
    />
  );
};
