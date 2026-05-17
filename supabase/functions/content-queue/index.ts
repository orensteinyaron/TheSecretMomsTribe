// SMT content-queue Edge Function — unified read/write surface for the pipeline.
//
// v2.0.0 — CHANNEL_MODEL_V1 (docs/specs/CHANNEL_MODEL_V1.md).
//
// Format = render_profile_id (FK → render_profiles).
// Per-channel state lives in `scheduled_posts` (one row per (content_id, channel)),
// NOT in inline `scheduled_at_ig` / `scheduled_at_tt` / `published_at_ig` /
// `published_at_tt` / `published_url_ig` / `published_url_tt` / `channel_override`
// columns. Those legacy columns are slated for drop in migration 4 — do not read
// or write them.
//
// Supports two routing styles in the same function:
//   1. Legacy query-param routes (existing app code): GET ?tab=, ?id=, ?search=,
//      ?resource=render_queue; PATCH { id, ... }; POST { action: 'bulk_approve' |
//      'bulk_reject' | 'trigger_render' | 'feedback', ... }.
//   2. PIECE_PAGE_LIFECYCLE_V1 §6 path-based routes:
//        GET    /pieces/:id                                      → full payload
//        GET    /pieces/:id/prompt-chain                         → prompt_executions
//        GET    /pieces/:id/render-output                        → render fields
//        GET    /pieces/:id/metrics                              → metrics + series
//        PATCH  /pieces/:id/channels/:channel/schedule           → schedule a channel
//        PATCH  /pieces/:id/channels/:channel/status             → update channel status
//        PATCH  /pieces/:id/pillar                               → reassign pillar
//        POST   /pieces/:id/regenerate-from-step                 → mark + enqueue
//
//      GONE (410):
//        PATCH  /pieces/:id/schedule                             → see /channels/:channel/schedule
//
// JWT disabled — internal tool traffic, service role via secrets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const VALID_PILLARS = new Set([
  "parenting", "health", "ai_magic", "tech", "trending", "financial", "uncategorized",
]);

// CHANNEL_MODEL_V1 — mirror of agents/lib/channels.js. The Edge function runs
// under Deno, so we can't import the Node ESM module directly; keep the
// constants in lockstep with that file.
const CHANNELS = ['tiktok', 'instagram'] as const;
const SCHEDULED_POST_STATUSES = ['pending','scheduled','posted','failed','skipped'] as const;
type Channel = typeof CHANNELS[number];
type ScheduledPostStatus = typeof SCHEDULED_POST_STATUSES[number];

function isValidChannel(s: string): s is Channel {
  return (CHANNELS as readonly string[]).includes(s);
}
function isValidStatus(s: string): s is ScheduledPostStatus {
  return (SCHEDULED_POST_STATUSES as readonly string[]).includes(s);
}

// Supabase PostgREST embed string used by every "return a piece" handler.
// Joins the singular render_profile and the array of per-channel scheduled_posts.
const PIECE_EMBED =
  "*, render_profile:render_profiles(id, slug, name), scheduled_posts(*)";

const STEP_ORDER_BY_NAME: Record<string, number> = {
  content_gen: 1, batch_generation: 1,
  slide_parser: 2, media_query_gen: 3, media_screening: 4, tts_script_prep: 5,
  qa_evaluation: 6, qa_visual_review: 6, qa_audio_review: 6, qa_content_match: 6,
  image_prompt_gen: 2, avatar_script_prep: 2, interviewer_prompt_gen: 3, magic_prompt_extract: 2,
  // Avatar Full pipeline phases — added so REGENABLE_STEPS accepts them.
  // Sourced from the canonical chain in docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md §6.
  tts_generation: 3, whisper_transcription: 4, seedance_render: 5,
  qa_avatar: 6, hook_card_render: 7, stitch: 8,
};
const REGENABLE_STEPS = new Set(Object.keys(STEP_ORDER_BY_NAME));

