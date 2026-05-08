// Result types for the avatar QA agent (video/scripts/qa-agent-avatar.ts).

export type ClipInput = { id: string; url: string };

export type VisionScore = { score: number; notes: string };

export type ClipVisionResult = {
  identity: VisionScore;
  hair: VisionScore;
  framing: VisionScore;
  background_consistency: VisionScore;
  lighting: VisionScore;
  hard_fails: string[];
  summary: string;
};

// Identity-marker audit runs as its own per-frame call (ref + 1 frame at a time)
// rather than inside ClipVisionResult, because the rubric is symmetric: a feature
// invented in the clip is as wrong as one that's missing from it.
export type IdentityMarkerEntry = { region: string; description: string };

export type IdentityMarkerDisagreement = {
  type: "missing" | "hallucinated" | "drifted";
  region: string;
  detail: string;
};

export type IdentityMarkerFrame = {
  reference_markers: IdentityMarkerEntry[];
  frame_markers: IdentityMarkerEntry[];
  disagreements: IdentityMarkerDisagreement[];
  score: number;
  reasoning: string;
};

export type IdentityMarkerResult = {
  per_frame: (IdentityMarkerFrame | { error: string })[];
  aggregate_score: number;
  reference_markers_summary: IdentityMarkerEntry[];
  all_disagreements: (IdentityMarkerDisagreement & { frame_index: number })[];
};

export type AudioPacingStatus = "OK" | "PACING_ANOMALY" | "LONG_TAIL";

export type AudioPacing = {
  word_count: number;
  speech_duration_s: number;
  clip_duration_s: number;
  wps: number;
  speech_coverage: number;
  status: AudioPacingStatus;
  notes: string;
  transcript: string;
};

export type ClipResult = {
  id: string;
  url: string;
  duration_s: number;
  vision: ClipVisionResult | { error: string };
  markers: IdentityMarkerResult | { error: string };
  audio: AudioPacing | { error: string };
  error?: string;
  frame_paths: string[];
};

export type DriftSeverity = "none" | "minor" | "major" | "hard_fail";

export type DriftDimension = {
  severity: DriftSeverity;
  which_clips: string[];
  notes: string;
};

export type CrossClipDrift = {
  identity_drift: DriftDimension;
  hair_drift: DriftDimension;
  background_drift: DriftDimension;
  framing_drift: DriftDimension;
  overall_verdict: "PASS" | "CONDITIONAL" | "FAIL";
  verdict_reasoning: string;
};
