/**
 * SMT Cost Logger — single source of truth for AI service pricing.
 *
 * Logs every external API call to the cost_log table in Supabase.
 * Used by: research.js, content.js, image-gen.js, learning.js
 */

// Pricing per model (updated April 2026)
export const PRICING = {
  // Anthropic (per million tokens)
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },

  // OpenAI DALL-E 3 (per image, HD quality)
  'dall-e-3-1024x1024-hd': { per_image: 0.080 },
  'dall-e-3-1024x1792-hd': { per_image: 0.120 },

  // Apify (per run, approximate — refine from actual billing)
  'apify-reddit': { per_run: 0.05 },
  'apify-tiktok': { per_run: 0.10 },
  'apify-google-trends': { per_run: 0.05 },
  'apify/default': { per_run: 0.05 },
};

export function calculateCost(model, inputTokens = 0, outputTokens = 0) {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  if (pricing.per_image) return pricing.per_image;
  if (pricing.per_run) return pricing.per_run;

  // Token-based pricing (per million tokens)
  return (inputTokens * pricing.input / 1_000_000) + (outputTokens * pricing.output / 1_000_000);
}

export async function logCost(supabase, {
  pipeline_stage,
  service,
  model,
  input_tokens = 0,
  output_tokens = 0,
  content_id = null,
  briefing_id = null,
  description = null,
  metadata = {},
}) {
  const cost_usd = calculateCost(model, input_tokens, output_tokens);

  const { error } = await supabase.from('cost_log').insert({
    pipeline_stage,
    service,
    model,
    input_tokens,
    output_tokens,
    cost_usd,
    content_id,
    briefing_id,
    description,
    metadata,
  });

  if (error) {
    console.error(`[CostLog] Failed to log cost: ${error.message}`);
  } else {
    console.log(`[CostLog] ${pipeline_stage}/${service}/${model}: $${cost_usd.toFixed(4)}`);
  }

  return cost_usd;
}

export async function printCostSummary(supabase, label = 'this run') {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('cost_log')
      .select('pipeline_stage, cost_usd')
      .gte('created_at', today);

    if (!data || data.length === 0) {
      console.log(`\n[Cost] No costs logged today.`);
      return;
    }

    const total = data.reduce((sum, c) => sum + parseFloat(c.cost_usd), 0);
    const breakdown = data.reduce((acc, c) => {
      acc[c.pipeline_stage] = (acc[c.pipeline_stage] || 0) + parseFloat(c.cost_usd);
      return acc;
    }, {});

    console.log(`\n[Cost] Total today: $${total.toFixed(4)}`);
    console.log(`[Cost] Breakdown: ${JSON.stringify(
      Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, `$${v.toFixed(4)}`]))
    )}`);
  } catch (err) {
    console.warn(`[Cost] Summary failed: ${err.message}`);
  }
}