// Tab presets for the pipeline list view.
// 'review' covers any draft awaiting human action, including the V1.1
// 'draft_needs_review' status (pillar fallback).
const TAB_STATUS_MAP: Record<string, string[]> = {
  all:      [],
  review:   ["draft", "pending_approval", "draft_needs_review"],
  approved: ["approved"],
  rejected: ["rejected"],
  ready:    ["approved"], // render-complete filter applied separately
};

// ---------- helpers ----------

function json(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function err(message: string, status = 400) { return json({ error: message }, status); }

function stripPrefix(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "content-queue") return "/" + parts.slice(1).join("/");
  return pathname;
}

type Sb = ReturnType<typeof createClient>;

function safeRate(num?: number | null, denom?: number | null): number | null {
  if (num == null || !denom || denom === 0) return null;
  return Number((Number(num) / Number(denom)).toFixed(6));
}

function engagementRate(snap: any): number | null {
  if (!snap) return null;
  const denom = snap.reach ?? snap.views;
  if (!denom) return null;
  const num = (Number(snap.likes) || 0) + (Number(snap.comments) || 0) + (Number(snap.shares) || 0) + (Number(snap.saves) || 0);
  if (num === 0) return 0;
  return Number((num / Number(denom)).toFixed(6));
}

// Drive URLs are the production storage contract for any content rendered via the
// content-lifecycle persist pipeline (see skills/content-lifecycle/SKILL.md and
// video/scripts/content-lifecycle.ts:305 — that script writes Drive webViewLink URLs
// to content_queue.final_asset_url). Do NOT lock these out at write time. Drive
// `/file/d/<id>/view` URLs are not embeddable as <img src> or <video src> directly,
// so we rewrite them here for embed context: /preview for iframe video, lh3 for img.
// The legacy orchestrator pipeline writes Supabase Storage URLs which embed natively
// — that branch stays unchanged.
//
// content_assets-backed thumbnail rewriting (lh3) is deferred to YAR-111 (per-scene
// expansion needs to read content_assets too; folding both at once). Today this
// resolver only covers the video iframe rewrite — the comment above documents the
// future thumbnail intent so the next reader knows lh3 is the canonical choice when
// thumbnail support lands.
function resolveOutputUrls(piece: any): { video?: string; carousel_slides?: string[]; static?: string } {
  // Drive webViewLink (/file/d/<id>/view?usp=…) → /preview for iframe-embeddable video.
  // Single regex capture covers both /view and /view?usp=drivesdk variants.
  if (piece.final_asset_url?.includes("drive.google.com/file/d/")) {
    const m = piece.final_asset_url.match(/\/file\/d\/([^/]+)/);
    if (m) return { video: `https://drive.google.com/file/d/${m[1]}/preview` };
  }
  // Legacy orchestrator path: Supabase Storage MP4, embeds natively in <video>.
  if (piece.final_asset_url?.endsWith(".mp4")) return { video: piece.final_asset_url };
  // Other final_asset_url (legacy / unknown) — fall through to <img> for backward compat.
  // The piece-page UI's empty-state takes over if the URL turns out to be unembeddable.
  if (piece.final_asset_url) return { static: piece.final_asset_url };
  if (Array.isArray(piece.slide_images) && piece.slide_images.length > 0) {
    return { carousel_slides: piece.slide_images.map((s: any) => s.url ?? s.image_url ?? s).filter(Boolean) };
  }
  if (piece.image_url) return { static: piece.image_url };
  return {};
}

function extractQaScore(chain: any[]): number | null {
  const qa = [...chain].reverse().find((r) => String(r.step_name || "").startsWith("qa_") || r.step_name === "qa_evaluation");
  if (!qa?.rendered_output) return null;
  try {
    const j = JSON.parse(qa.rendered_output);
    if (typeof j.overall_score === "number") return j.overall_score;
    const sub = Object.values(j).filter((v: any) => v && typeof v.score === "number").map((v: any) => v.score);
    if (sub.length > 0) return Number((sub.reduce((a: number, b: number) => a + b, 0) / sub.length).toFixed(1));
  } catch { /* not JSON */ }
  return null;
}

