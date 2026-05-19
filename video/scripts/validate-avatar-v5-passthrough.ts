// Avatar Full v5 audio-passthrough validation.
//
// Renders an existing Seedance MP4 through AvatarV5Composition (single
// clip, no transitions, no hook), then verifies the output has exactly
// one audio stream and that Whisper transcribes the output to the same
// content as the source. This proves YAR-129 Finding 4 — OffthreadVideo
// passes embedded audio through cleanly without re-overlay drift —
// BEFORE Phase 9 spends Higgsfield credits.
//
// Usage:
//   npx tsx scripts/validate-avatar-v5-passthrough.ts [<fixture.mp4>]
//
// Default fixture: ../../vigilant-engelbart-d6b66c/video/proof/deepfakes/raw_v3/clip_01.mp4
// (the v3 proof-loop clip 01 — a known-good Seedance render with embedded
//  ElevenLabs-baked-in audio.)
//
// Requires: OPENAI_API_KEY in env or in repo root .env.
// Cost: only Whisper API calls on a ~9s clip (twice) = ~$0.002. No Higgsfield.

import { config } from "dotenv";
import fs from "node:fs";

// Walk up from this script trying common .env locations until we find one
// with the keys we need. The worktree pattern means the canonical .env
// lives at <SMT-root>/.env, several levels above this file.
for (const rel of ["../../.env", "../../../.env", "../../../../.env", "../../../../../.env"]) {
  const p = new URL(rel, import.meta.url).pathname;
  if (fs.existsSync(p)) {
    config({ path: p, override: false });
    if (process.env.OPENAI_API_KEY) break;
  }
}
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { createReadStream, statSync } from "node:fs";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import {
  whisperTranscribe,
  extractAudioMp3,
  assertFfmpegAvailable,
} from "../lib/qa-helpers.js";
import { computeWer, WER_PASS_THRESHOLD } from "../qa/base/helpers/wer.js";
import { AVATAR_V5_FPS } from "../src/templates/avatar-v5/types.js";

const DEFAULT_FIXTURE = path.resolve(
  process.cwd(),
  "..",
  "..",
  "vigilant-engelbart-d6b66c",
  "video",
  "proof",
  "deepfakes",
  "raw_v3",
  "clip_01.mp4",
);

function probeAudioStreams(filePath: string): Array<{ codec_name: string; duration: number }> {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name,duration",
     "-of", "json", filePath],
    { encoding: "utf-8" },
  );
  const json = JSON.parse(out) as { streams?: Array<{ codec_name?: string; duration?: string }> };
  return (json.streams ?? []).map((s) => ({
    codec_name: s.codec_name ?? "",
    duration: parseFloat(s.duration ?? "0"),
  }));
}

function probeVideoDuration(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  ).trim();
  return parseFloat(out);
}

