// Moving Images profile agent. Composes:
//   - 4 base dimensions that apply: watermark_compliance,
//     audio_integrity_final, caption_legibility,
//     color_filter_consistency, transition_style_verification.
//   - 4 moving-images-specific dims: b_roll_relevance, image_coherence,
//     ken_burns_smoothness, phrase_caption_timing (UNMEASURED stub).
//   - hook_overlay_style: UNMEASURED stub at base level.
//
// Slide segments are reconstructed from the final composited mp4 +
// Whisper transcript — no per-slide pipeline metadata required.

import path from "path";
import { existsSync } from "fs";
import type { QAInput } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport, CostSummary } from "../schemas/qa-report.js";
import { emptyCostSummary, accumulateCost, deriveVerdict } from "../schemas/qa-report.js";
import type { DimensionResult, DimensionCall } from "../schemas/qa-dimension.js";

import { probeDurationSeconds } from "../../lib/qa-helpers.js";
import {
  extractAudioMp3,
  whisperTranscribe,
  priceWhisperCall,
} from "../../lib/qa-helpers.js";
import { detectSlideSegments } from "../base/helpers/slide-segmentation.js";

import { runWatermarkCompliance } from "../dimensions/base/watermark-compliance.js";
import { runAudioIntegrityFinal } from "../dimensions/base/audio-integrity-final.js";
import { runCaptionLegibility } from "../dimensions/base/caption-legibility.js";
import { runColorFilterConsistency } from "../dimensions/base/color-filter-consistency.js";
import { runTransitionStyleVerification } from "../dimensions/base/transition-style-verification.js";
import { runHookOverlayStyle } from "../dimensions/base/hook-overlay-style.js";

import { runBRollRelevance } from "../dimensions/moving-images/b-roll-relevance.js";
import { runImageCoherence } from "../dimensions/moving-images/image-coherence.js";
import { runKenBurnsSmoothness } from "../dimensions/moving-images/ken-burns-smoothness.js";
import { runPhraseCaptionTiming } from "../dimensions/moving-images/phrase-caption-timing.js";

export async function runMovingImagesQA(input: QAInput): Promise<QAReport> {
  const ranAt = new Date().toISOString();
  const rules = input.profile_config.qa_rules;
  const inScope = new Set(rules.in_scope_dimensions);
  const unmeasured = new Set(rules.unmeasured_dimensions);
  const gated = new Set(rules.gated_dimensions ?? []);

  // Probe duration + extract audio + Whisper-transcribe once — shared by
  // audio_integrity_final, slide segmentation, b_roll_relevance, etc.
  const duration = probeDurationSeconds(input.asset_path);
  const audioPath = path.join(input.workdir, "mi-final-audio.mp3");
  extractAudioMp3(input.asset_path, audioPath);
  const whisper = await whisperTranscribe(audioPath);
  const whisperCost = priceWhisperCall(whisper.duration);
  const whisperCalls: DimensionCall[] = [{
    service: "openai_whisper",
    model: "whisper-1",
    audio_seconds: whisper.duration,
    cost_usd: whisperCost,
  }];

  // Slide segmentation — reconstruct slide windows from frame-diff.
  const segments = (inScope.has("b_roll_relevance") || inScope.has("image_coherence"))
    ? await detectSlideSegments({
        asset_path: input.asset_path,
        duration_s: duration,
        whisper_words: whisper.words,
        workdir: input.workdir,
      })
    : [];

  const dimensions: DimensionResult[] = [];

  // Base dims that apply to moving-images, in parallel.
  const baseResults = await Promise.all([
    inScope.has("watermark_compliance")
      ? runWatermarkCompliance({ asset_path: input.asset_path, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("audio_integrity_final")
      // We've already run Whisper — synthesize the dimension result inline
      // rather than re-transcribing. Keeps audio costs to a single call.
      ? Promise.resolve<DimensionResult>({
          name: "audio_integrity_final",
          status: whisper.duration > 0 && whisper.words.length > 0 ? "PASS" : "FAIL",
          details: whisper.duration > 0 && whisper.words.length > 0
            ? `1 audio stream, ${whisper.duration.toFixed(1)}s transcribed (${whisper.words.length} words). No expected concatenated script provided — WER check skipped; stream + non-empty audio confirmed.`
            : `audio empty or unreadable (duration=${whisper.duration}s, words=${whisper.words.length})`,
          evidence: [`transcript: "${whisper.text.trim().slice(0, 200)}${whisper.text.length > 200 ? "..." : ""}"`],
          call_costs: whisperCalls,
        })
      : Promise.resolve(null),
    inScope.has("caption_legibility")
      ? runCaptionLegibility({ asset_path: input.asset_path, profile_config: input.profile_config, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("color_filter_consistency")
      ? runColorFilterConsistency({ asset_path: input.asset_path, profile_config: input.profile_config, clips: input.clips, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("transition_style_verification")
      ? runTransitionStyleVerification({ asset_path: input.asset_path, profile_config: input.profile_config, clips: input.clips, workdir: input.workdir })
      : Promise.resolve(null),
  ]);
  for (const r of baseResults) if (r) dimensions.push(r);

  // hook_overlay_style — declared UNMEASURED.
  if (unmeasured.has("hook_overlay_style")) {
    dimensions.push(await runHookOverlayStyle({ profile_config: input.profile_config }));
  }

  // Moving Images dims — parallel where independent.
  const miResults = await Promise.all([
    inScope.has("b_roll_relevance")
      ? runBRollRelevance({ segments })
      : Promise.resolve(null),
    inScope.has("image_coherence")
      ? runImageCoherence({ segments })
      : Promise.resolve(null),
    inScope.has("ken_burns_smoothness")
      ? runKenBurnsSmoothness({ asset_path: input.asset_path, workdir: input.workdir })
      : Promise.resolve(null),
  ]);
  for (const r of miResults) if (r) dimensions.push(r);

  // phrase_caption_timing — declared UNMEASURED on moving-images per
  // migration 20260519110000.
  if (unmeasured.has("phrase_caption_timing")) {
    dimensions.push(await runPhraseCaptionTiming());
  }

  // Gated-dimension remap (none on moving-images today, but the logic is
  // identical to avatar-full and is generic enough to live here in case
  // we gate dims on this profile later).
  for (const d of dimensions) {
    if (d.status === "FAIL" && gated.has(d.name)) {
      d.details = `[GATED — declared output_spec is awaiting human approval of a manual update; this FAIL is reclassified UNMEASURED until the gate is cleared] ${d.details}`;
      d.status = "UNMEASURED";
    }
  }

  // Cost aggregation.
  const cost: CostSummary = emptyCostSummary();
  for (const d of dimensions) {
    if (d.call_costs && d.call_costs.length > 0) accumulateCost(cost, d.name, d.call_costs);
  }

  const verdict = deriveVerdict(dimensions);
  const unmeasuredNames = dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name);
  const humanReviewRequired = input.profile_config.qa_stability.state !== "decisional";

  return {
    asset_id: input.asset_id,
    asset_path: input.asset_path,
    render_profile_slug: input.profile_config.slug,
    render_profile_variant: input.variant,
    agent_version: AGENT_VERSION.moving_images,
    ran_at: ranAt,
    dimensions,
    overall_verdict: verdict,
    human_review_required: humanReviewRequired,
    unmeasured_dimensions: unmeasuredNames,
    cost_summary: cost,
  };
}
