// Load a render_profiles row (with the PR 0 schema additions) from Supabase
// at QA runtime.

import { createClient } from "@supabase/supabase-js";
import type { RenderProfileConfig } from "../qa-contract.js";

let client: ReturnType<typeof createClient> | null = null;
function supabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set — required to load render_profiles config");
  client = createClient(url, key);
  return client;
}

export async function loadProfileConfig(slug: string): Promise<RenderProfileConfig> {
  const sb = supabase();
  const { data, error } = await sb
    .from("render_profiles")
    .select("slug,status,output_spec,qa_rules,qa_stability")
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`loadProfileConfig(${slug}): ${error.message}`);
  if (!data) throw new Error(`loadProfileConfig(${slug}): no row`);

  const row = data as unknown as RenderProfileConfig;

  // Defensive: the PR 0 migration adds these keys to every row. If a key is
  // missing here, either the migration hasn't been applied or someone wrote
  // a new render_profiles row without the QA spec — surface clearly rather
  // than failing deep inside a dimension.
  const missing: string[] = [];
  if (!row.output_spec?.filter_setting) missing.push("output_spec.filter_setting");
  if (!row.output_spec?.transition_style) missing.push("output_spec.transition_style");
  if (!row.qa_rules?.in_scope_dimensions) missing.push("qa_rules.in_scope_dimensions");
  if (!row.qa_stability?.state) missing.push("qa_stability.state");
  if (missing.length > 0) {
    throw new Error(`loadProfileConfig(${slug}): row missing required keys: ${missing.join(", ")}. Has the qa_agents_per_profile_schema migration been applied?`);
  }
  return row;
}