async function main(): Promise<number> {
  assertFfmpegAvailable();

  const fixturePath = process.argv[2] ?? DEFAULT_FIXTURE;
  if (!fs.existsSync(fixturePath)) {
    console.error(`[error] Fixture not found: ${fixturePath}`);
    console.error("Pass a path to a Seedance MP4 with embedded audio as argv[1].");
    return 2;
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-v5-passthrough-"));
  console.error(`[setup] workdir=${workdir}`);
  console.error(`[setup] fixture=${fixturePath}`);

  // ─── 1. Probe the source ────────────────────────────────────────────
  const srcAudioStreams = probeAudioStreams(fixturePath);
  const srcDuration = probeVideoDuration(fixturePath);
  console.error(`[source] ${srcAudioStreams.length} audio stream(s): ${JSON.stringify(srcAudioStreams)}`);
  console.error(`[source] duration ${srcDuration.toFixed(3)}s`);
  if (srcAudioStreams.length !== 1) {
    console.error(`[fail] source fixture must have exactly 1 audio stream; has ${srcAudioStreams.length}`);
    return 3;
  }

  // ─── 2. Whisper-transcribe the source as ground truth ──────────────
  const srcAudioPath = path.join(workdir, "src.mp3");
  extractAudioMp3(fixturePath, srcAudioPath);
  console.error("[whisper] transcribing source…");
  const srcWhisper = await whisperTranscribe(srcAudioPath);
  console.error(`[whisper] source transcript (${srcWhisper.text.length} chars): "${srcWhisper.text.slice(0, 100)}…"`);

  // ─── 3. Serve fixture over HTTP so the Remotion headless browser
  //         can fetch it as http://, matching production Seedance URLs ─
  const server = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(404).end(); return; }
    if (req.url !== "/clip.mp4") { res.writeHead(404).end(); return; }
    const stat = statSync(fixturePath);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size });
    createReadStream(fixturePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const stagedUrl = `http://127.0.0.1:${port}/clip.mp4`;
  console.error(`[stage] serving fixture at ${stagedUrl}`);

  // ─── 4. Bundle the Remotion project ─────────────────────────────────
  console.error("[remotion] bundling…");
  const entryPoint = path.resolve(process.cwd(), "src", "index.ts");
  const bundleLocation = await bundle({ entryPoint });
  console.error(`[remotion] bundle ready at ${bundleLocation}`);

  // ─── 5. Render the fixture through AvatarV5Composition (single clip) ─
  // Single-clip layout, no transitions, no hook overlay — isolates the
  // passthrough behavior we want to verify.
  const inputProps = {
    clips: [{
      id: "v3-clip-01",
      video_url: stagedUrl,
      duration_s: srcDuration,
      crop_offset_y: 0,
    }],
    transitions: [],
    hook_text: "",
  };

  console.error("[remotion] selecting composition…");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "AvatarV5",
    inputProps,
  });
  console.error(`[remotion] composition: ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames`);

  const outPath = path.join(workdir, "out.mp4");
  console.error("[remotion] rendering…");
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
  });
  console.error(`[remotion] rendered ${outPath} (${fs.statSync(outPath).size} bytes)`);
  server.close();

  // ─── 5. ffprobe the output ──────────────────────────────────────────
  const outAudioStreams = probeAudioStreams(outPath);
  const outDuration = probeVideoDuration(outPath);
  console.error(`[output] ${outAudioStreams.length} audio stream(s): ${JSON.stringify(outAudioStreams)}`);
  console.error(`[output] duration ${outDuration.toFixed(3)}s`);

  let failures = 0;
  if (outAudioStreams.length !== 1) {
    console.error(`[FAIL] expected exactly 1 audio stream in output, got ${outAudioStreams.length}`);
    failures++;
  }

  // ─── 6. Whisper-transcribe the output, compare to source ────────────
  const outAudioPath = path.join(workdir, "out.mp3");
  extractAudioMp3(outPath, outAudioPath);
  console.error("[whisper] transcribing output…");
  const outWhisper = await whisperTranscribe(outAudioPath);
  console.error(`[whisper] output transcript (${outWhisper.text.length} chars): "${outWhisper.text.slice(0, 100)}…"`);

  const wer = computeWer(srcWhisper.text, outWhisper.text);
  console.error(`[wer] source vs output: ${(wer.wer * 100).toFixed(2)}% (threshold ${(WER_PASS_THRESHOLD * 100).toFixed(0)}%)`);
  if (wer.wer > WER_PASS_THRESHOLD) {
    console.error(`[FAIL] WER ${(wer.wer * 100).toFixed(2)}% exceeds threshold ${(WER_PASS_THRESHOLD * 100).toFixed(0)}% — embedded audio passthrough is BROKEN`);
    failures++;
  }

  // ─── 7. Duration sanity ─────────────────────────────────────────────
  // Allow up to 0.5s difference for codec re-encoding rounding.
  const durationDelta = Math.abs(srcDuration - outDuration);
  if (durationDelta > 0.5) {
    console.error(`[WARN] duration delta ${durationDelta.toFixed(3)}s (src=${srcDuration.toFixed(3)}s, out=${outDuration.toFixed(3)}s)`);
  }

  // ─── 8. Summary ─────────────────────────────────────────────────────
  console.log("\n=== AVATAR V5 PASSTHROUGH VALIDATION ===");
  console.log(`fixture        : ${fixturePath}`);
  console.log(`src duration   : ${srcDuration.toFixed(3)}s`);
  console.log(`src streams    : ${srcAudioStreams.length} audio (${srcAudioStreams.map(s => s.codec_name).join(",")})`);
  console.log(`src transcript : "${srcWhisper.text.slice(0, 80)}${srcWhisper.text.length > 80 ? "..." : ""}"`);
  console.log(`out duration   : ${outDuration.toFixed(3)}s`);
  console.log(`out streams    : ${outAudioStreams.length} audio (${outAudioStreams.map(s => s.codec_name).join(",")})`);
  console.log(`out transcript : "${outWhisper.text.slice(0, 80)}${outWhisper.text.length > 80 ? "..." : ""}"`);
  console.log(`WER            : ${(wer.wer * 100).toFixed(2)}% (threshold ${(WER_PASS_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`rendered file  : ${outPath}`);
  console.log(`verdict        : ${failures === 0 ? "PASS — Finding 4 honored, embedded audio passes through cleanly" : `FAIL (${failures} issue${failures === 1 ? "" : "s"})`}`);
  console.log("========================================\n");

  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e);
  process.exit(1);
});
