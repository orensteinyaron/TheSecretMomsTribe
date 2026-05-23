// Transitions manifest builder for Avatar Full v5.
//
// Pure function: per-clip endpoint face metrics in → per-cut motion-blur
// gate + per-clip crop_offset_y out. Drives the Remotion composition.
//
// Per YAR-129 v5 spec:
//   - Position drift between clips is handled at composition time, not at
//     generation time (the chain pattern is architecturally incompatible
//     with Seedance's audio role — Finding 1).
//   - Hard cuts are the default; motion blur fires only when the eye-line
//     or face-center delta crosses the threshold.
//   - Defaults are first-pass values (40 px / 8 %) — tunable after the
//     first real render. The fields are exported so the orchestrator
//     can log thresholds alongside the manifest.

export type Endpoint = {
  eye_y: number;
  face_x: number;
};

export type ClipMetrics = {
  clip_id: string;
  start: Endpoint;
  end: Endpoint;
};

export type TransitionEntry = {
  cut_index: number;
  from_clip_id: string;
  to_clip_id: string;
  eye_line_delta_px: number;
  face_center_delta_pct: number;
  needs_motion_blur: boolean;
};

export type CropEntry = {
  clip_id: string;
  crop_offset_y: number;
};

export type TransitionsManifest = {
  transitions: TransitionEntry[];
  crops: CropEntry[];
  median_start_eye_y: number;
};

export type Thresholds = {
  eye_line_delta_px: number;
  face_center_delta_pct: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  eye_line_delta_px: 40,
  face_center_delta_pct: 0.08,
};

export type BuildTransitionsManifestOpts = {
  clips: ClipMetrics[];
  /** Pixel width of the composed video (1080 for 9:16 Avatar Full). */
  frame_width: number;
  thresholds?: Thresholds;
};

export function buildTransitionsManifest(opts: BuildTransitionsManifestOpts): TransitionsManifest {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;

  if (opts.clips.length === 0) {
    return { transitions: [], crops: [], median_start_eye_y: 0 };
  }

  const transitions: TransitionEntry[] = [];
  for (let i = 0; i < opts.clips.length - 1; i++) {
    const a = opts.clips[i];
    const b = opts.clips[i + 1];
    const eye_line_delta_px = Math.abs(a.end.eye_y - b.start.eye_y);
    const face_center_delta_pct = Math.abs(a.end.face_x - b.start.face_x) / opts.frame_width;
    transitions.push({
      cut_index: i,
      from_clip_id: a.clip_id,
      to_clip_id: b.clip_id,
      eye_line_delta_px,
      face_center_delta_pct,
      needs_motion_blur:
        eye_line_delta_px > thresholds.eye_line_delta_px ||
        face_center_delta_pct > thresholds.face_center_delta_pct,
    });
  }

  // Upper-median tie-break gives deterministic offsets when N is even.
  const sorted = opts.clips.map((c) => c.start.eye_y).sort((x, y) => x - y);
  const median_start_eye_y = sorted[Math.floor(sorted.length / 2)];

  const crops: CropEntry[] = opts.clips.map((c) => ({
    clip_id: c.clip_id,
    crop_offset_y: median_start_eye_y - c.start.eye_y,
  }));

  return { transitions, crops, median_start_eye_y };
}
