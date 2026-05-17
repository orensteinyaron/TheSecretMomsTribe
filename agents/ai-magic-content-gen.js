/**
 * SMT AI Magic Content Gen
 *
 * Stage 3 of the AI Magic pipeline. Runs daily at 04:00 UTC.
 *
 *   ai_magic_opportunities (status='pending')
 *     → ai-magic-content-gen (this agent)
 *       → content_queue (content_pillar='ai_magic', status='draft_needs_review')
 *
 * For each pending opportunity (highest selected_score first, max 2/day):
 *   1. Hard-reject if original_prompt or original_output is empty.
 *      Mark opportunity status='skipped' and continue.
 *   2. Call Sonnet to write an SMT post that showcases the verbatim
 *      prompt + output. Voice: friend in the group chat.
 *   3. Insert into content_queue with content_pillar='ai_magic',
 *      render profile mapped from suggested_format.
 *   4. Mark opportunity status='used', store content_queue_id.
 *
 * Daily budget: $0.20. Pre-flight aborts if exceeded.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *     node agents/ai-magic-content-gen.js
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logCost } from '../scripts/utils/cost-logger.js';
import { startAgentRun, finishAgentRun, getRunCost } from './lib/agent_run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---

const PIPELINE_STAGE = 'content_gen_ai_magic';
const DAILY_BUDGET_USD = 0.20;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const MAX_PIECES_PER_RUN = 2;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

let run = { runId: null, owned: false };

// --- Format mapping ---
//
// suggested_format (from curator) → render_profiles.slug.
// v2.0.0 (CHANNEL_MODEL_V1): post_format is dropped; render_profile_slug
// is the source of truth.

const SUGGESTED_TO_PROFILE_SLUG = {
  'moving-images': 'moving-images',
  'carousel': 'carousel',
  'static': 'static-image',
};

// --- DNA loader ---

function loadDNA() {
  const promptsDir = resolve(__dirname, '../prompts');
  const brandVoice = readFileSync(resolve(promptsDir, 'brand-voice.md'), 'utf-8');
  const contentDNA = readFileSync(resolve(promptsDir, 'content-dna.md'), 'utf-8');
  console.log(`[ContentGen] Loaded DNA: brand-voice (${brandVoice.length}), content-dna (${contentDNA.length})`);
  return { brandVoice, contentDNA };
}

// --- Budget guard ---

async function todaysSpend() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cost_log')
    .select('cost_usd')
    .eq('pipeline_stage', PIPELINE_STAGE)
    .gte('created_at', today);
  if (error) {
    console.warn(`[ContentGen] Failed to query today's spend: ${error.message}`);
    return 0;
  }
  return (data || []).reduce((sum, r) => sum + parseFloat(r.cost_usd || 0), 0);
}

// --- Inputs ---

async function fetchPendingOpportunities() {
  const { data, error } = await supabase
    .from('ai_magic_opportunities')
    .select('*')
    .eq('status', 'pending')
    .order('selected_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(MAX_PIECES_PER_RUN);

  if (error) {
    console.error(`[ContentGen] Failed to fetch opportunities: ${error.message}`);
    process.exit(1);
  }
  console.log(`[ContentGen] Fetched ${data?.length ?? 0} pending opportunities (cap: ${MAX_PIECES_PER_RUN})`);
  return data || [];
}

async function fetchRenderProfileMap() {
  const { data, error } = await supabase
    .from('render_profiles')
    .select('id, slug, name, profile_type, status');
  if (error) {
    console.warn(`[ContentGen] Failed to fetch render profiles: ${error.message}`);
    return {};
  }
  const map = {};
  for (const rp of data || []) map[rp.slug] = rp;
  return map;
}

// --- Status updates on opportunities ---

async function markSkipped(oppId, reason) {
  const { error } = await supabase
    .from('ai_magic_opportunities')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('id', oppId);
  if (error) {
    console.error(`[ContentGen] Failed to mark opportunity ${oppId} skipped: ${error.message}`);
    return;
  }
  console.warn(`[ContentGen] Opportunity ${oppId} skipped — ${reason}`);
}

async function markUsed(oppId, contentQueueId) {
  const { error } = await supabase
    .from('ai_magic_opportunities')
    .update({
      status: 'used',
      used_at: new Date().toISOString(),
      content_queue_id: contentQueueId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', oppId);
  if (error) {
    console.error(`[ContentGen] Failed to mark opportunity ${oppId} used: ${error.message}`);
  }
}

// --- Sonnet generation ---

function buildSystemPrompt(dna) {
  return `You write SMT (Secret Moms Tribe) posts that showcase real AI moments other creators already published. You do not invent prompts. You do not invent outputs. You curate and reframe.

THE FOLLOWING BRAND DOCUMENTS ARE THE LAW.

=== BRAND VOICE BIBLE ===
${dna.brandVoice}

=== CONTENT DNA FRAMEWORK ===
${dna.contentDNA}

## Hard Rules
- The prompt and the output appear WORD-FOR-WORD in at least one slide each. Never paraphrase the AI's words.
- Credit the creator in the caption (use @<handle> if known, otherwise "via <platform>").
- Voice: friend in the group chat who knows things first.
- Mix bias: 60% Wow / 30% Trust / 10% CTA — for AI Magic posts, default to Wow.
- If any of original_prompt / original_output / source_url is missing or empty, return {"error":"<reason>"} and DO NOT generate. Do not fabricate.

## Output schema (strict JSON)
{
  "hook": "0-3 sec, sharp, friend voice",
  "slides": [
    { "slide_number": 1, "type": "hook" | "content" | "cta", "text": "...", "image_prompt": "DALL-E prompt or null" }
  ],
  "caption": "platform-appropriate caption with creator credit",
  "hashtags": ["#tag1", "#tag2"],
  "ai_magic_output": {
    "original_prompt": "<verbatim, identical to input>",
    "original_output": "<verbatim, identical to input>",
    "creator": "<from input>",
    "platform": "<from input>",
    "source_url": "<from input>"
  }
}

Return ONLY the JSON object. No markdown fences, no commentary.`;
}

function buildUserPrompt(opp) {
  return `# Curated AI moment

source_url:        ${opp.source_url}
creator:           ${opp.creator || '(unknown)'}
platform:          ${opp.platform}
channel_type:      ${opp.channel_type}
suggested_format:  ${opp.suggested_format}
age_range:         ${opp.age_range || 'universal'}
mom_angle:         ${opp.mom_angle}

original_prompt (VERBATIM — must appear word-for-word in at least one slide):
"""
${opp.original_prompt}
"""

original_output (VERBATIM — must appear word-for-word in at least one slide):
"""
${opp.original_output}
"""

Write one SMT post. The render_profile will be derived from suggested_format:
- moving-images → moving-images render profile (4-6 slides total)
- carousel      → carousel render profile (5-7 slides total)
- static        → static-image render profile (1 hook slide + 1 content slide is fine)

Slide #1 must be the hook. Last slide must be the CTA. Put the verbatim prompt on its own slide and the verbatim output on its own slide (or split across consecutive slides if too long).

Caption rules: include creator credit (e.g. "via @${opp.creator || 'creator'} on ${opp.platform}"). Mention the source briefly. Keep it tight.

Return JSON only.`;
}

function validatePiece(piece, opp) {
  if (!piece || typeof piece !== 'object') throw new Error('not an object');
  if (piece.error) throw new Error(`Sonnet returned error: ${piece.error}`);

  if (!piece.hook || piece.hook.length < 5) throw new Error('missing/short hook');
  if (!Array.isArray(piece.slides) || piece.slides.length < 2) throw new Error('slides must be array of >=2');
  if (!piece.caption || piece.caption.length < 20) throw new Error('missing/short caption');
  if (!Array.isArray(piece.hashtags) || piece.hashtags.length < 3) throw new Error('hashtags must be array of >=3');
  if (!piece.ai_magic_output || typeof piece.ai_magic_output !== 'object') throw new Error('missing ai_magic_output object');

  // Verify verbatim prompt + output appear in at least one slide each
  const slideText = piece.slides.map((s) => s?.text || '').join('\n');
  if (!slideText.includes(opp.original_prompt.trim())) {
    throw new Error('verbatim original_prompt not found in any slide');
  }
  if (!slideText.includes(opp.original_output.trim())) {
    throw new Error('verbatim original_output not found in any slide');
  }

  // Re-anchor ai_magic_output verbatim fields to the input opportunity, regardless of what Sonnet produced
  piece.ai_magic_output = {
    original_prompt: opp.original_prompt,
    original_output: opp.original_output,
    creator: opp.creator || '',
    platform: opp.platform,
    source_url: opp.source_url,
  };

  // Normalize hashtags
  piece.hashtags = piece.hashtags.map((h) => (typeof h === 'string' && h.startsWith('#') ? h : `#${h}`));

  return piece;
}

async function generatePiece(opp, dna) {
  const systemPrompt = buildSystemPrompt(dna);
  const userPrompt = buildUserPrompt(opp);

  console.log(`[ContentGen] Calling Sonnet for opp ${opp.id} (${opp.suggested_format})...`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  await logCost(supabase, {
    pipeline_stage: PIPELINE_STAGE, service: 'anthropic', model: CLAUDE_MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    description: `AI Magic content gen — opp ${opp.id}`,
    metadata: { opportunity_id: opp.id, suggested_format: opp.suggested_format },
    agent_run_id: run.runId,
  });

  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let piece;
  try {
    piece = JSON.parse(text);
  } catch (err) {
    console.error('[ContentGen] Failed to parse Sonnet response:');
    console.error(text.slice(0, 500));
    throw new Error(`JSON parse failed: ${err.message}`);
  }

  return {
    piece: validatePiece(piece, opp),
    usage: msg.usage,
    systemPrompt,
    userPrompt,
  };
}

// --- Write content_queue ---

function buildAiMagicOutputText(structured) {
  return [
    'PROMPT (use it as-is):',
    structured.original_prompt,
    '',
    '---',
    '',
    `OUTPUT (verbatim from ${structured.creator ? '@' + structured.creator : 'source'} on ${structured.platform}):`,
    structured.original_output,
    '',
    '---',
    '',
    `Source: ${structured.source_url}`,
    `Credit: ${structured.creator ? '@' + structured.creator : '(no handle)'} via ${structured.platform}`,
  ].join('\n');
}

async function writeContentQueueRow(piece, opp, renderProfileMap, genMeta) {
  const profileSlug = SUGGESTED_TO_PROFILE_SLUG[opp.suggested_format] || 'static-image';
  const profile = renderProfileMap[profileSlug];

  const ai_magic_output_structured = piece.ai_magic_output;
  const ai_magic_output_text = buildAiMagicOutputText(ai_magic_output_structured);

  const sourceUrls = [{
    url: opp.source_url,
    source: opp.platform,
    creator: opp.creator || null,
  }];

  const generationContext = {
    model: genMeta.model,
    system_prompt: genMeta.systemPrompt,
    user_prompt: genMeta.userPrompt,
    opportunity_id: opp.id,
    signal_id: opp.signal_id,
    pillar_input: 'ai_magic',
    format_input: profileSlug,
    suggested_format: opp.suggested_format,
    channels: ['tiktok', 'instagram'],
    tokens_in: genMeta.usage?.input_tokens ?? 0,
    tokens_out: genMeta.usage?.output_tokens ?? 0,
    cost_usd: Number((genMeta.costUsd ?? 0).toFixed(6)),
    agent_run_id: run.runId,
    created_at: new Date().toISOString(),
    needs_review_reason: 'AI Magic curated piece — human review required before publish',
  };

  const row = {
    content_type: 'wow',
    status: 'draft_needs_review',
    hook: piece.hook,
    caption: piece.caption,
    hashtags: piece.hashtags,
    ai_magic_output: ai_magic_output_text,
    image_prompt: piece.slides?.[0]?.image_prompt || null,
    age_range: opp.age_range || 'universal',
    content_pillar: 'ai_magic',
    slides: piece.slides || [],
    image_status: 'pending',
    launch_bank: false,
    render_profile_id: profile?.id || null,
    render_status: profile ? 'pending' : null,
    source_urls: sourceUrls,
    generation_context: generationContext,
    metadata: {
      ai_magic_output: ai_magic_output_structured,
      ai_magic_opportunity_id: opp.id,
    },
  };

  const { data, error } = await supabase
    .from('content_queue')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('[ContentGen] Failed to insert content_queue row:', error);
    throw error;
  }
  console.log(`[ContentGen] content_queue id=${data.id} (render_profile=${profileSlug}${profile ? '' : ' MISSING'})`);

  // v2.0.0 (CHANNEL_MODEL_V1): insert scheduled_posts rows in 'pending' status
  // for the default channel set. Caption polish for this curated single-piece
  // path is intentionally deferred — the AI Magic agent generates one piece
  // at a time and a downstream batch job can run the polish step on
  // pending rows. For now, scheduled_posts.caption is null and the publish
  // agent falls back to content_queue.caption.
  const channels = ['tiktok', 'instagram'];
  const { error: spError } = await supabase
    .from('scheduled_posts')
    .insert(channels.map((channel) => ({
      content_id: data.id,
      channel,
      caption: null,
      status: 'pending',
    })));
  if (spError) {
    console.error(`[ContentGen] Failed to insert scheduled_posts for ${data.id}: ${spError.message}`);
  }

  return data.id;
}

// --- Main ---

async function processOpportunity(opp, dna, renderProfileMap) {
  // Hard reject — no fabrication path
  if (!opp.original_prompt || !opp.original_prompt.trim()) {
    await markSkipped(opp.id, 'original_prompt is null/empty');
    return { status: 'skipped', oppId: opp.id, reason: 'empty original_prompt' };
  }
  if (!opp.original_output || !opp.original_output.trim()) {
    await markSkipped(opp.id, 'original_output is null/empty');
    return { status: 'skipped', oppId: opp.id, reason: 'empty original_output' };
  }

  let genResult;
  try {
    genResult = await generatePiece(opp, dna);
  } catch (err) {
    console.error(`[ContentGen] Generation failed for opp ${opp.id}: ${err.message}`);
    await markSkipped(opp.id, `generation failed: ${err.message}`);
    return { status: 'skipped', oppId: opp.id, reason: err.message };
  }

  const { piece, usage, systemPrompt, userPrompt } = genResult;

  let contentQueueId;
  try {
    contentQueueId = await writeContentQueueRow(piece, opp, renderProfileMap, {
      model: CLAUDE_MODEL,
      systemPrompt,
      userPrompt,
      usage,
      costUsd: 0,
    });
  } catch (err) {
    await markSkipped(opp.id, `content_queue write failed: ${err.message}`);
    return { status: 'skipped', oppId: opp.id, reason: err.message };
  }

  await markUsed(opp.id, contentQueueId);
  return { status: 'used', oppId: opp.id, contentQueueId };
}

async function main() {
  console.log('[AI Magic Content Gen] Starting...');
  run = await startAgentRun(supabase, 'ai-magic-content-gen');
  const startTime = Date.now();

  const spent = await todaysSpend();
  if (spent >= DAILY_BUDGET_USD) {
    console.warn(`[ContentGen] Today's spend $${spent.toFixed(4)} >= budget $${DAILY_BUDGET_USD}. Aborting.`);
    return;
  }
  console.log(`[ContentGen] Today's spend so far: $${spent.toFixed(4)} (budget: $${DAILY_BUDGET_USD})`);

  const [opps, dna, renderProfileMap] = await Promise.all([
    fetchPendingOpportunities(),
    Promise.resolve(loadDNA()),
    fetchRenderProfileMap(),
  ]);

  if (opps.length === 0) {
    console.log('[ContentGen] No pending opportunities. Exiting.');
    return;
  }

  const results = [];
  for (const opp of opps) {
    // Mid-loop budget guard: stop if we've exceeded budget after the first piece
    const midSpent = await todaysSpend();
    if (midSpent >= DAILY_BUDGET_USD) {
      console.warn(`[ContentGen] Spend $${midSpent.toFixed(4)} reached budget mid-run. Stopping before opp ${opp.id}.`);
      break;
    }
    const r = await processOpportunity(opp, dna, renderProfileMap);
    results.push(r);
  }

  const used = results.filter((r) => r.status === 'used').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const finalSpent = await todaysSpend();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n[AI Magic Content Gen] Done in ${elapsed}s. Used: ${used}, Skipped: ${skipped}. Spend: $${finalSpent.toFixed(4)}.`);
  for (const r of results) {
    if (r.status === 'used') {
      console.log(`  used: opp=${r.oppId} → content_queue=${r.contentQueueId}`);
    } else {
      console.log(`  skipped: opp=${r.oppId} (${r.reason})`);
    }
  }
}

main()
  .then(async () => {
    await finishAgentRun(supabase, run, { status: 'completed' });
    if (run.runId) {
      const cost = await getRunCost(supabase, run.runId);
      console.log(`run=${run.runId} cost=$${cost.toFixed(4)}`);
    }
  })
  .catch(async (err) => {
    console.error('[AI Magic Content Gen] Fatal error:', err);
    await finishAgentRun(supabase, run, { status: 'failed', error: err?.message ?? String(err) });
    process.exit(1);
  });
