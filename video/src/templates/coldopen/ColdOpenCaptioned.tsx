import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";

import type { Phrase } from "../../../lib/phrase-grouper";
import { AvatarV5Captions } from "../avatar-v5/AvatarV5Captions";

// Cold-open caption pass. Renders a prepended source clip (e.g. a podcast
// reaction clip) as a full-bleed OffthreadVideo background with the SAME
// AvatarV5Captions component the main reel uses — so the cold open's
// subtitles are pixel-identical to the rest of the piece (white Inter Bold
// 52px UPPERCASE, bottom-third, minimal shadow, 3-frame per-phrase fades).
//
// Audio is the clip's own embedded track, passed through untouched
// (Finding 4: no `volume`, no separate <Audio>). Level-matching to the
// reel is done upstream in ffmpeg (loudnorm), not here.

export type ColdOpenCaptionedProps = {
  video_url: string;
  phrases: Phrase[];
};

export const ColdOpenCaptioned: React.FC<ColdOpenCaptionedProps> = ({ video_url, phrases }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <OffthreadVideo
        src={video_url}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <AvatarV5Captions phrases={phrases} />
    </AbsoluteFill>
  );
};
