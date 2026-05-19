// transition_style_verification — at each declared transition boundary in
// the composited output, sample 5 frames at +/- 2 frame offsets and compute
// the frame-diff signature. Hard cut = single dominant spike; crossfade =
// gradient across multiple frames; ambiguous = neither (suspect render bug).
//
// Boundaries come from clip durations: cumulative sum of clip durations
// (minus crossfade overlap if a crossfade is declared) gives the in-final
// timestamp of each transition.

import type { DimensionResult } from "../../schemas/qa-dimension.js";
import type { RenderProfileConfig, ClipMeta } from "../../base/qa-contract.js";
import { extractFrameTo, framesAroundTimestamp, probeDurationSeconds } from "../../base/helpers/frame-sampling.js";
import { computeTransitionSignature, judgeTransition } from "../../base/helpers/transition-signature.js";

function inferFps(profile_config: RenderProfileConfig): number {
  return profile_config.output_spec.fps ?? 30;
}

function transitionTimestamps(clips: ClipMeta[], declared: { type: string; duration_s: number }): number[] {
  // If clips carry start_offset_in_final_s, use them directly — they reflect
  // the actual final-timeline positions (accounting for crossfade overlap).
  const offsets = clips.map(c => c.start_offset_in_final_s).filter((o): o is number => typeof o === "number");
  if (offsets.length === clips.length) return offsets.slice(1); // skip the first clip's start (t=0)

  // Otherwise reconstruct: cumulative duration minus overlap per transition.
  const overlap = declared.type === "crossfade" ? declared.duration_s : 0;
  const out: number[] = [];
  let cursor = 0;
  for (let i = 0; i < clips.length - 1; i++) {
    cursor += clips[i].duration_s - overlap;
    out.push(cursor);
  }
  return out;
}

export async function runTransitionStyleVerification(input: {
  asset_path: string;
  profile_config: RenderProfileConfig;
  clips?: ClipMeta[];
  workdir: string;
}): Promise<DimensionResult> {
  const declared = input.profile_config.output_spec.transition_style;
  if (declared.type === "not_applicable") {
    return {
      name: "transition_style_verification",
      status: "UNMEASURED",
      details: `Profile ${input.profile_config.slug} has transition_style.type=not_applicable. Dimension does not apply.`,
    };
  }

  if (!input.clips || input.clips.length < 2) {
    return {
      name: "transition_style_verification",
      status: "UNMEASURED",
      details: `Need at least 2 clips to verify transitions; got ${input.clips?.length ?? 0}.`,
    };
  }

  const fps = inferFps(input.profile_config);
  const dur = probeDurationSeconds(input.asset_path);
  const boundaries = transitionTimestamps(input.clips, declared);

  if (boundaries.length === 0) {
    return {
      name: "transition_style_verification",
      status: "UNMEASURED",
      details: `Could not derive transition timestamps from clip metadata.`,
    };
  }

  const results: { t: number; observed: string; match: boolean; reason: string }[] = [];
  const evidence: string[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const t = boundaries[i];
    const stamps = framesAroundTimestamp(t, 5, fps, dur);
    const frames = stamps.map((ts, k) => extractFrameTo(input.asset_path, ts, input.workdir, `tx-${i}-${k}`));
    const sig = await computeTransitionSignature(frames);
    const verdict = judgeTransition(sig, declared.type as "hard_cut" | "crossfade");
    results.push({ t, observed: sig.shape, match: verdict.match, reason: verdict.reason });
    evidence.push(...frames);
  }

  const mismatches = results.filter(r => !r.match);
  return {
    name: "transition_style_verification",
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    details: mismatches.length === 0
      ? `All ${results.length} transitions match declared ${declared.type} (duration_s=${declared.duration_s}). ${results.map(r => `t=${r.t.toFixed(2)}s: ${r.observed}`).join("; ")}`
      : `${mismatches.length}/${results.length} transitions diverge from declared ${declared.type}. ${results.map(r => `t=${r.t.toFixed(2)}s: ${r.match ? "OK" : "MISMATCH"} — ${r.reason}`).join("; ")}`,
    evidence,
  };
}
