// Ask Rachel variant agent. Inherits Avatar Full baseline + adds
// two_voice_presence and turn_taking_alignment per
// qa_rules.variants.ask_rachel.add_to_in_scope (migration 20260519120000).

import type { QAInput, RenderProfileConfig } from "../base/qa-contract.js";
import { AGENT_VERSION } from "../base/qa-contract.js";
import type { QAReport } from "../schemas/qa-report.js";
import type { DimensionResult } from "../schemas/qa-dimension.js";
import { runAvatarFullQA } from "./avatar-full.js";
import { runTwoVoicePresence } from "../dimensions/ask-rachel/two-voice-presence.js";
import { runTurnTakingAlignment } from "../dimensions/ask-rachel/turn-taking-alignment.js";

function applyVariantOverrides(cfg: RenderProfileConfig, variantKey: string): RenderProfileConfig {
  const variant = cfg.qa_rules.variants?.[variantKey];
  if (!variant) return cfg;
  const additions = variant.add_to_in_scope ?? [];
  const newInScope = Array.from(new Set([...cfg.qa_rules.in_scope_dimensions, ...additions]));
  const newOutOfScope = cfg.qa_rules.out_of_scope_dimensions.filter(d => !additions.includes(d));
  return {
    ...cfg,
    qa_rules: { ...cfg.qa_rules, in_scope_dimensions: newInScope, out_of_scope_dimensions: newOutOfScope },
  };
}

export async function runAskRachelQA(input: QAInput): Promise<QAReport> {
  const patchedConfig = applyVariantOverrides(input.profile_config, "ask_rachel");
  const baseline = await runAvatarFullQA({ ...input, profile_config: patchedConfig, variant: "ask_rachel" });

  const variantDims: DimensionResult[] = [];
  if (patchedConfig.qa_rules.in_scope_dimensions.includes("two_voice_presence")) {
    variantDims.push(await runTwoVoicePresence());
  }
  if (patchedConfig.qa_rules.in_scope_dimensions.includes("turn_taking_alignment")) {
    variantDims.push(await runTurnTakingAlignment());
  }

  const dimensions = [...baseline.dimensions, ...variantDims];
  const { deriveVerdict } = await import("../schemas/qa-report.js");
  return {
    ...baseline,
    agent_version: AGENT_VERSION.ask_rachel,
    dimensions,
    overall_verdict: deriveVerdict(dimensions),
    unmeasured_dimensions: dimensions.filter(d => d.status === "UNMEASURED").map(d => d.name),
  };
}
