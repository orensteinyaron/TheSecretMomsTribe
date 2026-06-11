import React from "react";
import { AbsoluteFill, Img } from "remotion";

import { SMTHookOverlay } from "../shared/SMTHookOverlay";

// Static thumbnail/title card: a still background + the canonical
// SMTHookOverlay band (BRAND_PURPLE #63246a, Helvetica Neue 900, lower-third,
// -2deg). Matches the established avatar-thumbnail look exactly (the grid
// thumbnails are video first-frames carrying this same overlay). Render one
// frame inside the overlay's visible window (t in [0,1s)).
export type ThumbnailCardProps = {
  image_url: string;
  primary: string;
  secondary?: string;
};

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({ image_url, primary, secondary }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Img src={image_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <SMTHookOverlay primary={primary} secondary={secondary} durationSec={9999} />
    </AbsoluteFill>
  );
};
