import React from "react";
import { OffthreadVideo, useCurrentFrame } from "remotion";
import { MOTION_BLUR_FRAMES, type V5Clip } from "./types";

// Per-clip subcomponent. Three responsibilities:
//   1. Render the Seedance MP4 via OffthreadVideo so the embedded audio
//      passes through untouched (YAR-129 Finding 4).
//   2. Apply crop_offset_y as a vertical translate so the face sits at the
//      median eye-line across clips (transitions-manifest output).
//   3. Apply a brief CSS blur on the first/last MOTION_BLUR_FRAMES when
//      the orchestrator flagged this clip's incoming or outgoing cut as
//      drifty enough to need it (eye-line > 40 px or face-center > 8 %).
//
// The blur is isotropic (CSS filter:blur takes one radius). The spec
// describes it as "horizontal motion blur" but the visual goal is just
// to soften the snap at high-drift cuts. Anisotropic blur via SVG filter
// is a v5.1 polish item if needed.

type Props = {
  clip: V5Clip;
  /** Frames of incoming blur ramp (in from MAX → 0). 0 = no incoming blur. */
  blur_in_frames: number;
  /** Frames of outgoing blur ramp (out from 0 → MAX). 0 = no outgoing blur. */
  blur_out_frames: number;
  /** Total frames this Sequence will play; used to time the outgoing blur. */
  duration_in_frames: number;
};

const MAX_BLUR_PX = 12;

export const AvatarV5Clip: React.FC<Props> = ({ clip, blur_in_frames, blur_out_frames, duration_in_frames }) => {
  const frame = useCurrentFrame();
  let blur = 0;
  if (blur_in_frames > 0 && frame < blur_in_frames) {
    // Ramp from MAX_BLUR_PX at frame 0 → 0 at blur_in_frames.
    blur = MAX_BLUR_PX * (1 - frame / blur_in_frames);
  } else if (blur_out_frames > 0 && frame > duration_in_frames - blur_out_frames - 1) {
    // Ramp from 0 at (duration - blur_out_frames) → MAX_BLUR_PX at the end.
    const into = frame - (duration_in_frames - blur_out_frames);
    blur = MAX_BLUR_PX * (into / blur_out_frames);
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <OffthreadVideo
        src={clip.video_url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translateY(${clip.crop_offset_y}px)`,
          filter: blur > 0 ? `blur(${blur.toFixed(2)}px)` : undefined,
        }}
      />
    </div>
  );
};

// Re-export for tests / orchestrator.
export { MOTION_BLUR_FRAMES };