async function performanceVsPillar(sb: Sb, pillar: string | null, igLatest: any, ttLatest: any) {
  if (!pillar) return { ig: null, tt: null };
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: pillarPieces } = await sb.from("content_queue").select("id").eq("content_pillar", pillar).limit(500);
  const ids = (pillarPieces || []).map((p: any) => p.id);
  if (ids.length === 0) return { ig: null, tt: null };
  const { data: metrics } = await sb.from("content_metrics")
    .select("channel, likes, comments, shares, saves, reach, views")
    .in("content_id", ids).gte("snapshot_at", since);
  const avgByChannel = (channel: "instagram" | "tiktok") => {
    const rows = (metrics || []).filter((m: any) => m.channel === channel);
    if (rows.length === 0) return null;
    const rates = rows.map((m: any) => engagementRate(m)).filter((r: number | null): r is number => r != null);
    if (rates.length === 0) return null;
    return rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
  };
  const igAvg = avgByChannel("instagram");
  const ttAvg = avgByChannel("tiktok");
  const igThis = engagementRate(igLatest);
  const ttThis = engagementRate(ttLatest);
  return {
    ig: igThis != null && igAvg ? Number((igThis / igAvg).toFixed(3)) : null,
    tt: ttThis != null && ttAvg ? Number((ttThis / ttAvg).toFixed(3)) : null,
  };
}

/**
 * Next available 1-hour slot in the next 7 days for a given channel, computed
 * against scheduled_posts rows in {scheduled,posted} states.
 *
 * (Replaces the pre-v2 implementation that read content_queue.scheduled_at_*
 * inline columns.)
 */
async function nextAvailableSlot(sb: Sb, channel: Channel): Promise<string> {
  const fromIso = new Date().toISOString();
  const toIso = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  const { data: busy } = await sb
    .from("scheduled_posts")
    .select("scheduled_for")
    .eq("channel", channel)
    .in("status", ["scheduled", "posted"])
    .gte("scheduled_for", fromIso)
    .lte("scheduled_for", toIso)
    .not("scheduled_for", "is", null);
  const busyMs = new Set((busy || []).map((r: any) => new Date(r.scheduled_for).getTime()));
  const now = new Date();
  const start = new Date(now); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
  for (let i = 0; i < 168; i++) {
    const candidate = new Date(start.getTime() + i * 3600_000).getTime();
    let ok = true;
    for (const b of busyMs) { if (Math.abs(b - candidate) <= 30 * 60_000) { ok = false; break; } }
    if (ok) return new Date(candidate).toISOString();
  }
  return new Date(Date.now() + 24 * 3600_000).toISOString();
}

// ---------- V1.1 piece-page handlers (path-based) ----------

