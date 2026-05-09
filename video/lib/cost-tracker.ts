// Cost tracking — logs every API call to Supabase cost_log table

import { createClient } from "@supabase/supabase-js";

let supabase: ReturnType<typeof createClient> | null = null;
function getClient() {
  const url = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabase && key) supabase = createClient(url, key);
  return supabase;
}

const sessionCosts: { service: string; model: string; cost: number }[] = [];

export async function logCost(
  contentId: string,
  service: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costUsd: number,
) {
  sessionCosts.push({ service, model, cost: costUsd });

  const client = getClient();
  if (!client) return;

  await client.from("cost_log").insert({
    pipeline_stage: "video_generation_v2",
    content_id: contentId,
    service,
    model,
    input_tokens: tokensIn,
    output_tokens: tokensOut,
    cost_usd: costUsd,
  }).then(() => {}, () => {}); // swallow errors — cost logging shouldn't break pipeline
}

export function getSessionCosts(): { breakdown: typeof sessionCosts; total: number } {
  return {
    breakdown: sessionCosts,
    total: sessionCosts.reduce((sum, c) => sum + c.cost, 0),
  };
}
