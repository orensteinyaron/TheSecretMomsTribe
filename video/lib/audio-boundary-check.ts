/**
 * Audio-boundary QA — detects splice discontinuities ("clicks") at clip cuts in
 * the composed Avatar Full v5 render.
 *
 * Root cause this guards against (2026-06-10, YAR-153): the v5 audio transition
 * was a 4-frame Sequence overlap with NO volume envelope, so a cut hard-spliced
 * two independently-encoded Seedance audio tracks → a sample-step discontinuity
 * in the inter-sentence gap, heard as a click. The fix is the baked afade
 * cross-fade in normalize-clips; THIS check is the regression gate.
 *
 * The metric: max sample-to-sample jump at the cut, but ONLY counted where the
 * LOCAL energy is low (a quiet/faded region). A genuine splice click is a step
 * in the near-silent gap between sentences. Normal speech has large
 * sample-to-sample slopes too (a 0.1-amplitude tone steps ~0.02/sample), so an
 * un-gated jump threshold false-positives whenever speech sits near the cut
 * (e.g. after tail-trim). Gating by local RMS distinguishes "click in the gap"
 * (flag) from "speech slope near the cut" (ignore).
 *
 * Trailing transients (a Seedance mouth-click/breath AFTER the last word) are a
 * different failure mode, prevented structurally by the silence-aware tail-trim
 * in normalize-clips (see lib/tail-trim.ts) rather than detected here.
 *
 * Pure + transport-free so it is unit-testable; the caller supplies decoded mono
 * PCM (Float32, normalized [-1,1]) and the cut timestamps.
 */

export interface BoundaryDiscontinuity {
  cut_label: string;
  cut_time_s: number;
  max_quiet_jump: number;
  ok: boolean;
}

export interface AudioBoundaryReport {
  threshold: number;
  boundaries: BoundaryDiscontinuity[];
  verdict: "PASS" | "FAIL";
  failures: BoundaryDiscontinuity[];
}

/** A step this large in a QUIET region is a click. Clean cuts measure ~0. */
export const AUDIO_BOUNDARY_JUMP_THRESHOLD = 0.01;
/** Half-window (s) searched each side of a cut. */
export const AUDIO_BOUNDARY_WINDOW_S = 0.015;
/** Local RMS below this = "quiet" → a jump here is anomalous (a splice click).
 *  Above it = speech, where large slopes are normal and expected. */
export const AUDIO_BOUNDARY_QUIET_RMS = 0.02;

function windowRms(pcm: Float32Array, center: number, halfLen: number): number {
  const lo = Math.max(0, center - halfLen);
  const hi = Math.min(pcm.length, center + halfLen);
  let s = 0;
  let n = 0;
  for (let i = lo; i < hi; i++, n++) s += pcm[i] * pcm[i];
  return n > 0 ? Math.sqrt(s / n) : 0;
}

/**
 * Max |x[i+1]-x[i]| within `windowS` of `centerS`, counting ONLY samples whose
 * local RMS (±`ctxS`) is below `quietRms` — i.e. steps in the quiet gap, not
 * speech slopes.
 */
export function maxQuietJump(
  pcm: Float32Array,
  sampleRate: number,
  centerS: number,
  windowS: number = AUDIO_BOUNDARY_WINDOW_S,
  quietRms: number = AUDIO_BOUNDARY_QUIET_RMS,
): number {
  const c = Math.round(centerS * sampleRate);
  const w = Math.round(windowS * sampleRate);
  const ctx = Math.round(0.01 * sampleRate); // ±10 ms local-energy window
  const lo = Math.max(1, c - w);
  const hi = Math.min(pcm.length - 1, c + w);
  let m = 0;
  for (let i = lo; i < hi; i++) {
    const d = Math.abs(pcm[i + 1] - pcm[i]);
    if (d <= m) continue;
    if (windowRms(pcm, i, ctx) < quietRms) m = d;
  }
  return m;
}

/** Check every cut for a splice step in its quiet gap. `cuts` are absolute
 *  start-times (s) of clips 1..N (one per transition). */
export function checkAudioBoundaries(
  pcm: Float32Array,
  sampleRate: number,
  cuts: { label: string; time_s: number }[],
  threshold: number = AUDIO_BOUNDARY_JUMP_THRESHOLD,
): AudioBoundaryReport {
  const boundaries: BoundaryDiscontinuity[] = cuts.map((cut) => {
    const max_quiet_jump = maxQuietJump(pcm, sampleRate, cut.time_s);
    return { cut_label: cut.label, cut_time_s: cut.time_s, max_quiet_jump, ok: max_quiet_jump <= threshold };
  });
  const failures = boundaries.filter((b) => !b.ok);
  return {
    threshold,
    boundaries,
    verdict: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  };
}
