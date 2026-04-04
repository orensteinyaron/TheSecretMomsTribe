/**
 * SMT Video QA Agent
 *
 * Standalone quality validation for rendered videos.
 * Inspects resolution, audio, timing, silence gaps, frames, watermark.
 *
 * Usage:
 *   npx tsx video/scripts/qa-agent.ts <video-path> --content-id <id> [--no-audio]
 *
 * Output: JSON report at video/out/<content-id>/qa-report.json
 * Exit code: 0 if all pass, 1 if any fail
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

// ---- Config ----

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const args = process.argv.slice(2);
const videoPath = args.find(a => !a.startsWith("--"));
const contentIdIdx = args.indexOf("--content-id");
const contentId = contentIdIdx >= 0 ? args[contentIdIdx + 1] : undefined;
const noAudio = args.includes("--no-audio");

if (!videoPath) {
  console.error("Usage: npx tsx video/scripts/qa-agent.ts <video-path> --content-id <id> [--no-audio]");
  process.exit(1);
}

if (!fs.existsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`);
  process.exit(1);
}

// ---- Helpers ----

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    return err.stderr?.toString() || err.stdout?.toString() || "";
  }
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

type Status = "PASS" | "FAIL" | "WARN" | "SKIP";

interface Check {
  status: Status;
  [key: string]: any;
}

// ---- Check 1: Resolution ----

function checkResolution(): Check {
  const probeJson = run(`${FFPROBE} -v quiet -print_format json -show_streams "${videoPath}"`);
  try {
    const data = JSON.parse(probeJson);
    const video = data.streams?.find((s: any) => s.codec_type === "video");
    if (!video) return { status: "FAIL", error: "No video stream found" };

    const w = video.width;
    const h = video.height;
    const actual = `${w}x${h}`;

    // Accept 1080x1920 or 810x1440 (0.75 scale)
    const valid = (w === 1080 && h === 1920) || (w === 810 && h === 1440);
    const portrait = h > w;

    if (!portrait) return { status: "FAIL", actual, error: "Landscape orientation" };
    if (!valid) return { status: "WARN", actual, note: `Non-standard resolution (expected 1080x1920)` };
    return { status: "PASS", actual };
  } catch {
    return { status: "FAIL", error: "Failed to parse ffprobe output" };
  }
}

// ---- Check 2: Audio ----

function checkAudio(): Check {
  if (noAudio) return { status: "SKIP", note: "--no-audio flag set" };

  const probeJson = run(`${FFPROBE} -v quiet -print_format json -show_streams "${videoPath}"`);
  try {
    const data = JSON.parse(probeJson);
    const audio = data.streams?.find((s: any) => s.codec_type === "audio");
    if (!audio) return { status: "FAIL", has_audio: false, error: "No audio track" };
    return { status: "PASS", has_audio: true, codec: audio.codec_name, sample_rate: audio.sample_rate };
  } catch {
    return { status: "FAIL", error: "Failed to parse ffprobe output" };
  }
}

// ---- Check 3: Duration ----

async function checkDuration(): Promise<Check> {
  const formatJson = run(`${FFPROBE} -v quiet -print_format json -show_format "${videoPath}"`);
  let actualDuration: number;
  try {
    actualDuration = parseFloat(JSON.parse(formatJson).format.duration);
  } catch {
    return { status: "FAIL", error: "Could not read duration" };
  }

  // If no content ID, just report duration
  if (!contentId || !SUPABASE_KEY) {
    return { status: "PASS", actual: Math.round(actualDuration * 10) / 10, note: "No content ID for comparison" };
  }

  // Fetch content from Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase
    .from("content_queue")
    .select("hook, caption, metadata")
    .eq("id", contentId)
    .single();

  if (!data) return { status: "PASS", actual: Math.round(actualDuration * 10) / 10, note: "Content not found" };

  // Estimate expected duration from word count
  const caption = data.caption || "";
  const paragraphs = caption.split(/\n\n+/).filter((p: string) => p.trim() && !p.trim().startsWith("#"));
  const totalWords = paragraphs.reduce((sum: number, p: string) => sum + wordCount(p), 0);
  // ~3 words/sec + 5s hook + 4s CTA + overhead
  const expectedSec = (totalWords / 3) + 5 + 4 + 5;
  const diff = Math.abs(actualDuration - expectedSec) / expectedSec;

  return {
    status: diff > 0.10 ? "WARN" : "PASS",
    expected: Math.round(expectedSec),
    actual: Math.round(actualDuration * 10) / 10,
    diff_pct: `${(diff * 100).toFixed(1)}%`,
  };
}

// ---- Check 4: Silence Detection ----

function checkSilence(): Check {
  if (noAudio) return { status: "SKIP", note: "--no-audio flag set" };

  const output = run(
    `${FFMPEG} -i "${videoPath}" -af silencedetect=noise=-40dB:d=0.8 -f null - 2>&1`
  );

  const gaps: { at: number; duration: number }[] = [];
  const regex = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    gaps.push({
      at: parseFloat(match[1]),
      duration: parseFloat(match[3]),
    });
  }

  // Filter out expected silence at the very start (hook) and very end (CTA tail)
  const midGaps = gaps.filter(g => g.at > 6 && g.at < parseFloat(run(
    `${FFPROBE} -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`
  )) - 5);

  return {
    status: midGaps.length > 2 ? "FAIL" : (midGaps.length > 0 ? "WARN" : "PASS"),
    gaps: midGaps,
    total_gaps: midGaps.length,
  };
}

// ---- Check 5: Frame Sampling ----

async function checkFrames(): Promise<Check> {
  const contentDir = contentId
    ? path.resolve("out", contentId, "qa-frames")
    : path.resolve("out", "qa-frames");
  fs.mkdirSync(contentDir, { recursive: true });

  // Get video duration
  const durationStr = run(`${FFPROBE} -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`);
  const duration = parseFloat(durationStr);
  if (!duration) return { status: "FAIL", error: "Could not read duration" };

  // Extract 1 frame every ~slide duration (approximately 8-10s intervals)
  const interval = Math.max(5, Math.min(10, duration / 7));
  const timestamps: number[] = [];
  for (let t = 2; t < duration - 2; t += interval) {
    timestamps.push(Math.round(t * 10) / 10);
  }

  let allPortrait = true;
  let noBlack = true;
  const frameResults: { ts: number; file: string; width: number; height: number; avgBrightness: number }[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const framePath = path.join(contentDir, `frame-${i}-${ts}s.png`);

    run(`${FFMPEG} -y -ss ${ts} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" 2>&1`);

    if (!fs.existsSync(framePath)) continue;

    try {
      const meta = await sharp(framePath).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w > h) allPortrait = false;

      // Check average brightness
      const stats = await sharp(framePath).grayscale().stats();
      const avgBrightness = stats.channels[0]?.mean || 0;
      if (avgBrightness < 20) noBlack = false;

      frameResults.push({ ts, file: path.basename(framePath), width: w, height: h, avgBrightness: Math.round(avgBrightness) });
    } catch {
      frameResults.push({ ts, file: path.basename(framePath), width: 0, height: 0, avgBrightness: 0 });
    }
  }

  return {
    status: allPortrait && noBlack ? "PASS" : "FAIL",
    count: frameResults.length,
    all_portrait: allPortrait,
    no_black: noBlack,
    frames: frameResults,
    frame_dir: contentDir,
  };
}

// ---- Check 6: Timing (Words Per Second) ----

async function checkTiming(): Promise<Check> {
  if (noAudio) return { status: "SKIP", note: "--no-audio flag set" };

  // Get audio duration
  const durationStr = run(`${FFPROBE} -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`);
  const duration = parseFloat(durationStr);
  if (!duration) return { status: "FAIL", error: "Could not read duration" };

  if (!contentId || !SUPABASE_KEY) {
    return { status: "SKIP", note: "No content ID for word count" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase
    .from("content_queue")
    .select("caption")
    .eq("id", contentId)
    .single();

  if (!data?.caption) return { status: "SKIP", note: "Content not found" };

  const caption = data.caption;
  const paragraphs = caption.split(/\n\n+/).filter((p: string) => p.trim() && !p.trim().startsWith("#"));
  const totalWords = paragraphs.reduce((sum: number, p: string) => sum + wordCount(p), 0);

  // Exclude hook (5s) and CTA (4s) from audio duration estimate
  const contentDuration = Math.max(1, duration - 9);
  const wps = totalWords / contentDuration;

  let status: Status = "PASS";
  let note: string | undefined;
  if (wps < 2) { status = "WARN"; note = "Too slow — may feel boring"; }
  if (wps > 4) { status = "WARN"; note = "Too fast — text may be unreadable"; }

  return { status, wps: Math.round(wps * 10) / 10, total_words: totalWords, content_duration: Math.round(contentDuration), note };
}

// ---- Check 7: Watermark ----

async function checkWatermark(): Promise<Check> {
  // Extract the last frame
  const durationStr = run(`${FFPROBE} -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`);
  const duration = parseFloat(durationStr);
  const checkTs = Math.max(1, duration - 3); // 3s before end (CTA slide)

  const tmpFrame = path.resolve("out", `watermark-check-${Date.now()}.png`);
  run(`${FFMPEG} -y -ss ${checkTs} -i "${videoPath}" -vframes 1 -q:v 2 "${tmpFrame}" 2>&1`);

  if (!fs.existsSync(tmpFrame)) {
    return { status: "FAIL", error: "Could not extract frame for watermark check" };
  }

  try {
    const meta = await sharp(tmpFrame).metadata();
    const w = meta.width || 1080;
    const h = meta.height || 1920;

    // Extract bottom-right corner (200x50 pixels)
    const region = {
      left: Math.max(0, w - 200),
      top: Math.max(0, h - 50),
      width: Math.min(200, w),
      height: Math.min(50, h),
    };

    const corner = await sharp(tmpFrame).extract(region).grayscale().stats();
    const avgBrightness = corner.channels[0]?.mean || 0;
    const stdDev = corner.channels[0]?.stdev || 0;

    // Clean up
    fs.unlinkSync(tmpFrame);

    // Watermark should create some variation in the corner
    // Pure black corner = no watermark (brightness ~0, stdDev ~0)
    // With watermark = some brightness variation
    const hasContent = avgBrightness > 5 || stdDev > 3;

    return {
      status: hasContent ? "PASS" : "WARN",
      corner_brightness: Math.round(avgBrightness),
      corner_stddev: Math.round(stdDev * 10) / 10,
      note: hasContent ? undefined : "Bottom-right corner appears empty — watermark may be missing",
    };
  } catch (err: any) {
    if (fs.existsSync(tmpFrame)) fs.unlinkSync(tmpFrame);
    return { status: "FAIL", error: `Frame analysis failed: ${err.message}` };
  }
}

// ---- Main ----

async function main() {
  console.log(`\n🔍 SMT Video QA Agent`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Video: ${videoPath}`);
  if (contentId) console.log(`Content ID: ${contentId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const checks: Record<string, Check> = {};

  // Run all checks
  console.log("1. Resolution...");
  checks.resolution = checkResolution();
  console.log(`   ${checks.resolution.status}: ${checks.resolution.actual || checks.resolution.error}`);

  console.log("2. Audio...");
  checks.audio = checkAudio();
  console.log(`   ${checks.audio.status}: ${checks.audio.has_audio ? `${checks.audio.codec} @ ${checks.audio.sample_rate}Hz` : checks.audio.error || checks.audio.note}`);

  console.log("3. Duration...");
  checks.duration = await checkDuration();
  console.log(`   ${checks.duration.status}: ${checks.duration.actual}s${checks.duration.expected ? ` (expected ~${checks.duration.expected}s, diff ${checks.duration.diff_pct})` : ""}`);

  console.log("4. Silence detection...");
  checks.silence = checkSilence();
  console.log(`   ${checks.silence.status}: ${checks.silence.total_gaps ?? 0} gap(s)${checks.silence.gaps?.length ? ` at ${checks.silence.gaps.map((g: any) => `${g.at}s`).join(", ")}` : ""}`);

  console.log("5. Frame sampling...");
  checks.frames = await checkFrames();
  console.log(`   ${checks.frames.status}: ${checks.frames.count} frames, portrait=${checks.frames.all_portrait}, no_black=${checks.frames.no_black}`);

  console.log("6. Timing (WPS)...");
  checks.timing = await checkTiming();
  console.log(`   ${checks.timing.status}: ${checks.timing.wps ? `${checks.timing.wps} words/sec` : checks.timing.note}${checks.timing.note && checks.timing.wps ? ` — ${checks.timing.note}` : ""}`);

  console.log("7. Watermark...");
  checks.watermark = await checkWatermark();
  console.log(`   ${checks.watermark.status}: brightness=${checks.watermark.corner_brightness}, stddev=${checks.watermark.corner_stddev}${checks.watermark.note ? ` — ${checks.watermark.note}` : ""}`);

  // Build report
  const passed = Object.values(checks).filter(c => c.status === "PASS").length;
  const failed = Object.values(checks).filter(c => c.status === "FAIL").length;
  const warned = Object.values(checks).filter(c => c.status === "WARN").length;
  const skipped = Object.values(checks).filter(c => c.status === "SKIP").length;
  const total = Object.values(checks).length - skipped;
  const overall: Status = failed > 0 ? "FAIL" : (warned > 0 ? "WARN" : "PASS");

  const failedChecks = Object.entries(checks).filter(([, c]) => c.status === "FAIL").map(([k]) => k);
  const warnedChecks = Object.entries(checks).filter(([, c]) => c.status === "WARN").map(([k]) => k);

  let summary = `${passed}/${total} checks passed.`;
  if (failed > 0) summary += ` FAILED: ${failedChecks.join(", ")}.`;
  if (warned > 0) summary += ` WARNINGS: ${warnedChecks.join(", ")}.`;

  const report = {
    content_id: contentId || null,
    video_path: videoPath,
    timestamp: new Date().toISOString(),
    overall,
    checks,
    summary,
  };

  // Save report
  const reportDir = contentId
    ? path.resolve("out", contentId)
    : path.dirname(videoPath);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "qa-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${overall === "PASS" ? "✅" : overall === "WARN" ? "⚠️" : "❌"} ${overall}: ${summary}`);
  console.log(`Report saved: ${reportPath}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch(err => {
  console.error("QA agent failed:", err);
  process.exit(1);
});