async function handleGetPiece(sb: Sb, id: string) {
  const { data: piece, error } = await sb
    .from("content_queue")
    .select(PIECE_EMBED)
    .eq("id", id)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!piece) return err("Piece not found", 404);

  const renderProfileFullPromise = piece.render_profile_id
    ? sb.from("render_profiles").select("id, name, slug, profile_type, pipeline_steps, cost_estimate_usd").eq("id", piece.render_profile_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const chainPromise = sb.from("prompt_executions").select("*").eq("content_id", id).order("step_order", { ascending: true }).order("created_at", { ascending: true });
  const metricsPromise = sb.from("content_metrics").select("*").eq("content_id", id).order("snapshot_at", { ascending: false });
  const [renderProfileFullRes, chainRes, metricsRes] = await Promise.all([renderProfileFullPromise, chainPromise, metricsPromise]);

  const promptChain = chainRes.data || [];
  const metricsAll = metricsRes.data || [];
  const igSeries = metricsAll.filter((m: any) => m.channel === "instagram");
  const ttSeries = metricsAll.filter((m: any) => m.channel === "tiktok");
  const igLatest = igSeries[0] || null;
  const ttLatest = ttSeries[0] || null;

  const derived = {
    save_rate_ig: safeRate(igLatest?.saves, igLatest?.reach ?? igLatest?.views),
    share_rate_ig: safeRate(igLatest?.shares, igLatest?.reach ?? igLatest?.views),
    engagement_rate_ig: engagementRate(igLatest),
    save_rate_tt: safeRate(ttLatest?.saves, ttLatest?.reach ?? ttLatest?.views),
    share_rate_tt: safeRate(ttLatest?.shares, ttLatest?.reach ?? ttLatest?.views),
    engagement_rate_tt: engagementRate(ttLatest),
  };
  const perf = await performanceVsPillar(sb, piece.content_pillar, igLatest, ttLatest);

  const schedule = {
    scheduled_posts: piece.scheduled_posts ?? [],
    next_available_slot: {
      tiktok: await nextAvailableSlot(sb, "tiktok"),
      instagram: await nextAvailableSlot(sb, "instagram"),
    },
  };

  return json({
    piece,
    generation_context: piece.generation_context ?? null,
    render: {
      queue_row: {
        render_status: piece.render_status, render_started_at: piece.render_started_at,
        render_completed_at: piece.render_completed_at, render_error: piece.render_error,
        render_cost_usd: piece.render_cost_usd, final_asset_url: piece.final_asset_url,
        image_status: piece.image_status, image_url: piece.image_url, slide_images: piece.slide_images,
      },
      profile: renderProfileFullRes?.data ?? null,
      output_urls: resolveOutputUrls(piece),
      qa_score: extractQaScore(promptChain),
      cost_usd: piece.render_cost_usd,
    },
    prompt_chain: promptChain,
    metrics: { ig: { latest: igLatest, series: igSeries }, tt: { latest: ttLatest, series: ttSeries }, derived, performance_vs_pillar: perf },
    schedule,
  });
}

async function handleGetPromptChain(sb: Sb, id: string) {
  const { data, error } = await sb.from("prompt_executions").select("*").eq("content_id", id).order("step_order", { ascending: true }).order("created_at", { ascending: true });
  if (error) return err(error.message, 500);
  return json(data || []);
}

async function handleGetRenderOutput(sb: Sb, id: string) {
  const { data: piece, error } = await sb.from("content_queue").select("id, render_profile_id, render_status, render_started_at, render_completed_at, render_error, render_cost_usd, final_asset_url, image_url, image_status, slide_images").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!piece) return err("Piece not found", 404);
  const { data: profile } = piece.render_profile_id
    ? await sb.from("render_profiles").select("id, name, slug, profile_type").eq("id", piece.render_profile_id).maybeSingle()
    : { data: null };
  return json({ queue_row: piece, profile: profile ?? null, output_urls: resolveOutputUrls(piece) });
}

async function handleGetMetrics(sb: Sb, id: string) {
  const { data, error } = await sb.from("content_metrics").select("*").eq("content_id", id).order("snapshot_at", { ascending: false });
  if (error) return err(error.message, 500);
  const rows = data || [];
  const ig = rows.filter((m: any) => m.channel === "instagram");
  const tt = rows.filter((m: any) => m.channel === "tiktok");
  return json({ ig: { latest: ig[0] || null, series: ig }, tt: { latest: tt[0] || null, series: tt } });
}

/**
 * PATCH /pieces/:id/channels/:channel/schedule
 *
 * Body: { scheduled_for: string | null }
 *
 * Upserts the `scheduled_posts` row for (content_id, channel). If
 * `scheduled_for` is null the row is reset to status='pending'; if it parses
 * as a timestamp the row is marked status='scheduled'.
 */
