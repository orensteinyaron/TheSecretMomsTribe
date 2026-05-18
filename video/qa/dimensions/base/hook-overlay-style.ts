// hook_overlay_style — declared UNMEASURED for now per render_profiles
// migration. SMTHookOverlay.tsx is being built in the v3 Claude Code work
// and is not yet on main. When v3 merges, this dimension implementation
// graduates from UNMEASURED to an OCR-based check (see README §dimension
// graduation pathway and the B3 reframe in the PR 1 critique).

import type { DimensionResult } from "../../schemas/qa-dimension.js";
import type { RenderProfileConfig } from "../../base/qa-contract.js";

export async function runHookOverlayStyle(input: {
  profile_config: RenderProfileConfig;
}): Promise<DimensionResult> {
  const ho = input.profile_config.output_spec.hook_overlay;
  return {
    name: "hook_overlay_style",
    status: "UNMEASURED",
    details: ho?.exists === true
      ? `hook_overlay declared as present (component_path=${ho.component_path}) but the dimension implementation has not graduated yet — OCR-based check lands after v3 merge.`
      : `hook_overlay.exists=false on profile ${input.profile_config.slug}. Once SMTHookOverlay.tsx lands on main and this row's hook_overlay.exists is flipped to true, the dimension graduates via a single SQL UPDATE (no code change). Tracked under YAR-129.`,
  };
}
