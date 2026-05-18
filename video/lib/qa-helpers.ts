// Shared helpers for avatar QA agent.
// Future: Moving Images qa-agent.ts can import from here.

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

// Env vars are read lazily — module load happens before the caller's
// dotenv.config() call, so capturing them at module top-level would always
// see empty strings.
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Per-profile QA agents pass a specific model (Sonnet for hard composition
// judgments, Haiku for structured-checklist dimensions per the cost split
// in PR 0). Existing sonnetVisionJson callers default to Sonnet for
// backwards compatibility.
export const CLAUDE_VISION_MODELS = {
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ClaudeVisionModelKey = keyof typeof CLAUDE_VISION_MODELS;

export function assertFfmpegAvailable(): void {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync("which", [bin], { encoding: "utf-8" });
    if (r.status !== 0) {
      console.error(`[fatal] ${bin} not found on PATH.`);
      console.error(`Install: brew install ffmpeg  (macOS) | apt install ffmpeg (Debian/Ubuntu)`);
      process.exit(1);
    }
  }
}

export async function downloadFile(url: string, destPath: string, retries = 3): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buf);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = 500 * 2 ** (attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`download failed after ${retries} attempts: ${url} :: ${(lastErr as Error)?.message}`);
}

export function probeDurationSeconds(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  ).trim();
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe gave bad duration for ${filePath}: ${out}`);
  return d;
}

// Extract a single frame at the given timestamp, scaled to max 1024px wide, JPEG q:v 2.
export function extractFrame(filePath: string, timestampS: number, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss", String(timestampS),
      "-i", filePath,
      "-frames:v", "1",
      "-vf", "scale='min(1024,iw)':-2",
      "-q:v", "2",
      outPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`frame extraction produced no file: ${outPath}`);
}

export function extractAudioMp3(filePath: string, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-y", "-i", filePath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", outPath],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`audio extraction produced no file: ${outPath}`);
}

export type WhisperWord = { word: string; start: number; end: number };
export type WhisperResult = { text: string; words: WhisperWord[]; duration: number };

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

export async function whisperTranscribe(audioPath: string): Promise<WhisperResult> {
  const file = fs.createReadStream(audioPath);
  const r: any = await openai().audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });
  const words: WhisperWord[] = Array.isArray(r.words)
    ? r.words.map((w: any) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
    : [];
  return { text: String(r.text || ""), words, duration: Number(r.duration || 0) };
}

export type ImagePart = { mediaType: "image/jpeg" | "image/png"; data: string }; // base64

export function imageFromFile(filePath: string): ImagePart {
  const data = fs.readFileSync(filePath).toString("base64");
  const mediaType = filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return { mediaType, data };
}

export type ClaudeVisionUsage = {
  input_tokens: number;
  output_tokens: number;
  retried: boolean;
};

export type ClaudeVisionResult<T> = {
  result: T | { error: string };
  usage: ClaudeVisionUsage;
};

// Strict-JSON Claude vision call with model selection + usage reporting.
// On parse failure, retries once with a "STRICT JSON" reminder appended.
//
// Per-profile QA agents call this directly for cost telemetry. The legacy
// sonnetVisionJson wrapper below preserves the original return shape for
// the existing qa-agent-avatar.ts caller.
export async function claudeVisionJson<T = any>(
  images: ImagePart[],
  prompt: string,
  opts: { model?: ClaudeVisionModelKey; maxTokens?: number } = {},
): Promise<ClaudeVisionResult<T>> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  const usage: ClaudeVisionUsage = { input_tokens: 0, output_tokens: 0, retried: false };
  if (!anthropicKey) return { result: { error: "ANTHROPIC_API_KEY missing" }, usage };
  const max_tokens = opts.maxTokens ?? 1500;
  const model = CLAUDE_VISION_MODELS[opts.model ?? "sonnet"];

  const callOnce = async (text: string): Promise<string> => {
    const content: any[] = images.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    }));
    content.push({ type: "text", text });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`anthropic ${res.status}: ${body.slice(0, 400)}`);
    }
    const j: any = await res.json();
    usage.input_tokens += Number(j?.usage?.input_tokens ?? 0);
    usage.output_tokens += Number(j?.usage?.output_tokens ?? 0);
    return String(j?.content?.[0]?.text || "");
  };

  const tryParse = (raw: string): T | null => {
    let s = raw.trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    try { return JSON.parse(s) as T; } catch { return null; }
  };

  try {
    let raw = await callOnce(prompt);
    let parsed = tryParse(raw);
    if (parsed) return { result: parsed, usage };
    usage.retried = true;
    raw = await callOnce(`${prompt}\n\nReturn STRICT JSON only. Your previous response failed parsing — no prose, no markdown fences, no leading/trailing text.`);
    parsed = tryParse(raw);
    if (parsed) return { result: parsed, usage };
    return { result: { error: `JSON parse failed after retry. Last raw (truncated): ${raw.slice(0, 300)}` }, usage };
  } catch (e: any) {
    return { result: { error: `vision call failed: ${e.message}` }, usage };
  }
}

// Pricing per million tokens (USD). Update on Anthropic price changes.
const ANTHROPIC_PRICING: Record<ClaudeVisionModelKey, { input_per_mtok: number; output_per_mtok: number }> = {
  sonnet: { input_per_mtok: 3, output_per_mtok: 15 },
  haiku: { input_per_mtok: 1, output_per_mtok: 5 },
};

export function priceClaudeVisionCall(model: ClaudeVisionModelKey, usage: ClaudeVisionUsage): number {
  const p = ANTHROPIC_PRICING[model];
  return (usage.input_tokens / 1_000_000) * p.input_per_mtok
       + (usage.output_tokens / 1_000_000) * p.output_per_mtok;
}

// Whisper-1 pricing: $0.006 per minute of audio.
const WHISPER_PER_MINUTE = 0.006;
export function priceWhisperCall(audioSeconds: number): number {
  return (audioSeconds / 60) * WHISPER_PER_MINUTE;
}

// Legacy wrapper — existing qa-agent-avatar.ts callers see the same return
// shape (T | { error }) without usage tracking.
export async function sonnetVisionJson<T = any>(
  images: ImagePart[],
  prompt: string,
  opts: { maxTokens?: number } = {},
): Promise<T | { error: string }> {
  const { result } = await claudeVisionJson<T>(images, prompt, { model: "sonnet", maxTokens: opts.maxTokens });
  return result;
}
