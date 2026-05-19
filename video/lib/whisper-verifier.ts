// Whisper verifier with std→fast→surface-to-human retry escalation.
//
// This is the safety net YAR-129 Finding 5 demands: Seedance's audio role
// honor rate is degrading and non-deterministic. The production renderer
// cannot trust a single attempt — every clip is verified post-render via
// Whisper against the expected script, and a failure escalates the mode
// once (std → fast) before surfacing the clip to human review.
//
// This module owns only the orchestration loop. Submission (Seedance call)
// and transcription (Whisper call) are injected so:
//   - tests run without network
//   - the production wiring composes the existing primitives
//     (downloadFile + extractAudioMp3 + whisperTranscribe + computeWer)
//     in the orchestrator without coupling them to retry logic here

import { computeWer, WER_PASS_THRESHOLD } from "../qa/base/helpers/wer.js";

export type SubmitResult = {
  job_id: string;
  video_url: string;
  duration_s: number;
  cost_credits: number;
  cost_usd: number;
  mode_used: "std" | "fast";
};

export type WhisperOutcome = {
  /** Plain-text transcript from Whisper. */
  transcript: string;
  /** Reported audio duration in seconds (from Whisper, not ffprobe). */
  duration_s: number;
  /**
   * Fraction of the clip's intended duration covered by speech, in [0, 1].
   * Computed by the caller as (last_word_end - first_word_start) / clip_duration_s.
   * Required because Seedance v2 5a returned 3s of speech in an 8s clip —
   * WER on the speech itself was fine, but the clip was unusable.
   */
  speech_coverage: number;
};

export type SubmitFn = (mode: "std" | "fast") => Promise<SubmitResult>;
export type WhisperFn = (clip: SubmitResult) => Promise<WhisperOutcome>;

export type AttemptOutcome = "PASS" | "FAIL_WER" | "FAIL_COVERAGE" | "FAIL_SUBMIT";

export type AttemptRecord = {
  mode: "std" | "fast";
  outcome: AttemptOutcome;
  job_id?: string;
  video_url?: string;
  wer?: number;
  reference_words?: number;
  hypothesis_words?: number;
  transcript?: string;
  speech_coverage?: number;
  cost_credits: number;
  cost_usd: number;
  error?: string;
};

export type VerifyResult = {
  clip_id: string;
  passed: boolean;
  attempts: number;
  reason?: "surface_to_human";
  per_attempt: AttemptRecord[];
  final_job_id?: string;
  final_video_url?: string;
  final_wer?: number;
  final_speech_coverage?: number;
  final_transcript?: string;
  total_credits: number;
  total_usd: number;
};

export type VerifyAndRetryOpts = {
  clipId: string;
  expectedScript: string;
  submitFn: SubmitFn;
  whisperFn: WhisperFn;
  /** WER pass ceiling. Default: WER_PASS_THRESHOLD (0.15). */
  werThreshold?: number;
  /** Min speech-coverage fraction. Default 0.5 (matches audio-integrity-raw-clips). */
  coverageFloor?: number;
};

const RETRY_LADDER: Array<"std" | "fast"> = ["std", "fast"];

export async function verifyAndRetry(opts: VerifyAndRetryOpts): Promise<VerifyResult> {
  const werThreshold = opts.werThreshold ?? WER_PASS_THRESHOLD;
  const coverageFloor = opts.coverageFloor ?? 0.5;
  const perAttempt: AttemptRecord[] = [];

  for (const mode of RETRY_LADDER) {
    const attempt = await runOne({
      mode,
      expectedScript: opts.expectedScript,
      submitFn: opts.submitFn,
      whisperFn: opts.whisperFn,
      werThreshold,
      coverageFloor,
    });
    perAttempt.push(attempt);

    if (attempt.outcome === "PASS") {
      return {
        clip_id: opts.clipId,
        passed: true,
        attempts: perAttempt.length,
        per_attempt: perAttempt,
        final_job_id: attempt.job_id,
        final_video_url: attempt.video_url,
        final_wer: attempt.wer,
        final_speech_coverage: attempt.speech_coverage,
        final_transcript: attempt.transcript,
        total_credits: sumCredits(perAttempt),
        total_usd: sumUsd(perAttempt),
      };
    }
  }

  return {
    clip_id: opts.clipId,
    passed: false,
    attempts: perAttempt.length,
    reason: "surface_to_human",
    per_attempt: perAttempt,
    total_credits: sumCredits(perAttempt),
    total_usd: sumUsd(perAttempt),
  };
}

async function runOne(opts: {
  mode: "std" | "fast";
  expectedScript: string;
  submitFn: SubmitFn;
  whisperFn: WhisperFn;
  werThreshold: number;
  coverageFloor: number;
}): Promise<AttemptRecord> {
  let submitted: SubmitResult;
  try {
    submitted = await opts.submitFn(opts.mode);
  } catch (err) {
    return {
      mode: opts.mode,
      outcome: "FAIL_SUBMIT",
      cost_credits: 0,
      cost_usd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let whisper: WhisperOutcome;
  try {
    whisper = await opts.whisperFn(submitted);
  } catch (err) {
    return {
      mode: opts.mode,
      outcome: "FAIL_SUBMIT", // transcription failure is a submission-level failure for this loop's purposes
      job_id: submitted.job_id,
      video_url: submitted.video_url,
      cost_credits: submitted.cost_credits,
      cost_usd: submitted.cost_usd,
      error: `whisper failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const wer = computeWer(opts.expectedScript, whisper.transcript);
  const base: AttemptRecord = {
    mode: opts.mode,
    outcome: "PASS",
    job_id: submitted.job_id,
    video_url: submitted.video_url,
    wer: wer.wer,
    reference_words: wer.reference_words,
    hypothesis_words: wer.hypothesis_words,
    transcript: whisper.transcript,
    speech_coverage: whisper.speech_coverage,
    cost_credits: submitted.cost_credits,
    cost_usd: submitted.cost_usd,
  };

  if (wer.wer > opts.werThreshold) {
    return { ...base, outcome: "FAIL_WER" };
  }
  if (whisper.speech_coverage < opts.coverageFloor) {
    return { ...base, outcome: "FAIL_COVERAGE" };
  }
  return base;
}

function sumCredits(attempts: AttemptRecord[]): number {
  return attempts.reduce((acc, a) => acc + a.cost_credits, 0);
}

function sumUsd(attempts: AttemptRecord[]): number {
  return attempts.reduce((acc, a) => acc + a.cost_usd, 0);
}
