// Avatar Full v5 orchestrator state.
//
// The orchestrator is hybrid (Claude Code session + Node helpers) — see
// docs/specs/AVATAR_FULL_V5.md. The session interleaves MCP Seedance calls
// with calls to `render-avatar-full-v5.ts --phase=<name>`. State flows
// between phases via a single JSON file in workdir/v5-state.json so each
// phase invocation can read what predecessor phases produced.
//
// All paths are absolute. URLs are http(s) (Supabase or Higgsfield CDN).

import fs from "node:fs";
import path from "node:path";

export type V5ClipState = {
  /** Stable id from avatar_config.clips[].id (e.g. "SCENE_01"). */
  id: string;
  /** Verbatim script from avatar_config.clips[].expected_script. */
  expected_script: string;
  /** Target duration from avatar_config (used for prompt + Seedance request). */
  duration_target_s: number;

  // ── Phase: tts ──
  mp3_local_path?: string;
  mp3_public_url?: string;

  // ── Phase: verify (set after the session runs MCP generate_video) ──
  seedance_job_id?: string;
  seedance_video_url?: string;
  seedance_cost_credits?: number;
  seedance_cost_usd?: number;
  whisper_transcript?: string;
  whisper_duration_s?: number;
  whisper_wer?: number;
  whisper_speech_coverage?: number;
  verify_status?: "PASS" | "FAIL_WER" | "FAIL_COVERAGE";
  verify_mode_used?: "std" | "fast";
  verify_attempts?: number;
  surfaced_for_human?: boolean;
};

export type FaceMetricsEndpoint = {
  eye_y: number;
  face_x: number;
  face_w: number;
  face_h: number;
  img_w: number;
  img_h: number;
};

export type V5State = {
  content_id: string;
  workdir: string;
  hook_text: string;
  register: string;
  clips: V5ClipState[];
  // Per-clip face metrics (start + end frame), populated by --phase=face-metrics.
  face_metrics?: Record<string, { start?: FaceMetricsEndpoint; end?: FaceMetricsEndpoint; errors?: string[] }>;
  // Populated by --phase=manifest.
  transitions_manifest?: {
    transitions: Array<{
      cut_index: number; from_clip_id: string; to_clip_id: string;
      eye_line_delta_px: number; face_center_delta_pct: number;
      needs_motion_blur: boolean; bridge_enabled: boolean;
    }>;
    crops: Array<{ clip_id: string; crop_offset_y: number }>;
    median_start_eye_y: number;
  };
  // Populated by --phase=compose.
  final_local_path?: string;
  // Populated by --phase=upload.
  final_public_url?: string;
  // Populated by --phase=qa.
  qa_report_id?: string;
  qa_verdict?: string;
  // Cumulative cost across all phases for the cost-ceiling check.
  total_higgsfield_credits?: number;
  total_usd?: number;
};

export function statePath(workdir: string): string {
  return path.join(workdir, "v5-state.json");
}

export function loadState(workdir: string): V5State {
  const p = statePath(workdir);
  if (!fs.existsSync(p)) throw new Error(`v5-state.json not found at ${p}. Run --phase=init first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as V5State;
}

export function saveState(state: V5State): void {
  fs.mkdirSync(state.workdir, { recursive: true });
  fs.writeFileSync(statePath(state.workdir), JSON.stringify(state, null, 2));
}

export function initState(opts: {
  content_id: string;
  workdir: string;
  hook_text: string;
  register: string;
  clips: Array<{ id: string; expected_script: string; duration_target_s: number }>;
}): V5State {
  return {
    content_id: opts.content_id,
    workdir: opts.workdir,
    hook_text: opts.hook_text,
    register: opts.register,
    clips: opts.clips.map((c) => ({
      id: c.id,
      expected_script: c.expected_script,
      duration_target_s: c.duration_target_s,
    })),
    total_higgsfield_credits: 0,
    total_usd: 0,
  };
}
