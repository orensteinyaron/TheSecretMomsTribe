// audio_integrity_final — final composited MP4: ffprobe audio stream count,
// Whisper-transcribe, compare against the concatenated expected script.
//
// Two failure modes this catches:
//   1. Multiple audio streams in the final MP4 (we always expect exactly 1).
//   2. Whisper transcript of the final audio diverges from the expected
//      concatenated script — caught by WER threshold.

import path from "path";
import { execFileSync } from "child_process";
import type { DimensionResult, DimensionCall } from "../../schemas/qa-dimension.js";
import type { ClipMeta } from "../../base/qa-contract.js";
import {
  extractAudioMp3,
  whisperTranscribe,
  priceWhisperCall,
} from "../../../lib/qa-helpers.js";
import { computeWer, WER_PASS_THRESHOLD } from "../../base/helpers/wer.js";

function countAudioStreams(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  );
  return out.split("\n").filter(l => l.trim().length > 0).length;
}

export async function runAudioIntegrityFinal(input: {
  asset_path: string;
  workdir: string;
  clips?: ClipMeta[];
}): Promise<DimensionResult> {
  const streamCount = countAudioStreams(input.asset_path);
  const calls: DimensionCall[] = [];

  if (streamCount === 0) {
    return {
      name: "audio_integrity_final",
      status: "FAIL",
      details: `Final composited video has 0 audio streams — expected exactly 1.`,
      call_costs: calls,
    };
  }
  if (streamCount > 1) {
    return {
      name: "audio_integrity_final",
      status: "FAIL",
      details: `Final composited video has ${streamCount} audio streams — expected exactly 1. Likely a render bug stacking Seedance raw audio with the ElevenLabs voice-over.`,
      call_costs: calls,
    };
  }

  const audioPath = path.join(input.workdir, "final-audio.mp3");
  extractAudioMp3(input.asset_path, audioPath);
  const whisper = await whisperTranscribe(audioPath);
  calls.push({
    service: "openai_whisper",
    model: "whisper-1",
    audio_seconds: whisper.duration,
    cost_usd: priceWhisperCall(whisper.duration),
  });

  if (!input.clips || input.clips.length === 0) {
    // Can't WER-check without expected script. Still report stream count + transcript.
    return {
      name: "audio_integrity_final",
      status: "PASS",
      details: `1 audio stream, ${whisper.duration.toFixed(1)}s transcribed (${whisper.words.length} words). No expected script provided — WER check skipped, stream-count check passed.`,
      evidence: [`transcript: "${whisper.text.trim()}"`],
      call_costs: calls,
    };
  }

  const expectedConcat = input.clips.map(c => c.expected_script).join(" ");
  const wer = computeWer(expectedConcat, whisper.text);
  const pass = wer.wer <= WER_PASS_THRESHOLD;

  return {
    name: "audio_integrity_final",
    status: pass ? "PASS" : "FAIL",
    details: pass
      ? `1 audio stream, WER ${(wer.wer * 100).toFixed(1)}% <= ${(WER_PASS_THRESHOLD * 100).toFixed(0)}% threshold (${wer.reference_words} reference words vs ${wer.hypothesis_words} hypothesis words)`
      : `1 audio stream, but WER ${(wer.wer * 100).toFixed(1)}% > ${(WER_PASS_THRESHOLD * 100).toFixed(0)}% threshold. Final audio diverges from the concatenated expected script.`,
    evidence: [`transcript: "${whisper.text.trim()}"`],
    call_costs: calls,
  };
}
