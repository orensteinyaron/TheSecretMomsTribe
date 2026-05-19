// audio_integrity_raw_clips — for each raw input clip (e.g. each Seedance
// MP4 attached to the final concat), ffprobe + Whisper-transcribe its
// embedded audio and compare to the expected script line via WER.
//
// This is the dimension that would have caught v2's hallucinated audio on
// clips 02 and 05a — Seedance's `audio` role is non-deterministic and may
// inject speech-like content that doesn't match the attached ElevenLabs
// MP3, and the lip motion follows that hallucinated audio.

import path from "path";
import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import type { ClipMeta } from "../../base/qa-contract.js";
import {
  extractAudioMp3,
  whisperTranscribe,
  priceWhisperCall,
  downloadFile,
} from "../../../lib/qa-helpers.js";
import { computeWer, WER_PASS_THRESHOLD, normalize } from "../../base/helpers/wer.js";
import { existsSync } from "fs";

type ClipResult = {
  clip_id: string;
  status: "PASS" | "FAIL";
  wer: number;
  reference_words: number;
  hypothesis_words: number;
  transcript: string;
  speech_coverage: number;
  whisper_duration_s: number;
  call_cost: number;
};

async function ensureLocal(clip: ClipMeta, workdir: string): Promise<string> {
  if (clip.local_path && existsSync(clip.local_path)) return clip.local_path;
  if (!clip.url) throw new Error(`clip ${clip.id} has neither local_path nor url`);
  const dest = path.join(workdir, `raw-${clip.id}.mp4`);
  if (!existsSync(dest)) await downloadFile(clip.url, dest);
  return dest;
}

async function checkClip(clip: ClipMeta, workdir: string): Promise<ClipResult & { calls: DimensionCall[] }> {
  const localVideo = await ensureLocal(clip, workdir);
  const audioPath = path.join(workdir, `raw-${clip.id}.mp3`);
  extractAudioMp3(localVideo, audioPath);

  const whisper = await whisperTranscribe(audioPath);
  const wer = computeWer(clip.expected_script, whisper.text);
  const cost = priceWhisperCall(whisper.duration || clip.duration_s);
  const coverage = whisper.words.length > 0
    ? (whisper.words[whisper.words.length - 1].end - whisper.words[0].start) / Math.max(clip.duration_s, 0.001)
    : 0;

  // Coverage check: Seedance v2 5a returned 3s of speech in an 8s clip.
  // Even a near-perfect WER on the spoken portion is a defect if speech
  // fills < 50% of the clip duration.
  const coverageFail = coverage > 0 && coverage < 0.5;
  const status: "PASS" | "FAIL" = wer.wer <= WER_PASS_THRESHOLD && !coverageFail ? "PASS" : "FAIL";

  const calls: DimensionCall[] = [{
    service: "openai_whisper",
    model: "whisper-1",
    audio_seconds: whisper.duration || clip.duration_s,
    cost_usd: cost,
  }];

  return {
    clip_id: clip.id,
    status,
    wer: wer.wer,
    reference_words: wer.reference_words,
    hypothesis_words: wer.hypothesis_words,
    transcript: whisper.text.trim(),
    speech_coverage: coverage,
    whisper_duration_s: whisper.duration,
    call_cost: cost,
    calls,
  };
}

export async function runAudioIntegrityRawClips(input: {
  clips: ClipMeta[];
  workdir: string;
}): Promise<DimensionResult> {
  if (!input.clips || input.clips.length === 0) {
    return {
      name: "audio_integrity_raw_clips",
      status: "UNMEASURED",
      details: "No raw clips provided in QA input metadata. This dimension requires per-clip URLs + expected scripts. Skip is intentional — the dimension is in-scope for Avatar Full but cannot run without metadata.",
    };
  }

  // Reject calls with missing expected scripts up-front rather than
  // running 6 Whispers and then complaining.
  const noScript = input.clips.filter(c => !c.expected_script || normalize(c.expected_script) === "");
  if (noScript.length > 0) {
    return {
      name: "audio_integrity_raw_clips",
      status: "UNMEASURED",
      details: `${noScript.length}/${input.clips.length} clip(s) missing expected_script: ${noScript.map(c => c.id).join(", ")}. Skipping dimension — no script means no comparison target.`,
    };
  }

  const results = await Promise.all(input.clips.map(c => checkClip(c, input.workdir)));
  const fails = results.filter(r => r.status === "FAIL");
  const allCalls = results.flatMap(r => r.calls);

  const detailLines = results.map(r =>
    `  ${r.clip_id}: ${r.status} (WER ${(r.wer * 100).toFixed(1)}%, coverage ${(r.speech_coverage * 100).toFixed(0)}%, "${r.transcript.slice(0, 80)}${r.transcript.length > 80 ? "..." : ""}")`
  );

  return {
    name: "audio_integrity_raw_clips",
    status: fails.length === 0 ? "PASS" : "FAIL",
    details: fails.length === 0
      ? `All ${results.length} clips transcribe-match expected script (WER <= ${(WER_PASS_THRESHOLD * 100).toFixed(0)}%, speech coverage >= 50%).\n${detailLines.join("\n")}`
      : `${fails.length}/${results.length} clip(s) failed audio integrity. This is the v2 Seedance audio hallucination defect.\n${detailLines.join("\n")}`,
    evidence: results.map(r => `${r.clip_id}: "${r.transcript}"`),
    call_costs: allCalls,
  };
}
