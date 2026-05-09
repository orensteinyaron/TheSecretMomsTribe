/**
 * Avatar Stitcher v1
 *
 * Concatenate N avatar clips into a single 9:16 mp4 with phrase-based
 * captions and brand watermark, using the existing Remotion
 * AvatarComposition.
 *
 * Usage:
 *   npx tsx scripts/stitch-avatar.ts \
 *     --clips clips.json \
 *     --label "Test 5 v2 — final cut" \
 *     [--script script.txt] \
 *     [--keep-public]
 *
 * clips.json schema (order = narrative order):
 *   [{ "id": "SCENE_1", "url": "https://..." }, ...]
 *
 * Outputs:
 *   /tmp/avatar-stitch-<runId>/final.mp4
 *
 * Reuses:
 *   - runWhisper, findSentenceEndings, buildPhrasesFromWhisper from audio-pipeline.ts
 *   - AvatarComposition, AvatarClipSequence, PhraseCaptions, BrandWatermark from src/templates/
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, spawnSync } from "child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  runWhisper,
  findSentenceEndings,
  buildPhrasesFromWhisper,
  type WhisperWord,
} from "./audio-pipeline.js";
import { trimClipSilence, type TrimResult } from "./trim-clip-silence.js";
import type {
  AvatarCompositionProps,
  ResolvedClip,
} from "../src/templates/avatar/types.js";
import type { PhraseGroup } from "../src/templates/v2/types.js";

// ---- Paths ----

const VIDEO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PUBLIC_ROOT = path.join(VIDEO_ROOT, "public");
const REMOTION_ENTRY = path.join(VIDEO_ROOT, "src", "index.ts");

// ---- Default script (Test 5 v2) ----
// Used for sentence-boundary detection when --script flag is omitted.
// Whisper word-gap fallback handles unknown scripts well enough on its own,
// but passing the original dialogue tightens phrase breaks at sentence ends.
const DEFAULT_SCRIPT = `There is one question that gets my fifteen-year-old talking for twenty minutes straight. And it is not how was school.
I started asking him: what is something that happened today that I would not believe?
That is the whole question. And something about the way it is framed — it is not a report. It is a story.
The first time I tried it I literally had to stop chopping vegetables and just... listen.
Nineteen minutes. Unprompted. I almost cried in the kitchen.
Try it tonight at dinner. Come back and tell me what happened. I really want to know.`;

// ---- Args ----

interface Args {
  clips: string;
  label?: string;
  scriptPath?: string;
  keepPublic: boolean;
  pillar: string;
  hookCardPath?: string;
  hookCardHoldSec: number;
  noTrim: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { clips: "", keepPublic: false, pillar: "parenting_insights", hookCardHoldSec: 2, noTrim: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clips") out.clips = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--script") out.scriptPath = argv[++i];
    else if (a === "--pillar") out.pillar = argv[++i];
    else if (a === "--keep-public") out.keepPublic = true;
    else if (a === "--hook-card") out.hookCardPath = argv[++i];
    else if (a === "--hook-card-hold-sec") out.hookCardHoldSec = parseFloat(argv[++i]);
    else if (a === "--no-trim") out.noTrim = true;
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
  }
  return out;
}

function printUsage() {
  console.error(`Usage: npx tsx scripts/stitch-avatar.ts \\
  --clips <path-to-clips.json> \\
  [--label "Display label"] \\
  [--script <path-to-script.txt>] \\
  [--pillar parenting_insights|ai_magic|mom_health] \\
  [--hook-card <path-to-png>] \\
  [--hook-card-hold-sec 2] \\
  [--no-trim] \\
  [--keep-public]

clips.json schema: [{ "id": "SCENE_1", "url": "https://..." }, ...]
--hook-card prepends a held opening frame from a 1080x1920 PNG. Hard cut
to the first scene; rest of scenes still crossfade with each other.
--no-trim disables per-clip silence trimming (default trims lead >0.5s and
tail >1.0s, preserving 0.15s lead / 0.4s tail).
Requires: ffmpeg, ffprobe, OPENAI_API_KEY (Whisper)`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.clips) { printUsage(); process.exit(1); }
if (!process.env.OPENAI_API_KEY) { console.error("[fatal] OPENAI_API_KEY missing"); process.exit(1); }

assertFfmpeg();

const script = args.scriptPath
  ? fs.readFileSync(args.scriptPath, "utf-8")
  : DEFAULT_SCRIPT;

interface ClipInput { id: string; url: string }
const clips: ClipInput[] = JSON.parse(fs.readFileSync(args.clips, "utf-8"));
if (!Array.isArray(clips) || clips.length === 0) {
  console.error("[fatal] clips.json must be a non-empty array of {id, url}");
  process.exit(1);
}
for (const c of clips) {
  if (!c.id || !c.url) { console.error(`[fatal] each clip needs {id, url}: ${JSON.stringify(c)}`); process.exit(1); }
}

// ---- Setup dirs ----

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const tmpDir = path.join(os.tmpdir(), `avatar-stitch-${runId}`);
const publicSubdir = `avatar-stitch-${runId}`;
const publicDir = path.join(PUBLIC_ROOT, publicSubdir);
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
log(`[setup] tmpDir=${tmpDir}`);
log(`[setup] publicDir=${publicDir}`);

function log(msg: string) { process.stderr.write(`${msg}\n`); }

// ---- Helpers ----

function assertFfmpeg() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (spawnSync("which", [bin], { encoding: "utf-8" }).status !== 0) {
      console.error(`[fatal] ${bin} not on PATH`);
      process.exit(1);
    }
  }
}

async function downloadFile(url: string, dest: string, retries = 3): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`download failed: ${url} :: ${(lastErr as Error)?.message}`);
}

function probeDurationSeconds(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  ).trim();
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe bad duration for ${filePath}: ${out}`);
  return d;
}

// Crossfade-concat N mp4s into a single mp4 in one ffmpeg pass.
// Video uses `xfade` (smooth visual fade), audio uses `acrossfade` (no audio
// pop). Video and audio crossfade in lockstep at clip boundaries.
// Returns the resulting merged duration in seconds.
function concatWithCrossfade(
  mp4Paths: string[],
  durations: number[],
  xfadeSec: number,
  outPath: string,
): number {
  const n = mp4Paths.length;
  if (n < 2) throw new Error("crossfade-concat needs at least 2 clips");
  if (durations.length !== n) throw new Error("durations length mismatch");

  const inputArgs: string[] = [];
  for (const p of mp4Paths) { inputArgs.push("-i", p); }

  // Build video xfade chain: each xfade overlaps the previous merged stream
  // with the next clip by `xfadeSec`. Offset = duration of merged-so-far - xfadeSec.
  const videoFilters: string[] = [];
  let mergedDur = durations[0];
  for (let i = 1; i < n; i++) {
    const offset = (mergedDur - xfadeSec).toFixed(3);
    const inLabel = i === 1 ? "[0:v]" : `[v${i - 1}]`;
    const outLabel = i === n - 1 ? "[vout]" : `[v${i}]`;
    videoFilters.push(`${inLabel}[${i}:v]xfade=transition=fade:duration=${xfadeSec}:offset=${offset}${outLabel}`);
    mergedDur = mergedDur + durations[i] - xfadeSec;
  }

  // Audio acrossfade chain: ffmpeg auto-times each crossfade based on input durations.
  const audioFilters: string[] = [];
  for (let i = 1; i < n; i++) {
    const inLabel = i === 1 ? "[0:a]" : `[a${i - 1}]`;
    const outLabel = i === n - 1 ? "[aout]" : `[a${i}]`;
    audioFilters.push(`${inLabel}[${i}:a]acrossfade=d=${xfadeSec}${outLabel}`);
  }

  const filter = [...videoFilters, ...audioFilters].join(";");
  execFileSync(
    "ffmpeg",
    [
      "-y", ...inputArgs,
      "-filter_complex", filter,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      outPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`crossfade-concat produced no file`);
  return mergedDur;
}

// Extract audio from a video file as mp3 (for Whisper, which is cheaper to
// upload as compressed audio than as full mp4).
function extractAudioMp3(videoPath: string, outMp3: string): void {
  execFileSync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", outMp3],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outMp3)) throw new Error(`audio extract produced no file`);
}

// Generate a held-frame opening clip from a still PNG.
// Output: 1080x1920 mp4, h264 + silent AAC, matching the source clips' codec
// params so it concats cleanly with them.
function makeOpeningClip(pngPath: string, holdSec: number, fps: number, outPath: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loop", "1", "-framerate", String(fps), "-i", pngPath,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t", String(holdSec),
      "-vf", "scale=1080:1920,setsar=1",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-shortest",
      outPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`opening clip produced no file`);
}

// Hard-cut concat (no transition). Normalises every input's video stream to
// `targetW x targetH` (using lanczos for sharpness) and audio to a common
// 48 kHz stereo, then concats. This matters because ffmpeg's concat filter
// rejects inputs whose params don't agree, and our inputs come from
// different sources (PNG-loop opening at 1080x1920, Seedance body at 720x1280).
function concatHardCut(inputs: string[], outPath: string, targetW: number, targetH: number): void {
  const inputArgs = inputs.flatMap(p => ["-i", p]);
  const normalised = inputs.map((_, i) => {
    const v = `[${i}:v]scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=24[v${i}n]`;
    const a = `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}n]`;
    return [v, a];
  });
  const concatInputs = inputs.map((_, i) => `[v${i}n][a${i}n]`).join("");
  const filter = [
    ...normalised.flat(),
    `${concatInputs}concat=n=${inputs.length}:v=1:a=1[v][a]`,
  ].join(";");
  execFileSync(
    "ffmpeg",
    [
      "-y", ...inputArgs,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      outPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`hard-cut concat produced no file`);
}

// Probe video stream dimensions.
function probeDimensions(filePath: string): { width: number; height: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  ).trim();
  const [w, h] = out.split(",").map(s => parseInt(s, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`ffprobe bad dims for ${filePath}: ${out}`);
  return { width: w, height: h };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function cleanup() {
  if (!args.keepPublic) {
    try { fs.rmSync(publicDir, { recursive: true, force: true }); }
    catch (e) { log(`[cleanup] failed to remove ${publicDir}: ${(e as Error).message}`); }
  }
}

// ---- Main ----

async function main() {
  // Step 1: Download mp4s in parallel into public/<runDir>/
  log(`[step 1/8] downloading ${clips.length} clip(s) ...`);
  const downloaded = await Promise.all(
    clips.map(async (c) => {
      const dest = path.join(publicDir, `${c.id}.raw.mp4`);
      await downloadFile(c.url, dest);
      return { id: c.id, rawPath: dest };
    }),
  );

  // Step 2: Trim per-clip head/tail silence (sensitivity-floored — see
  // trim-clip-silence.ts). Only trims gaps clearly above breath/beat
  // duration, so intentional emphatic pauses survive. Skipped via --no-trim.
  log(`[step 2/8] trimming silence (lead>0.5s, tail>1.0s) ...`);
  const localPaths: Array<{ id: string; mp4Path: string; publicRel: string }> = [];
  const trimReports: TrimResult[] = [];
  for (const d of downloaded) {
    const finalPath = path.join(publicDir, `${d.id}.mp4`);
    if (args.noTrim) {
      fs.renameSync(d.rawPath, finalPath);
      log(`  ${d.id}: trim disabled (--no-trim)`);
    } else {
      const r = await trimClipSilence(d.rawPath, finalPath);
      trimReports.push(r);
      if (r.applied) {
        log(`  ${d.id}: TRIMMED ${r.origDurationSec.toFixed(2)}s → ${r.newDurationSec.toFixed(2)}s (${r.reason})`);
      } else {
        log(`  ${d.id}: kept (${r.reason})`);
      }
      // raw kept on disk only when --keep-public; otherwise drop now.
      if (!args.keepPublic) {
        try { fs.unlinkSync(d.rawPath); } catch { /* ignore */ }
      }
    }
    localPaths.push({ id: d.id, mp4Path: finalPath, publicRel: path.posix.join(publicSubdir, `${d.id}.mp4`) });
  }

  // Step 3: Probe durations
  log(`[step 3/8] probing durations ...`);
  const durations = localPaths.map(p => probeDurationSeconds(p.mp4Path));
  const totalDurationSec = durations.reduce((a, b) => a + b, 0);
  for (let i = 0; i < clips.length; i++) {
    log(`  ${clips[i].id}: ${durations[i].toFixed(2)}s`);
  }
  log(`  total: ${totalDurationSec.toFixed(2)}s`);

  // Step 3: Crossfade-concat the body (SCENE_1..SCENE_N), then optionally
  // hard-cut prepend a held-frame opening from --hook-card.
  // Body and final result both live under public/ so Remotion can serve via staticFile().
  const xfadeSec = 0.2;  // 200ms — within 150-250ms target window
  const mergedRel = path.posix.join(publicSubdir, "merged.mp4");
  const mergedPath = path.join(publicDir, "merged.mp4");

  log(`[step 4/8] crossfade-concat ${clips.length} body clips (xfade ${xfadeSec}s) ...`);
  const bodyPath = path.join(publicDir, "body.mp4");
  const bodyDuration = concatWithCrossfade(localPaths.map(p => p.mp4Path), durations, xfadeSec, bodyPath);
  const xfadeSavings = (clips.length - 1) * xfadeSec;
  log(`  body: ${bodyDuration.toFixed(2)}s (input total ${totalDurationSec.toFixed(2)}s minus ${xfadeSavings.toFixed(2)}s of overlap)`);

  let mergedDuration: number;
  if (args.hookCardPath) {
    if (!fs.existsSync(args.hookCardPath)) {
      console.error(`[fatal] --hook-card path does not exist: ${args.hookCardPath}`);
      process.exit(1);
    }
    log(`  prepending hook-card opening (${args.hookCardHoldSec}s held, hard cut into body) from ${args.hookCardPath}`);
    const openingPath = path.join(publicDir, "opening.mp4");
    makeOpeningClip(args.hookCardPath, args.hookCardHoldSec, 24, openingPath);
    // Normalise both inputs to the body's resolution (Seedance native) so the
    // concat filter accepts them. Remotion will scale to 1080x1920 on render anyway.
    const bodyDims = probeDimensions(bodyPath);
    concatHardCut([openingPath, bodyPath], mergedPath, bodyDims.width, bodyDims.height);
    mergedDuration = args.hookCardHoldSec + bodyDuration;
    log(`  merged with opening: ${mergedDuration.toFixed(2)}s @ ${bodyDims.width}x${bodyDims.height} -> ${mergedPath}`);
  } else {
    fs.renameSync(bodyPath, mergedPath);
    mergedDuration = bodyDuration;
  }

  // Step 4: Extract audio for Whisper from the MERGED video so word
  // timestamps line up with the final timeline (NOT the pre-crossfade timeline).
  const audioPath = path.join(tmpDir, "audio.mp3");
  log(`[step 5/8] extracting audio for Whisper -> ${audioPath} ...`);
  extractAudioMp3(mergedPath, audioPath);

  // Step 5: Whisper for word-level timestamps
  log(`[step 6/8] running Whisper ...`);
  const whisper = await runWhisper(audioPath, `avatar-stitch-${runId}`, tmpDir);
  let words: WhisperWord[] = whisper.words;
  log(`  ${words.length} words, audio ${whisper.durationSec.toFixed(2)}s, cost $${whisper.cost.toFixed(4)}`);

  // Step 6: Build phrase groups (reuse audio-pipeline helpers)
  log(`[step 7/8] grouping phrases ...`);
  const originalEnds = words.map(w => w.end);
  for (const w of words) { if (w.end <= w.start) w.end = w.start + 0.3; }
  const sentenceEndings = findSentenceEndings(script, words, originalEnds);
  const phraseTimings: PhraseGroup[] = buildPhrasesFromWhisper(words, sentenceEndings, 4, originalEnds);
  log(`  ${phraseTimings.length} phrase(s); first/last:`);
  if (phraseTimings.length > 0) {
    log(`    [${phraseTimings[0].startTime.toFixed(2)}-${phraseTimings[0].endTime.toFixed(2)}] "${phraseTimings[0].words}"`);
    const last = phraseTimings[phraseTimings.length - 1];
    log(`    [${last.startTime.toFixed(2)}-${last.endTime.toFixed(2)}] "${last.words}"`);
  }

  // Step 7: Build Remotion props + render. Single merged clip — AvatarClipSequence
  // just plays the pre-crossfaded mp4; PhraseCaptions + BrandWatermark overlay on top.
  const resolvedClips: ResolvedClip[] = [{
    type: "avatar" as const,
    purpose: "merged",
    durationSec: mergedDuration,
    startSec: 0,
    videoFile: mergedRel,
  }];

  const inputProps: AvatarCompositionProps = {
    clips: resolvedClips,
    phraseTimings,
    hookText: "",  // unused by AvatarComposition (it's a layered overlay we don't render)
    ctaText: "",   // same
    totalDurationSec: mergedDuration,
    pillar: args.pillar,
    audioFile: "",  // master audio not used; merged clip carries the baked-in audio
  };

  const propsPath = path.join(tmpDir, "props.json");
  fs.writeFileSync(propsPath, JSON.stringify(inputProps, null, 2));

  log(`[step 8/8] bundling Remotion + rendering ...`);
  const t0 = Date.now();
  const bundleLocation = await bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir: PUBLIC_ROOT,
    onProgress: (p) => { if (p % 25 === 0) log(`  bundle progress: ${p}%`); },
  });
  log(`  bundle ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "AvatarComposition",
    inputProps: inputProps as any,
  });

  const outPath = path.join(tmpDir, "final.mp4");
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outPath,
    inputProps: inputProps as any,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 20 === 0) log(`  render progress: ${pct}%`);
    },
  });

  const finalDuration = probeDurationSeconds(outPath);
  const finalSize = fs.statSync(outPath).size;
  const elapsedTotal = ((Date.now() - t0) / 1000).toFixed(1);

  // Summary to stdout (the deliverable per spec)
  process.stdout.write(`\n=== Avatar Stitcher complete ===\n`);
  process.stdout.write(`Label:    ${args.label || "(unlabeled)"}\n`);
  process.stdout.write(`Path:     ${outPath}\n`);
  process.stdout.write(`Duration: ${finalDuration.toFixed(2)}s (${clips.length} clips concatenated)\n`);
  process.stdout.write(`Filesize: ${fmtBytes(finalSize)}\n`);
  process.stdout.write(`Phrases:  ${phraseTimings.length} caption phrases burned in\n`);
  process.stdout.write(`Render:   ${elapsedTotal}s wall clock\n`);
  if (trimReports.length > 0) {
    const applied = trimReports.filter((r) => r.applied);
    if (applied.length === 0) {
      process.stdout.write(`Trim:     no clips trimmed (${trimReports.length} checked, all under thresholds)\n`);
    } else {
      const totalCut = applied.reduce((a, r) => a + (r.origDurationSec - r.newDurationSec), 0);
      const ids = applied.map((r, i) => `${clips[trimReports.indexOf(r)].id} (-${(r.origDurationSec - r.newDurationSec).toFixed(2)}s)`).join(", ");
      process.stdout.write(`Trim:     ${applied.length}/${trimReports.length} clip(s) trimmed, total -${totalCut.toFixed(2)}s [${ids}]\n`);
    }
  }

  cleanup();
}

main().catch(e => {
  console.error(`[fatal] ${e.stack || e.message}`);
  cleanup();
  process.exit(1);
});
