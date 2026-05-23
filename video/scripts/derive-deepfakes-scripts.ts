// Whisper-transcribe the 7 v3 deepfakes fixtures to recover verbatim scripts.
// These become avatar_config.clips[*].expected_script for the v5 Phase 9 render.
//
// Read-only: writes scripts to stdout (and to workdir/deepfakes-scripts.json).
// Does NOT modify content_queue.

import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

for (const rel of ["../../.env", "../../../.env", "../../../../.env", "../../../../../.env"]) {
  const p = new URL(rel, import.meta.url).pathname;
  if (fs.existsSync(p)) { config({ path: p, override: false }); if (process.env.OPENAI_API_KEY) break; }
}

import { whisperTranscribe, extractAudioMp3, probeDurationSeconds, priceWhisperCall } from "../lib/qa-helpers.js";

const V3_DIR = "/Users/yarono/Documents/Code/SMT/.claude/worktrees/vigilant-engelbart-d6b66c/video/proof/deepfakes/raw_v3";
const CLIP_IDS = ["clip_01", "clip_02", "clip_03a", "clip_03b", "clip_04", "clip_05a", "clip_05b"] as const;

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "deepfakes-scripts-"));
process.stderr.write(`[setup] workdir=${workdir}\n`);

type DerivedClip = {
  id: string;
  expected_script: string;
  duration_target_s: number;
  source_fixture: string;
};

const out: DerivedClip[] = [];
let totalCost = 0;

for (const id of CLIP_IDS) {
  const mp4 = path.join(V3_DIR, `${id}.mp4`);
  const mp3 = path.join(workdir, `${id}.mp3`);
  const dur = probeDurationSeconds(mp4);
  extractAudioMp3(mp4, mp3);
  process.stderr.write(`[whisper] ${id} (${dur.toFixed(2)}s)…\n`);
  const w = await whisperTranscribe(mp3);
  const cost = priceWhisperCall(w.duration || dur);
  totalCost += cost;
  out.push({
    id,
    expected_script: w.text.trim(),
    duration_target_s: Math.round(dur * 100) / 100,
    source_fixture: mp4,
  });
}

const summary = {
  derived_at: new Date().toISOString(),
  fixtures_root: V3_DIR,
  total_whisper_cost_usd: totalCost,
  clips: out,
};

const summaryPath = path.join(workdir, "deepfakes-scripts.json");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
process.stderr.write(`\n[done] wrote ${summaryPath}\n`);
process.stderr.write(`[done] total Whisper cost: \$${totalCost.toFixed(4)}\n`);
