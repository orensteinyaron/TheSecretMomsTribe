/**
 * Per-clip silence trimmer.
 *
 * Background: Seedance occasionally bakes 2+ seconds of dead air at the
 * head or tail of a generated clip (most often the tail of an emphatic short
 * line — see piece 5ffc20c1 SCENE_3, which had 2.32s of trailing silence).
 * The stitcher used to crossfade this dead air straight into the final mp4,
 * producing a "did the video freeze?" moment in the middle of the timeline.
 *
 * This module trims those gaps before stitching, but is *sensitive to
 * intentional pauses*: the user's spec says "we should be sensitive if that
 * was intentional". Concretely, we only trim above thresholds that real
 * speech beats never cross.
 *
 * Defaults (tunable via TrimOptions):
 *   - lead silence > 0.5s  → trim, leave 0.15s of lead (snappy starts)
 *   - tail silence > 1.0s  → trim, leave 0.40s of tail (preserves a beat)
 *   - silence floor: -40 dB, min 0.30s (ffmpeg silencedetect defaults)
 *
 * The thresholds are *trigger gates*, not hair-trigger trims: a clip with
 * 0.6s of trailing breath gets left alone (under 1.0s); a clip with 2.3s of
 * dead air gets trimmed to 0.4s of tail.
 *
 * Usage as CLI:
 *   npx tsx scripts/trim-clip-silence.ts <input.mp4> <output.mp4>
 *   npx tsx scripts/trim-clip-silence.ts <input.mp4> <output.mp4> \
 *     --lead-threshold 0.5 --lead-keep 0.15 \
 *     --tail-threshold 1.0 --tail-keep 0.4
 *   prints JSON TrimResult to stdout, exits 0 always (no-op trim is success)
 *
 * Usage as library:
 *   import { trimClipSilence } from "./trim-clip-silence";
 *   const r = await trimClipSilence(inPath, outPath);
 *   // r.applied tells you whether any trim happened
 */

import fs from "fs";
import { execFileSync, spawnSync } from "child_process";

export interface TrimOptions {
  /** Trim leading silence if it's longer than this (seconds). */
  leadThresholdSec?: number;
  /** When trimming lead, leave this much silence at the start (seconds). */
  leadKeepSec?: number;
  /** Trim trailing silence if it's longer than this (seconds). */
  tailThresholdSec?: number;
  /** When trimming tail, leave this much silence at the end (seconds). */
  tailKeepSec?: number;
  /** dB floor for silencedetect. Below this is treated as silence. */
  silenceDb?: number;
  /** Minimum silence-run length silencedetect cares about (seconds). */
  silenceMinSec?: number;
}

const DEFAULTS: Required<TrimOptions> = {
  leadThresholdSec: 0.5,
  leadKeepSec: 0.15,
  tailThresholdSec: 1.0,
  tailKeepSec: 0.4,
  silenceDb: -40,
  silenceMinSec: 0.3,
};

export interface TrimResult {
  inputPath: string;
  outputPath: string;
  origDurationSec: number;
  newDurationSec: number;
  leadSilenceDetectedSec: number;
  tailSilenceDetectedSec: number;
  leadTrimmedSec: number;
  tailTrimmedSec: number;
  applied: boolean;
  reason: string;
}

