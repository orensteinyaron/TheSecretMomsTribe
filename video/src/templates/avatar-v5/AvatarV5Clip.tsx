import React from "react";
import { OffthreadVideo, useCurrentFrame } from "remotion";
import { MOTION_BLUR_FRAMES, type V5Clip } from "./types";

// Per-clip subcomponent. Two responsibilities:
//   1. Render the Seedance MP4 via OffthreadVideo so the embedded audio
//      passes through untouched (YAR-129 Finding 4).
//   2. Apply a brief CSS blur on the first/last MOTION_BLUR_FRAMES when
//      the orchestrator flagged this clip's incoming or outgoing cut as
//      drifty enough to need it (eye-line > 40 px or face-center > 8 %).
//
// crop_offset_y is INFORMATIONAL only — the transitions manifest still
// computes per-clip offsets and the summary phase surfaces them as
// telemetry, but we do NOT apply them as a vertical translate here.
// Why: a 1080×1920 OffthreadVideo with objectFit:"cover" exactly fills
// the 1080×1920 container with no excess margin; translating it down by
// crop_offset_y exposes black at the top (and loses content at the
// bottom), making frame drift WORSE rather than better. Position drift
// between clips is now purely Seedance's problem, mitigated via motion
// blur on cuts where eye_line_delta exceeds threshold.
//
// The blur is isotropic (CSS filter:blur takes one radius). The spec
// describes it as "horizontal motion blur" but the visual goal is just
// to soften the snap at high-drift cuts. Anisotropic blur via SVG filter
// is a v5.1 polish item if needed.

// Audio cross-fade is NOT done here. A Remotion `volume` callback is evaluated
// per-FRAME (piecewise-constant within each frame), so a fast fade steps at
// every frame boundary → a small click at each step. Instead, a sample-accurate
// `afade` is baked into each clip's audio in `normalize-clips.ts`, and the
// 4-frame Sequence overlap cross-fades those pre-faded edges. So OffthreadVideo
// here is a pure passthrough (Finding 4) — no `volume`, no `<Audio>`.

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

export const AvatarV5Clip: React.FC<Props> = ({
  clip,
  blur_in_frames,
  blur_out_frames,
  duration_in_frames,
}) => {
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
        // Pure embedded-audio passthrough (Finding 4). Edge cross-fades are
        // baked into the clip audio upstream (normalize-clips afade), so no
        // per-frame `volume` envelope is needed here (and would click).
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // NO translateY — see docstring above. crop_offset_y stays in
          // the V5Clip type for summary telemetry but is not applied here.
          filter: blur > 0 ? `blur(${blur.toFixed(2)}px)` : undefined,
        }}
      />
    </div>
  );
};

// Re-export for tests / orchestrator.
export { MOTION_BLUR_FRAMES };