async function handlePatchChannelSchedule(sb: Sb, id: string, channel: string, body: any) {
  if (!isValidChannel(channel)) {
    return err(`Invalid channel "${channel}"; must be one of ${CHANNELS.join(", ")}`, 400);
  }
  if (body == null || typeof body !== "object" || !("scheduled_for" in body)) {
    return err("Body must include `scheduled_for` (timestamp or null)", 400);
  }
  const raw = body.scheduled_for;
  let scheduledFor: string | null = null;
  if (raw !== null && raw !== undefined) {
    if (typeof raw !== "string") return err("`scheduled_for` must be an ISO timestamp string or null", 400);
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return err(`\`scheduled_for\` "${raw}" is not a valid timestamp`, 400);
    scheduledFor = parsed.toISOString();
  }

  // Confirm the piece exists. PostgREST will silently accept an orphan FK
  // insert if the parent is missing, so we 404 explicitly.
  const { data: piece, error: pErr } = await sb.from("content_queue").select("id").eq("id", id).maybeSingle();
  if (pErr) return err(pErr.message, 500);
  if (!piece) return err("Piece not found", 404);

  const targetStatus: ScheduledPostStatus = scheduledFor === null ? "pending" : "scheduled";
  const { data: existing, error: eErr } = await sb
    .from("scheduled_posts")
    .select("id")
    .eq("content_id", id)
    .eq("channel", channel)
    .maybeSingle();
  if (eErr) return err(eErr.message, 500);

  if (existing) {
    const { data, error } = await sb
      .from("scheduled_posts")
      .update({ scheduled_for: scheduledFor, status: targetStatus })
      .eq("content_id", id)
      .eq("channel", channel)
      .select()
      .maybeSingle();
    if (error) return err(error.message, 500);
    return json(data);
  }

  const { data, error } = await sb
    .from("scheduled_posts")
    .insert({ content_id: id, channel, scheduled_for: scheduledFor, status: targetStatus })
    .select()
    .maybeSingle();
  if (error) return err(error.message, 500);
  return json(data, 201);
}

/**
 * PATCH /pieces/:id/channels/:channel/status
 *
 * Body: { status, post_url?, external_post_id?, failure_reason?, published_at? }
 *
 * Used by the (future) publish agent to mark a channel posted/failed. Same row
 * resolution as /schedule — creates the row if missing.
 */
async function handlePatchChannelStatus(sb: Sb, id: string, channel: string, body: any) {
  if (!isValidChannel(channel)) {
    return err(`Invalid channel "${channel}"; must be one of ${CHANNELS.join(", ")}`, 400);
  }
  if (body == null || typeof body !== "object") return err("Body required", 400);
  const status = body.status;
  if (typeof status !== "string" || !isValidStatus(status)) {
    return err(`Invalid status; must be one of ${SCHEDULED_POST_STATUSES.join(", ")}`, 400);
  }

  const updates: Record<string, unknown> = { status };

  if ("post_url" in body) {
    if (body.post_url !== null && typeof body.post_url !== "string") return err("`post_url` must be a string or null", 400);
    updates.post_url = body.post_url;
  }
  if ("external_post_id" in body) {
    if (body.external_post_id !== null && typeof body.external_post_id !== "string") return err("`external_post_id` must be a string or null", 400);
    updates.external_post_id = body.external_post_id;
  }
  if ("failure_reason" in body) {
    if (body.failure_reason !== null && typeof body.failure_reason !== "string") return err("`failure_reason` must be a string or null", 400);
    updates.failure_reason = body.failure_reason;
  }
  if ("published_at" in body) {
    const raw = body.published_at;
    if (raw === null) {
      updates.published_at = null;
    } else if (typeof raw === "string") {
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) return err(`\`published_at\` "${raw}" is not a valid timestamp`, 400);
      updates.published_at = parsed.toISOString();
    } else {
      return err("`published_at` must be an ISO timestamp string or null", 400);
    }
  }

  // Confirm the piece exists.
  const { data: piece, error: pErr } = await sb.from("content_queue").select("id").eq("id", id).maybeSingle();
  if (pErr) return err(pErr.message, 500);
  if (!piece) return err("Piece not found", 404);

  const { data: existing, error: eErr } = await sb
    .from("scheduled_posts")
    .select("id")
    .eq("content_id", id)
    .eq("channel", channel)
    .maybeSingle();
  if (eErr) return err(eErr.message, 500);

  if (existing) {
    const { data, error } = await sb
      .from("scheduled_posts")
      .update(updates)
      .eq("content_id", id)
      .eq("channel", channel)
      .select()
      .maybeSingle();
    if (error) return err(error.message, 500);
    return json(data);
  }

  const { data, error } = await sb
    .from("scheduled_posts")
    .insert({ content_id: id, channel, ...updates })
    .select()
    .maybeSingle();
  if (error) return err(error.message, 500);
  return json(data, 201);
}

