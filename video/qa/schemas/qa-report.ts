import type { DimensionResult, DimensionCall } from "./qa-dimension.js";

export type QAVerdict = "PASS" | "FAIL" | "PARTIAL";

// The structured result a per-profile QA agent returns. PARTIAL is the
// verdict when at least one dimension is UNMEASURED — we never claim PASS
// while there's an in-spec dimension we couldn't measure.
//
// human_review_required is true whenever qa_stability.state == 'informational'
// in render_profiles. The agent NEVER decides it can be flipped off; that's
// a manual flip per the 5-approvals-over-2-weeks gate.
export type QAReport = {
  asset_id: string | null;
  asset_path: string;
  render_profile_slug: string;
  render_profile_variant: string | null; // e.g. avatar_config.format
  agent_version: string;
  ran_at: string; // ISO8601
  dimensions: DimensionResult[];
  overall_verdict: QAVerdict;
  human_review_required: boolean;
  unmeasured_dimensions: string[];
  cost_summary: CostSummary;
};

export type CostSummary = {
  total_usd: number;
  by_service: Record<string, { calls: number; cost_usd: number }>;
  by_dimension: Record<string, { calls: number; cost_usd: number }>;
  retries: number;
  notes: string[];
};

export function emptyCostSummary(): CostSummary {
  return { total_usd: 0, by_service: {}, by_dimension: {}, retries: 0, notes: [] };
}

export function accumulateCost(
  summary: CostSummary,
  dimensionName: string,
  calls: DimensionCall[],
): void {
  for (const c of calls) {
    summary.total_usd += c.cost_usd;
    summary.by_service[c.service] ??= { calls: 0, cost_usd: 0 };
    summary.by_service[c.service].calls += 1;
    summary.by_service[c.service].cost_usd += c.cost_usd;
    summary.by_dimension[dimensionName] ??= { calls: 0, cost_usd: 0 };
    summary.by_dimension[dimensionName].calls += 1;
    summary.by_dimension[dimensionName].cost_usd += c.cost_usd;
  }
}

// Derive overall verdict from dimension results.
//
// Rules (no PASS while any in-spec dim is UNMEASURED — promotes to PARTIAL):
//   - Any FAIL  => FAIL
//   - Else any UNMEASURED  => PARTIAL
//   - Else  => PASS
export function deriveVerdict(dimensions: DimensionResult[]): QAVerdict {
  if (dimensions.some(d => d.status === "FAIL")) return "FAIL";
  if (dimensions.some(d => d.status === "UNMEASURED")) return "PARTIAL";
  return "PASS";
}
