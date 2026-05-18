// Avatar Full profile agent. Composes the 7 base dimensions + 5 avatar-
// specific dimensions + 3 UNMEASURED stubs into a single QAReport.
//
// Frame extraction is centralized here: start/middle/end frames per raw
// clip are extracted once and shared across identity_consistency,
// identity_markers, hand_naturalism, wardrobe_setting_continuity, and
// cross_clip_drift.

import path from "path";
import { existsSync } from "fs";
import type { QAInput } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport, CostSummary } from "../schemas/qa-report.js";
import { emptyCostSummary, accumulateCost, deriveVerdict } from "../schemas/qa-report.js";
import type { DimensionResult } from "../schemas/qa-dimension.js";
import { downloadFile, probeDurationSeconds } from "../../lib/qa-helpers.js";
import { extractFrameTo, startMiddleEnd } from "../base/helpers/frame-sampling.js";

import { runWatermarkCompliance } from "../dimensions/base/watermark-compliance.js";
import { runAudioIntegrityRawClips } from "../dimensions/base/audio-integrity-raw-clips.js";
import { runAudioIntegrityFinal } from "../dimensions/base/audio-integrity-final.js";
import { runCaptionLegibility } from "../dimensions/base/caption-legibility.js";
import { runColorFilterConsistency } from "../dimensions/base/color-filter-consistency.js";
import { runTransitionStyleVerification } from "../dimensions/base/transition-style-verification.js";
import { runHookOverlayStyle } from "../dimensions/base/hook-overlay-style.js";

import { runIdentityConsistency, type ClipFrames } from "../dimensions/avatar-full/identity-consistency.js";
import { runIdentityMarkers } from "../dimensions/avatar-full/identity-markers.js";
import { runHandNaturalism } from "../dimensions/avatar-full/hand-naturalism.js";
import { runWardrobeSettingContinuity } from "../dimensions/avatar-full/wardrobe-setting-continuity.js";
import { runCrossClipDrift } from "../dimensions/avatar-full/cross-clip-drift.js";
import { runLipSync } from "../dimensions/avatar-full/lip-sync.js";
import { runRegisterAdherence } from "../dimensions/avatar-full/register-adherence.js";

async function ensureClipLocal(clipId: string, urlOrPath: string | undefined, workdir: string): Promise<string> {
  if (!urlOrPath) throw new Error(`clip ${clipId}: neither local_path nor url present`);
  if (existsSync(urlOrPath)) return urlOrPath;
  const dest = path.join(workdir, `clip-${clipId}.mp4`);
  if (!existsSync(dest)) await downloadFile(urlOrPath, dest);
  return dest;
}

async function extractClipFrames(input: QAInput): Promise<ClipFrames[]> {
  if (!input.clips) return [];
  const out: ClipFrames[] = [];
  for (const clip of input.clips) {
    const localPath = await ensureClipLocal(clip.id, clip.local_path ?? clip.url, input.workdir);
    clip.local_path = localPath;
    const dur = probeDurationSeconds(localPath);
    const [t0, t1, t2] = startMiddleEnd(dur);
    const frames: [string, string, string] = [
      extractFrameTo(localPath, t0, input.workdir, `f-${clip.id}-start`),
      extractFrameTo(localPath, t1, input.workdir, `f-${clip.id}-mid`),
      extractFrameTo(localPath, t2, input.workdir, `f-${clip.id}-end`),
    ];
    out.push({ clip_id: clip.id, frame_paths: frames });
  }
  return out;
}