async function handlePatchPillar(sb: Sb, id: string, body: any) {
  const pillar = body?.content_pillar ?? body?.pillar;
  if (!pillar || !VALID_PILLARS.has(pillar)) return err(`Invalid pillar; must be one of ${[...VALID_PILLARS].join(", ")}`, 400);
  const { data, error } = await sb.from("content_queue").update({ content_pillar: pillar }).eq("id", id).select("id, content_pillar").maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Piece not found", 404);
  return json(data);
}

async function handleRegenerateFromStep(sb: Sb, id: string, body: any) {
  const stepName = body?.step_name;
  const editedPrompt = body?.edited_prompt;
  if (!stepName || !REGENABLE_STEPS.has(stepName)) return err(`Invalid step_name; must be one of ${[...REGENABLE_STEPS].join(", ")}`, 400);
  const { data: piece, error: pErr } = await sb.from("content_queue").select("id, status").eq("id", id).maybeSingle();
  if (pErr) return err(pErr.message, 500);
  if (!piece) return err("Piece not found", 404);
  if (piece.status === "published") return err("Cannot regenerate a published piece", 409);

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await sb.from("prompt_executions").select("id", { count: "exact", head: true }).eq("content_id", id).not("supersedes_id", "is", null).gte("created_at", since);
  if ((count ?? 0) >= 5) return err("Rate limit: 5 regenerations per piece per 24h", 429);

  const targetStepOrder = STEP_ORDER_BY_NAME[stepName];
  const { data: downstream, error: dErr } = await sb.from("prompt_executions").select("id, step_name, step_order, agent_name, model, system_prompt, user_prompt, supersedes_id").eq("content_id", id).gte("step_order", targetStepOrder).order("step_order", { ascending: true }).order("created_at", { ascending: true });
  if (dErr) return err(dErr.message, 500);
  const chain = downstream || [];
  const targetExecution = chain.find((r) => r.step_name === stepName) ?? chain[0];
  if (!targetExecution) return err(`No prior execution found for step "${stepName}"`, 404);

  const { data: newRow, error: iErr } = await sb.from("prompt_executions").insert({
    content_id: id, agent_name: targetExecution.agent_name, step_name: stepName, step_order: targetStepOrder,
    model: targetExecution.model, system_prompt: targetExecution.system_prompt,
    user_prompt: editedPrompt || targetExecution.user_prompt,
    status: "retry", supersedes_id: targetExecution.id,
    error_message: "regeneration requested — awaiting worker",
  }).select("id, step_name, step_order, status, supersedes_id").maybeSingle();
  if (iErr) return err(iErr.message, 500);

  try {
    await sb.from("activity_log").insert({
      category: "pipeline", actor_type: "user", actor_name: "piece_page",
      action: "regenerate_from_step",
      description: `Regenerate from step ${stepName} (order ${targetStepOrder})`,
      entity_type: "content", entity_id: id,
      metadata: { step_name: stepName, edited_prompt: !!editedPrompt, superseded_id: targetExecution.id, new_exec_id: newRow?.id },
    });
  } catch { /* non-fatal */ }

  return json({ ok: true, enqueued: true, new_prompt_execution_id: newRow?.id ?? null, superseded_id: targetExecution.id, step_name: stepName, step_order: targetStepOrder });
}

