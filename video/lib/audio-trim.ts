// Silence-trim helper for the Avatar Full v5 duration guardrails.
//
// WHY THIS EXISTS
// ---------------
// phaseTts measures each per-clip MP3's REAL spoken length (ffprobe). A clip
// that lands just over the per-clip budget (≤ TRIM_TOLERANCE_S over, per
// `needsSilenceTrim`) is usually carrying leading/trailing silence rather
// than too many words. Rather than re-split the script (expensive, changes
// clip count post-TTS), we strip that silence so the audio fits at natural
// speed — Seedance then never has to cram/speed-up the voice.
//
// The ffmpeg spawn AND the duration-measure are INJECTED so this module is
// unit-testable without shelling out. Production wiring (see phaseTts) passes
// the real `execFileSync`-based spawn and `probeDurationSeconds`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { probeDurationSeconds } from "./qa-helpers.js";

/**
 * Spawn a process synchronously, matching the `execFileSync` shape used by
 * the other ffmpeg helpers in qa-helpers.ts. Injectable for tests.
 */
export type SpawnSync = (file: string, args: string[]) => void;

/** Measure an audio file's duration in seconds. Injectable for tests. */
export type MeasureDuration = (filePath: string) => number;

/**
 * ffmpeg `silenceremove` filter: strip leading + trailing silence with a
 * gentle threshold (~-40dB), preserving inter-word pauses inside speech.
 *
 *   - start_periods=1 / start_threshold=-40dB → drop leading silence.
 *   - stop_periods=-1 / stop_threshold=-40dB  → drop ALL trailing silence
 *     runs (the -1 makes it re-scan from the end).
 *   - start_silence / stop_silence keep a small 0.05s cushion so the first
 *     and last phonemes aren't clipped.
 */
const SILENCEREMOVE_FILTER =
  "silenceremove=" +
  "start_periods=1:start_silence=0.05:start_threshold=-40dB:" +
  "stop_periods=-1:stop_silence=0.05:stop_threshold=-40dB";

const defaultSpawn: SpawnSync = (file, args) => {
  execFileSync(file, args, { stdio: ["pipe", "pipe", "pipe"] });
};

export type TrimSilenceDeps = {
  /** Process spawner. Defaults to real ffmpeg via execFileSync. */
  spawn?: SpawnSync;
  /** Duration measurer. Defaults to ffprobe via probeDurationSeconds. */
  measure?: MeasureDuration;
};

/**
 * Strip leading + trailing silence from `mp3Path` in place and return the
 * RE-MEASURED duration (seconds) of the trimmed file.
 *
 * Writes to a sibling temp file, then replaces the original (ffmpeg cannot
 * read and write the same path in one pass). `targetMaxS` is advisory — the
 * filter trims whatever silence it finds; the caller re-classifies the
 * returned duration. We do NOT speed up or otherwise cram audio here.
 *
 * @returns the measured duration of the trimmed file.
 */
export function trimSilenceToFit(
  mp3Path: string,
  targetMaxS: number,
  deps: TrimSilenceDeps = {},
): number {
  const spawn = deps.spawn ?? defaultSpawn;
  const measure = deps.measure ?? probeDurationSeconds;

  const dir = path.dirname(mp3Path);
  const base = path.basename(mp3Path, path.extname(mp3Path));
  const tmpPath = path.join(dir, `${base}.trimmed${path.extname(mp3Path)}`);

  spawn("ffmpeg", [
    "-y",
    "-i", mp3Path,
    "-af", SILENCEREMOVE_FILTER,
    tmpPath,
  ]);

  // Replace the original with the trimmed file.
  fs.renameSync(tmpPath, mp3Path);

  return measure(mp3Path);
}
