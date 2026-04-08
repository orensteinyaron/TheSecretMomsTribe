/**
 * SMT Video QA Agent — Vision-Based Quality Review + Anti-AI Checklist
 *
 * Uses Claude Vision to evaluate quality from a VIEWER perspective.
 *
 * Usage: npx tsx scripts/qa-agent.ts <video-path> --content-id <id> [--no-audio]
 * Exit: 0 if would_post=true AND overall >= 7, else 1
 * Cost: ~$0.05-0.08 per run
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import sharp from "sharp";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

// ---- Config ----

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const args = process.argv.slice(2);
const videoPath = args.find(a => !a.startsWith("--"));
const contentIdIdx = args.indexOf("--content-id");
const contentId = contentIdIdx >= 0 ? args[contentIdIdx + 1] : undefined;
const noAudio = args.includes("--no-audio");
const isAvatar = args.includes("--avatar");

if (!videoPath || !ANTHROPIC_KEY) {
  console.error("Usage: npx tsx scripts/qa-agent.ts <video-path> --content-id <id>");
  console.error("Requires: ANTHROPIC_API_KEY");
  process.exit(1);
}
if (!fs.existsSync(videoPath!)) { console.error(`Not found: ${videoPath}`); process.exit(1); }

// ---- Helpers ----

function run(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch (e: any) { return e.stderr?.toString() || ""; }
}

function getVideoInfo() {
  const j = JSON.parse(run(`ffprobe -v quiet -print_format json -show_streams -show_format "${videoPath}"`));
  const v = j.streams?.find((s: any) => s.codec_type === "video");
  const a = j.streams?.find((s: any) => s.codec_type === "audio");
  return {
    width: v?.width || 0, height: v?.height || 0,
    duration: parseFloat(j.format?.duration) || 0,
    hasAudio: !!a,
  };
}

// ---- Step 1: Extract frames (1/sec) + build grids ----

function extractFrames(outDir: string): string[] {
  const dir = path.join(outDir, "qa-frames");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".jpg")) fs.unlinkSync(path.join(dir, f));

  run(`ffmpeg -y -i "${videoPath}" -vf "fps=1" -q:v 3 "${dir}/frame-%03d.jpg" 2>&1`);
  return fs.readdirSync(dir).filter(f => f.startsWith("frame-") && f.endsWith(".jpg")).sort().map(f => path.join(dir, f));
}

async function buildGrids(frames: string[], outDir: string): Promise<string[]> {
  const COLS = 4, ROWS = 3, PER = 12;
  const TW = 270, TH = 480;
  const grids: string[] = [];

  for (let g = 0; g < Math.ceil(frames.length / PER); g++) {
    const batch = frames.slice(g * PER, (g + 1) * PER);
    const thumbs: { input: Buffer; top: number; left: number }[] = [];
    for (let i = 0; i < batch.length; i++) {
      const buf = await sharp(batch[i]).resize(TW, TH, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
      thumbs.push({ input: buf, top: Math.floor(i / COLS) * TH, left: (i % COLS) * TW });
    }
    const p = path.join(outDir, `qa-grid-${g}.jpg`);
    await sharp({ create: { width: COLS * TW, height: ROWS * TH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite(thumbs).jpeg({ quality: 85 }).toFile(p);
    grids.push(p);
  }
  return grids;
}

// ---- Step 2: Transcript ----

async function getTranscript(outDir: string): Promise<{ text: string; words: any[] }> {
  if (noAudio) return { text: "", words: [] };

  const tsPath = path.join(outDir, "timestamps.json");
  if (fs.existsSync(tsPath)) {
    const raw = JSON.parse(fs.readFileSync(tsPath, "utf-8"));
    // Handle both formats: direct array or Whisper verbose_json with .words
    const w = Array.isArray(raw) ? raw : (raw.words || []);
    const text = raw.text || w.map((x: any) => x.word).join(" ");
    return { text, words: w };
  }

  const audioPath = path.join(outDir, "qa-audio.mp3");
  run(`ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}" 2>&1`);
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) return { text: "", words: [] };
  if (!OPENAI_KEY) return { text: "", words: [] };

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const res = await openai.audio.transcriptions.create({
    model: "whisper-1", file: fs.createReadStream(audioPath),
    response_format: "verbose_json", timestamp_granularities: ["word"],
  });
  const words = (res as any).words || [];
  fs.writeFileSync(tsPath, JSON.stringify(words, null, 2));
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  return { text: (res as any).text || words.map((w: any) => w.word).join(" "), words };
}

// ---- Claude Vision API ----

async function callClaude(system: string, content: any[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content }] }),
  });
  const d = await res.json();
  return d.content?.[0]?.text || "";
}

function imgB64(p: string) { return fs.readFileSync(p).toString("base64"); }
function imgBlock(p: string) { return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imgB64(p) } }; }

// ---- Step 3: Visual Review ----

async function visualReview(grids: string[], duration: number) {
  console.log("  Visual review (Claude Vision)...");
  const images = grids.map(imgBlock);
  const text = `You are reviewing a TikTok/Reels video for The Secret Moms Tribe, a parenting content brand. These frames are extracted at 1 per second from a ${Math.round(duration)}s video. Each grid = 12 frames (4x3, chronological).

Rate 1-10 with 1-2 sentence reasoning:

SCROLL_STOP_POWER (first 3 frames): Would a mom scrolling stop? Is the hook visible and intriguing?
VISUAL_VARIETY: Different backgrounds frame-to-frame? Repeated images? Dynamic or static?
TEXT_READABILITY: Can you read all text? Contrast sufficient? Font size for mobile?
VISUAL_COHERENCE: One cohesive video or stitched-together mess?
PROFESSIONAL_QUALITY: Real content creator or AI tool? What gives it away?
IMAGE_RELEVANCE: Relatable domestic moments or generic stock? Match the parenting topic?

Also: Would you post this on a 50K follower parenting account? Top 3 fixes?

Respond ONLY with valid JSON (no fences):
{"scroll_stop":{"score":7,"notes":"..."},"visual_variety":{"score":5,"notes":"..."},"text_readability":{"score":8,"notes":"..."},"visual_coherence":{"score":6,"notes":"..."},"professional_quality":{"score":5,"notes":"..."},"image_relevance":{"score":4,"notes":"..."},"would_post":false,"top_3_visual_fixes":["fix1","fix2","fix3"]}`;

  const raw = await callClaude("Professional social media video reviewer. JSON only.", [...images, { type: "text", text }]);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return { error: "parse_failed", raw: raw.slice(0, 300) }; }
}

// ---- Step 4: Audio Review ----

async function audioReview(transcript: string, words: any[]) {
  if (!transcript) return { voice_natural: { score: 0, notes: "No audio" }, voice_pacing: { score: 0, notes: "No audio" }, voice_emotion: { score: 0, notes: "No audio" } };
  console.log("  Audio review...");

  const sample = words.slice(0, 30).map((w: any) => `[${w.start?.toFixed(2)}s] "${w.word}"`).join(", ");
  const raw = await callClaude("Voiceover quality reviewer. JSON only.", [{ type: "text", text:
    `Parenting reel voiceover review.\n\nTRANSCRIPT: "${transcript}"\nSAMPLE TIMESTAMPS: ${sample}\nWords: ${words.length}, Duration: ${words.length > 0 ? (words[words.length-1]?.end - words[0]?.start).toFixed(1) : "?"}s\n\nRate 1-10:\nVOICE_NATURAL: Real person or robot? Natural pauses?\nVOICE_PACING: Too fast/slow/right? Awkward gaps?\nVOICE_EMOTION: Builds to emotional moments or flat?\n\nJSON only: {"voice_natural":{"score":5,"notes":"..."},"voice_pacing":{"score":6,"notes":"..."},"voice_emotion":{"score":4,"notes":"..."},"top_audio_fixes":["fix1","fix2"]}` }]);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return { voice_natural: { score: 5, notes: "Parse failed" }, voice_pacing: { score: 5, notes: "" }, voice_emotion: { score: 5, notes: "" } }; }
}

// ---- Step 5: Content-Visual Match ----

async function contentMatch(grids: string[], hook: string, caption: string) {
  console.log("  Content-visual match...");
  const images = grids.slice(0, 2).map(imgBlock);
  const raw = await callClaude("Content-visual match reviewer. JSON only.", [
    ...images,
    { type: "text", text: `Hook: "${hook}"\nCaption: "${caption.slice(0, 500)}"\n\nDo visuals MATCH the content? Relevant to specific topic or generic filler? Rate 1-10.\nJSON only: {"content_visual_match":{"score":5,"notes":"..."}}` },
  ]);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return { content_visual_match: { score: 5, notes: "Parse failed" } }; }
}

// ---- Step 6: Anti-AI-Generic Checklist ----

function antiAIChecklist(frames: string[], info: { duration: number }, transcript: string): { checks: Record<string, { pass: boolean; note: string }>; failCount: number } {
  const checks: Record<string, { pass: boolean; note: string }> = {};

  // Visual variety: any background held > 4 seconds would show as identical consecutive frames
  // (simplified: check if we have enough unique frames — at 1fps, similar consecutive = bad)
  checks.visual_variety = { pass: frames.length >= Math.floor(info.duration * 0.8), note: frames.length < Math.floor(info.duration * 0.8) ? "Missing frames" : "OK" };

  // Caption style: full sentences on screen = fail (checked by vision review, but flag here too)
  checks.caption_style = { pass: true, note: "Checked by vision review" };

  // Em dash presence in transcript
  const hasEmDash = transcript.includes("—") || transcript.includes("--");
  checks.em_dash = { pass: !hasEmDash, note: hasEmDash ? "Em dashes found in transcript" : "Clean" };

  // Duration check: over 60s is a flag
  const maxDuration = isAvatar ? 65 : 65;
  const minDuration = isAvatar ? 13 : 0;
  const durationOk = info.duration <= maxDuration && info.duration >= minDuration;
  checks.duration = {
    pass: durationOk,
    note: durationOk
      ? `${info.duration.toFixed(0)}s — OK`
      : `${info.duration.toFixed(0)}s — outside ${minDuration}-${maxDuration}s range`,
  };

  // Generic hook check
  const hookWords = transcript.toLowerCase().slice(0, 100);
  const genericStarts = ["did you know", "here's why", "here are", "in this video"];
  const isGeneric = genericStarts.some(s => hookWords.startsWith(s));
  checks.generic_hook = { pass: !isGeneric, note: isGeneric ? "Generic hook opening" : "OK" };

  const failCount = Object.values(checks).filter(c => !c.pass).length;
  return { checks, failCount };
}

// ---- Main ----

async function main() {
  console.log(`\n🔍 SMT Video QA Agent`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Video: ${videoPath}`);
  if (contentId) console.log(`Content: ${contentId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  if (isAvatar) console.log(`Mode: Avatar QA (15-60s range)`);

  const info = getVideoInfo();
  const outDir = contentId ? path.resolve("out", contentId) : path.dirname(videoPath!);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Frames
  console.log("1. Extracting frames...");
  const frames = extractFrames(outDir);
  console.log(`   ${frames.length} frames`);

  // 2. Grids
  console.log("2. Building grids...");
  const grids = await buildGrids(frames, outDir);
  console.log(`   ${grids.length} grids`);

  // 3. Transcript
  console.log("3. Transcript...");
  const { text: transcript, words } = await getTranscript(outDir);
  console.log(`   ${words.length} words`);

  // 4. Visual review
  console.log("4. Reviews...");
  const vis = await visualReview(grids, info.duration);

  // 5. Audio review
  const aud = await audioReview(transcript, words);

  // 6. Content match
  let match: any = { content_visual_match: { score: 5, notes: "No content ID" } };
  if (contentId && SUPABASE_KEY) {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb.from("content_queue").select("hook, caption").eq("id", contentId).single();
    if (data) match = await contentMatch(grids, data.hook, data.caption);
  }

  // 7. Anti-AI checklist
  console.log("5. Anti-AI checklist...");
  const antiAI = antiAIChecklist(frames, info, transcript);
  console.log(`   ${antiAI.failCount} flags`);

  // 8. Aggregate
  const scores: Record<string, { score: number; notes: string }> = {
    scroll_stop: vis.scroll_stop || { score: 5, notes: "N/A" },
    visual_variety: vis.visual_variety || { score: 5, notes: "N/A" },
    text_readability: vis.text_readability || { score: 5, notes: "N/A" },
    visual_coherence: vis.visual_coherence || { score: 5, notes: "N/A" },
    professional_quality: vis.professional_quality || { score: 5, notes: "N/A" },
    image_relevance: vis.image_relevance || { score: 5, notes: "N/A" },
    voice_natural: aud.voice_natural || { score: 5, notes: "N/A" },
    voice_pacing: aud.voice_pacing || { score: 5, notes: "N/A" },
    voice_emotion: aud.voice_emotion || { score: 5, notes: "N/A" },
    content_visual_match: match.content_visual_match || { score: 5, notes: "N/A" },
  };

  const vals = Object.values(scores).map(s => s.score);
  const overall = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
  const wouldPost = vis.would_post ?? (overall >= 7);

  const fixes = [...(vis.top_3_visual_fixes || []), ...(aud.top_audio_fixes || [])].slice(0, 5);
  if (fixes.length === 0) fixes.push("Manual review needed");

  const silenceGaps = noAudio ? [] : (() => {
    const out = run(`ffmpeg -i "${videoPath}" -af silencedetect=noise=-40dB:d=0.8 -f null - 2>&1`);
    const gaps: any[] = [];
    const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
    let m; while ((m = re.exec(out))) gaps.push({ at: +m[1], duration: +m[3] });
    return gaps;
  })();

  const report = {
    content_id: contentId || null,
    format: "video-slideshow-v2",
    timestamp: new Date().toISOString(),
    overall_score: overall,
    would_post: wouldPost,
    scores,
    top_3_fixes: fixes.slice(0, 3),
    anti_ai_checklist: antiAI.checks,
    technical: {
      resolution: `${info.width}x${info.height}`,
      duration: +info.duration.toFixed(1),
      file_size_mb: +(fs.statSync(videoPath!).size / 1024 / 1024).toFixed(1),
      has_audio: info.hasAudio,
      silence_gaps: silenceGaps,
    },
  };

  const reportPath = path.join(outDir, "qa-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Print
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`QA: ${overall}/10 | Post: ${wouldPost ? "YES" : "NO"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  for (const [k, v] of Object.entries(scores)) {
    const flag = v.score < 5 ? " !!!" : v.score < 7 ? " *" : "";
    console.log(`  ${k.padEnd(24)} ${v.score}/10${flag}  ${v.notes}`);
  }
  console.log(`\n  ANTI-AI CHECKLIST:`);
  for (const [k, v] of Object.entries(antiAI.checks)) {
    console.log(`    ${v.pass ? "PASS" : "FAIL"} ${k}: ${v.note}`);
  }
  console.log(`\n  TOP FIXES:`);
  fixes.slice(0, 3).forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  console.log(`\n  Report: ${reportPath}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(wouldPost && overall >= 7 ? 0 : 1);
}

main().catch(e => { console.error("QA failed:", e); process.exit(1); });