function probeDurationSec(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  ).trim();
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe bad duration for ${filePath}: ${out}`);
  return d;
}

interface SilenceRun {
  startSec: number;
  endSec: number;
}

/**
 * Run ffmpeg silencedetect and parse the runs from stderr.
 *
 * silencedetect emits lines like:
 *   [silencedetect @ 0x...] silence_start: 18.5
 *   [silencedetect @ 0x...] silence_end: 20.82 | silence_duration: 2.32
 *
 * If the clip ends in silence, the last run has no silence_end line — we
 * close it ourselves at the clip's total duration.
 */
function detectSilenceRuns(filePath: string, durationSec: number, dB: number, minSec: number): SilenceRun[] {
  // silencedetect writes to stderr; spawnSync lets us capture it.
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-af", `silencedetect=noise=${dB}dB:d=${minSec}`,
      "-f", "null", "-",
    ],
    { encoding: "utf-8" },
  );
  const text: string = r.stderr || "";
  const runs: SilenceRun[] = [];
  let openStart: number | null = null;
  for (const line of text.split("\n")) {
    const ms = line.match(/silence_start:\s*(-?[\d.]+)/);
    const me = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (ms) openStart = parseFloat(ms[1]);
    if (me && openStart !== null) {
      runs.push({ startSec: openStart, endSec: parseFloat(me[1]) });
      openStart = null;
    }
  }
  if (openStart !== null) {
    runs.push({ startSec: openStart, endSec: durationSec });
  }
  return runs;
}

/**
 * Re-encode a clip with start offset and duration. We avoid `-c copy` because
 * cut points may not align to keyframes, which leaves audio out of sync. Each
 * clip is small (~3-15s) so the re-encode overhead is negligible.
 */
function trimReencode(input: string, output: string, startSec: number, durationSec: number): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss", startSec.toFixed(3),
      "-i", input,
      "-t", durationSec.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      output,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(output)) throw new Error(`trim produced no file: ${output}`);
}

export async function trimClipSilence(
  inputPath: string,
  outputPath: string,
  opts: TrimOptions = {},
): Promise<TrimResult> {
  const o = { ...DEFAULTS, ...opts };

  if (!fs.existsSync(inputPath)) throw new Error(`input not found: ${inputPath}`);
  const origDurationSec = probeDurationSec(inputPath);

  const runs = detectSilenceRuns(inputPath, origDurationSec, o.silenceDb, o.silenceMinSec);

  // Lead silence: a run that starts at (or essentially at) 0.
  const leadRun = runs.find((r) => r.startSec < 0.05);
  const leadSilenceDetectedSec = leadRun ? leadRun.endSec - leadRun.startSec : 0;

  // Tail silence: a run that ends at (or essentially at) the clip end.
  const tailRun = [...runs].reverse().find((r) => r.endSec >= origDurationSec - 0.05);
  const tailSilenceDetectedSec = tailRun ? tailRun.endSec - tailRun.startSec : 0;

  const trimLead = leadSilenceDetectedSec > o.leadThresholdSec;
  const trimTail = tailSilenceDetectedSec > o.tailThresholdSec;

  if (!trimLead && !trimTail) {
    // No-op: copy file (cheap link if same fs, fallback to copy).
    if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
    return {
      inputPath,
      outputPath,
      origDurationSec,
      newDurationSec: origDurationSec,
      leadSilenceDetectedSec,
      tailSilenceDetectedSec,
      leadTrimmedSec: 0,
      tailTrimmedSec: 0,
      applied: false,
      reason: `lead=${leadSilenceDetectedSec.toFixed(2)}s (threshold ${o.leadThresholdSec}s), tail=${tailSilenceDetectedSec.toFixed(2)}s (threshold ${o.tailThresholdSec}s) — no trim needed`,
    };
  }

  // Compute the new window into the original clip.
  // Lead: shift start forward by (leadDetected - leadKeep). If !trimLead, start at 0.
  // Tail: end at (origEnd - (tailDetected - tailKeep)). If !trimTail, end at origEnd.
  const newStart = trimLead ? Math.max(0, leadSilenceDetectedSec - o.leadKeepSec) : 0;
  const tailCut = trimTail ? Math.max(0, tailSilenceDetectedSec - o.tailKeepSec) : 0;
  const newEnd = origDurationSec - tailCut;
  const newDurationSec = newEnd - newStart;

  if (newDurationSec <= 0.5) {
    throw new Error(
      `trim would leave ${newDurationSec.toFixed(2)}s of clip — refusing. ` +
      `Source likely all silence: ${inputPath}`,
    );
  }

  trimReencode(inputPath, outputPath, newStart, newDurationSec);

  return {
    inputPath,
    outputPath,
    origDurationSec,
    newDurationSec: Number(newDurationSec.toFixed(3)),
    leadSilenceDetectedSec: Number(leadSilenceDetectedSec.toFixed(3)),
    tailSilenceDetectedSec: Number(tailSilenceDetectedSec.toFixed(3)),
    leadTrimmedSec: Number(newStart.toFixed(3)),
    tailTrimmedSec: Number(tailCut.toFixed(3)),
    applied: true,
    reason: [
      trimLead ? `lead ${leadSilenceDetectedSec.toFixed(2)}s>${o.leadThresholdSec}s → kept ${o.leadKeepSec}s` : null,
      trimTail ? `tail ${tailSilenceDetectedSec.toFixed(2)}s>${o.tailThresholdSec}s → kept ${o.tailKeepSec}s` : null,
    ].filter(Boolean).join("; "),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const input = args[0];
  const output = args[1];
  if (!input || !output) {
    console.error("Usage: npx tsx scripts/trim-clip-silence.ts <input.mp4> <output.mp4> [--lead-threshold N] [--lead-keep N] [--tail-threshold N] [--tail-keep N]");
    process.exit(2);
  }
  const opts: TrimOptions = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--lead-threshold") opts.leadThresholdSec = parseFloat(args[++i]);
    else if (args[i] === "--lead-keep") opts.leadKeepSec = parseFloat(args[++i]);
    else if (args[i] === "--tail-threshold") opts.tailThresholdSec = parseFloat(args[++i]);
    else if (args[i] === "--tail-keep") opts.tailKeepSec = parseFloat(args[++i]);
    else if (args[i] === "--silence-db") opts.silenceDb = parseFloat(args[++i]);
    else if (args[i] === "--silence-min") opts.silenceMinSec = parseFloat(args[++i]);
  }
  trimClipSilence(input, output, opts)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(`[fatal] ${(e as Error).message}`);
      process.exit(1);
    });
}
