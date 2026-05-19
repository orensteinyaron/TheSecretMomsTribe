// Persist QA cost data to Supabase cost_log table for daily monitoring.
// One row per service-dimension pair per QA run. Pipeline stage is
// 'qa_v3' to distinguish from generation-time costs.

import { createClient } from "@supabase/supabase-js";
import type { QAReport } from "../schemas/qa-report.js";

let client: ReturnType<typeof createClient> | null = null;
function supabase() {
  const url = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!client && key) client = createClient(url, key);
  return client;
}

export async function persistCostLog(report: QAReport): Promise<void> {
  const sb = supabase();
  if (!sb) return; // cost logging is best-effort

  // One row per (service, dimension) combination. Each dimension's
  // call_costs already separate per service+model.
  const rows: any[] = [];
  for (const dim of report.dimensions) {
    if (!dim.call_costs || dim.call_costs.length === 0) continue;
    // Group calls within a dimension by service+model.
    const groups = new Map<string, { calls: number; cost_usd: number; input_tokens: number; output_tokens: number; audio_seconds: number; service: string; model: string }>();
    for (const c of dim.call_costs) {
      const key = `${c.service}:${c.model}`;
      const g = groups.get(key) ?? { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0, service: c.service, model: c.model };
      g.calls += 1;
      g.cost_usd += c.cost_usd;
      g.input_tokens += c.input_tokens ?? 0;
      g.output_tokens += c.output_tokens ?? 0;
      g.audio_seconds += c.audio_seconds ?? 0;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      rows.push({
        pipeline_stage: "qa_v3",
        content_id: report.asset_id,
        service: g.service,
        model: g.model,
        input_tokens: g.input_tokens || null,
        output_tokens: g.output_tokens || null,
        cost_usd: g.cost_usd,
      });
    }
  }
  if (rows.length === 0) return;
  // Cast: Supabase typed-table inference resolves to never in this template
  // setup since we haven't generated DB types here. Existing cost-tracker.ts
  // hits the same pattern.
  await (sb.from("cost_log") as any).insert(rows).then(() => {}, () => {});
}
