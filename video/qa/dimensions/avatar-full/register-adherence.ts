// register_adherence — UNMEASURED stub. The register concept
// (concerned_insider / neutral_warm / excited_discovery / dry_reflective) is
// defined in YAR-129 but is gated on a content-strategy-level decision:
// avatar_config.register doesn't exist as a column yet, and ContentGen does
// not yet emit it. Once both ship, this dimension graduates from UNMEASURED
// to a Haiku-driven enumerated-marker check (lean-in posture, brow position,
// hand positioning, etc.) per the B5 reframe in the PR 1 critique.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runRegisterAdherence(): Promise<DimensionResult> {
  return {
    name: "register_adherence",
    status: "UNMEASURED",
    details: "register_adherence requires avatar_config.register to be populated upstream. The register schema and ContentGen rules are still pending validation per YAR-129. When both land, this dimension graduates to a Haiku enumerated-marker check (lean-in posture, brow position, controlled hand positioning, etc.) and flips from UNMEASURED via a single SQL UPDATE on render_profiles.qa_rules.",
  };
}