export async function runAvatarFullQA(input: QAInput): Promise<QAReport> {
  const ranAt = new Date().toISOString();

  // Pre-extract frames so dimensions share them.
  const clipFrames = await extractClipFrames(input);

  // Reference image must already be local (entry point handles download).
  if (!input.reference_image_path) {
    throw new Error("runAvatarFullQA: input.reference_image_path required for identity dimensions");
  }

  const rules = input.profile_config.qa_rules;
  const inScope = new Set(rules.in_scope_dimensions);
  const unmeasured = new Set(rules.unmeasured_dimensions);

  const dimensions: DimensionResult[] = [];

  // Helper: run a dimension only if it's in_scope. If unmeasured, emit the
  // UNMEASURED stub directly (using each dim's own stub function for
  // declared-unmeasured dims — keeps the messaging consistent with the
  // dimension's own knowledge of why it's not measured).
  async function maybeRun(dimName: string, run: () => Promise<DimensionResult>): Promise<void> {
    if (inScope.has(dimName)) {
      try {
        dimensions.push(await run());
      } catch (e: any) {
        dimensions.push({
          name: dimName,
          status: "FAIL",
          details: `dimension threw: ${e?.message ?? String(e)}`,
        });
      }
    } else if (unmeasured.has(dimName)) {
      // Use the dim's own UNMEASURED-aware implementation (it knows why it
      // can't measure). Avoids re-stating the reason here.
      try {
        dimensions.push(await run());
      } catch (e: any) {
        dimensions.push({
          name: dimName,
          status: "UNMEASURED",
          details: `declared UNMEASURED in profile.qa_rules; dimension stub threw: ${e?.message ?? String(e)}`,
        });
      }
    }
    // Out-of-scope: silently skip.
  }

  // Base dims — run in parallel where independent; audio dims can run
  // alongside vision dims.
  const baseResults = await Promise.all([
    inScope.has("watermark_compliance")
      ? runWatermarkCompliance({ asset_path: input.asset_path, workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("audio_integrity_raw_clips")
      ? runAudioIntegrityRawClips({ clips: input.clips ?? [], workdir: input.workdir })
      : Promise.resolve(null),
    inScope.has("audio_integrity_final")
      ? runAudioIntegrityFinal({ asset_path: input.asset_path, workdir: input.workdir, clips: input.clips })
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

  // hook_overlay_style — base-level UNMEASURED stub.
  await maybeRun("hook_overlay_style", () => runHookOverlayStyle({ profile_config: input.profile_config }));

  // Avatar-specific vision dims — run in parallel.
  const avatarResults = await Promise.all([
    inScope.has("identity_consistency")
      ? runIdentityConsistency({ reference_image_path: input.reference_image_path, clip_frames: clipFrames })
      : Promise.resolve(null),
    inScope.has("identity_markers")
      ? runIdentityMarkers({ reference_image_path: input.reference_image_path, clip_frames: clipFrames })
      : Promise.resolve(null),
    inScope.has("hand_naturalism")
      ? runHandNaturalism({ clip_frames: clipFrames })
      : Promise.resolve(null),
    inScope.has("wardrobe_setting_continuity")
      ? runWardrobeSettingContinuity({ clip_frames: clipFrames })
      : Promise.resolve(null),
    inScope.has("cross_clip_drift") || inScope.has("identity_consistency")
      ? runCrossClipDrift({ reference_image_path: input.reference_image_path, clip_frames: clipFrames })
      : Promise.resolve(null),
  ]);
  for (const r of avatarResults) if (r) dimensions.push(r);

  // UNMEASURED stubs.
  await maybeRun("lip_sync", () => runLipSync());
  await maybeRun("register_adherence", () => runRegisterAdherence());

  // Cost aggregation.
  const cost: CostSummary = emptyCostSummary();
  for (const d of dimensions) {
    if (d.call_costs && d.call_costs.length > 0) accumulateCost(cost, d.name, d.call_costs);
  }

  const verdict = deriveVerdict(dimensions);
  const unmeasuredNames = dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name);

  // human_review_required: always true while profile is informational. Memory
  // rule 29 — automated PASS without human review is worthless during
  // stabilization. The agent doesn't decide this.
  const humanReviewRequired = input.profile_config.qa_stability.state !== "decisional";

  return {
    asset_id: input.asset_id,
    asset_path: input.asset_path,
    render_profile_slug: input.profile_config.slug,
    render_profile_variant: input.variant,
    agent_version: AGENT_VERSION.avatar_full,
    ran_at: ranAt,
    dimensions,
    overall_verdict: verdict,
    human_review_required: humanReviewRequired,
    unmeasured_dimensions: unmeasuredNames,
    cost_summary: cost,
  };
}