// ---------- Legacy query-param handlers ----------

async function handleLegacyList(sb: Sb, params: URLSearchParams) {
  const id = params.get("id");
  if (id) {
    const { data, error } = await sb.from("content_queue")
      .select(PIECE_EMBED)
      .eq("id", id).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Not found", 404);
    return json(data);
  }

  const search = params.get("search");
  if (search && search.length >= 2) {
    const like = `%${search}%`;
    const { data, error } = await sb.from("content_queue")
      .select(PIECE_EMBED)
      .or(`hook.ilike.${like},caption.ilike.${like},content_pillar.ilike.${like}`)
      .order("created_at", { ascending: false }).limit(200);
    if (error) return err(error.message, 500);
    return json(data || []);
  }

  const resource = params.get("resource");
  if (resource === "render_queue") {
    const { data, error } = await sb.from("content_queue")
      .select(PIECE_EMBED)
      .eq("status", "approved")
      .in("render_status", ["pending", "rendering", "failed", "qa_failed", "blocked"])
      .order("created_at", { ascending: false }).limit(500);
    if (error) return err(error.message, 500);
    return json(data || []);
  }

  const tab = params.get("tab") || "all";

  if (tab === "scheduled") {
    // Scheduled tab: piece has at least one scheduled_posts row in
    // {scheduled, posted}. Two-step query because PostgREST nested filters
    // don't let us filter the PARENT by child existence in a single call —
    // gather candidate content_ids first, then fetch the embed.
    const { data: hits, error: hitsErr } = await sb
      .from("scheduled_posts")
      .select("content_id")
      .in("status", ["scheduled", "posted"]);
    if (hitsErr) return err(hitsErr.message, 500);
    const ids = Array.from(new Set((hits || []).map((r: any) => r.content_id)));
    if (ids.length === 0) return json([]);
    const { data, error } = await sb.from("content_queue")
      .select(PIECE_EMBED)
      .in("id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return err(error.message, 500);
    return json(data || []);
  }

  let q = sb.from("content_queue")
    .select(PIECE_EMBED)
    .order("created_at", { ascending: false }).limit(500);

  if (tab === "ready") {
    q = q.eq("status", "approved").eq("render_status", "complete");
  } else {
    const statuses = TAB_STATUS_MAP[tab] ?? [];
    if (statuses.length > 0) q = q.in("status", statuses);
  }

  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json(data || []);
}

async function handleLegacyPatch(sb: Sb, body: any) {
  const { id, ...updates } = body || {};
  if (!id) return err("id required", 400);
  // Defend against writes to columns dropped in v2.0.0 (CHANNEL_MODEL_V1).
  // platform was dropped in V1.1; the rest are gated by migration 4.
  delete updates.platform;
  delete updates.post_format;
  delete updates.scheduled_at_ig;
  delete updates.scheduled_at_tt;
  delete updates.published_at_ig;
  delete updates.published_at_tt;
  delete updates.published_url_ig;
  delete updates.published_url_tt;
  delete updates.channel_override;
  const { data, error } = await sb.from("content_queue").update(updates).eq("id", id).select();
  if (error) return err(error.message, 500);
  return json(data || []);
}

async function handleLegacyPost(sb: Sb, body: any) {
  const action = body?.action;
  if (action === "bulk_approve") {
    const ids: string[] = body.ids || [];
    if (ids.length === 0) return err("ids required", 400);
    const { data, error } = await sb.from("content_queue").update({ status: "approved" }).in("id", ids).select("id, status");
    if (error) return err(error.message, 500);
    return json({ ok: true, updated: data?.length ?? 0 });
  }
  if (action === "bulk_reject") {
    const ids: string[] = body.ids || [];
    const reason = body.reason || "Bulk rejected";
    if (ids.length === 0) return err("ids required", 400);
    const { data, error } = await sb.from("content_queue").update({ status: "rejected", rejection_reason: reason }).in("id", ids).select("id, status");
    if (error) return err(error.message, 500);
    return json({ ok: true, updated: data?.length ?? 0 });
  }
  if (action === "trigger_render") {
    const id = body.id;
    if (!id) return err("id required", 400);
    const { data, error } = await sb.from("content_queue")
      .update({ render_status: "pending", render_error: null, render_started_at: null, render_completed_at: null })
      .eq("id", id).select("id, render_status").maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Not found", 404);
    return json({ ok: true, piece: data });
  }
  if (action === "feedback") {
    // content_feedback table exists per the migrations list.
    const { content_queue_id, feedback_type, category, description } = body;
    if (!content_queue_id || !feedback_type) return err("content_queue_id and feedback_type required", 400);
    const { data, error } = await sb.from("content_feedback").insert({
      content_queue_id, feedback_type, category, description,
    }).select("id").maybeSingle();
    if (error) return err(error.message, 500);
    return json({ ok: true, id: data?.id });
  }
  return err(`Unknown action: ${action}`, 400);
}

// ---------- Router ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const url = new URL(req.url);
    const pathname = stripPrefix(url.pathname);

    // /pieces/:id/channels/:channel/:action — v2.0.0 per-channel routes.
    const channelMatch = pathname.match(
      /^\/pieces\/([0-9a-fA-F-]{36})\/channels\/([a-z]+)\/([a-z-]+)\/?$/,
    );
    if (channelMatch) {
      const pieceId = channelMatch[1];
      const channel = channelMatch[2];
      const action = channelMatch[3];
      if (req.method !== "PATCH") {
        return new Response("Method not allowed", { status: 405, headers: cors });
      }
      const body = await req.json().catch(() => ({}));
      if (action === "schedule") return handlePatchChannelSchedule(sb, pieceId, channel, body);
      if (action === "status")   return handlePatchChannelStatus(sb, pieceId, channel, body);
      return err(`Unknown channel action: ${action}`, 404);
    }

    // PIECE_PAGE_LIFECYCLE_V1 path routes take priority when a piece UUID matches.
    const pieceMatch = pathname.match(/^\/pieces\/([0-9a-fA-F-]{36})(?:\/([a-z-]+))?\/?$/);
    if (pieceMatch) {
      const pieceId = pieceMatch[1];
      const sub = pieceMatch[2];
      if (req.method === "GET") {
        if (!sub) return handleGetPiece(sb, pieceId);
        if (sub === "prompt-chain") return handleGetPromptChain(sb, pieceId);
        if (sub === "render-output") return handleGetRenderOutput(sb, pieceId);
        if (sub === "metrics") return handleGetMetrics(sb, pieceId);
        return err(`Unknown GET subroute: ${sub}`, 404);
      }
      if (req.method === "PATCH") {
        if (sub === "schedule") {
          // CHANNEL_MODEL_V1 retired this endpoint. Direct callers at the new
          // per-channel routes.
          return json(
            {
              error: "Endpoint gone in v2.0.0 (CHANNEL_MODEL_V1).",
              hint: "Use PATCH /pieces/:id/channels/:channel/schedule with { scheduled_for } per channel.",
            },
            410,
          );
        }
        const body = await req.json().catch(() => ({}));
        if (sub === "pillar") return handlePatchPillar(sb, pieceId, body);
        return err(`Unknown PATCH subroute: ${sub}`, 404);
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (sub === "regenerate-from-step") return handleRegenerateFromStep(sb, pieceId, body);
        return err(`Unknown POST subroute: ${sub}`, 404);
      }
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    // Legacy routes (root path, query-param driven).
    if (req.method === "GET") return handleLegacyList(sb, url.searchParams);
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      return handleLegacyPatch(sb, body);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return handleLegacyPost(sb, body);
    }
    return new Response("Method not allowed", { status: 405, headers: cors });
  } catch (e) {
    return err((e as Error).message, 500);
  }
});
