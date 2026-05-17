// Content — V2.0.0 (CHANNEL_MODEL_V1):
// - `platform` dropped (content goes to both IG + TT by policy).
// - Per-channel state lives in `scheduled_posts` table — never on the row.
// - `post_format` replaced by `render_profile_id` + joined `render_profile`.
// - Pillar taxonomy: parenting, health, ai_magic, tech, trending, financial, uncategorized.
export type ContentPillar =
  | 'parenting'
  | 'health'
  | 'ai_magic'
  | 'tech'
  | 'trending'
  | 'financial'
  | 'uncategorized';

// CHANNEL_MODEL_V1: every piece targets multiple channels (TikTok +
// Instagram by default). Per-channel state lives on `scheduled_posts`.
export type Channel = 'tiktok' | 'instagram';

export type ScheduledPostStatus =
  | 'pending'
  | 'scheduled'
  | 'posted'
  | 'failed'
  | 'skipped';

export type RenderProfileSlug =
  | 'avatar-v1'
  | 'moving-images'
  | 'static-image'
  | 'carousel';

// One row per (content_id, channel). Source of truth for per-channel
// scheduling, captions, and publish state.
export interface ScheduledPost {
  id: string;
  content_id: string;
  channel: Channel;
  status: ScheduledPostStatus;
  caption: string | null;
  scheduled_for: string | null;       // ISO timestamp
  published_at: string | null;
  post_url: string | null;
  external_post_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Compact view of the joined render_profiles row attached to a piece.
// Full RenderProfile (with pipeline_steps etc.) is defined below.
export interface RenderProfileRef {
  id: string;
  slug: RenderProfileSlug;
  name: string;
}

export interface ContentItem {
  id: string;
  briefing_id: string | null;
  content_type: 'wow' | 'trust' | 'cta';
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'draft_needs_review' | 'published' | 'superseded';
  hook: string;
  caption: string;
  hashtags: string[];
  ai_magic_output: string | null;
  image_prompt: string | null;
  audio_suggestion: string | null;
  slides: Slide[] | null;
  age_range: 'toddler' | 'little_kid' | 'school_age' | 'teen' | 'universal' | null;
  content_pillar: ContentPillar;
  image_url: string | null;
  image_status: string | null;
  slide_images: any[] | null;
  metadata: Record<string, any>;
  render_profile_id: string | null;
  render_status: 'pending' | 'rendering' | 'blocked' | 'complete' | 'failed' | 'qa_failed' | null;
  render_started_at: string | null;
  render_completed_at: string | null;
  render_error: string | null;
  render_cost_usd: number;
  final_asset_url: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  // CHANNEL_MODEL_V1: joined render_profiles row (singular). The legacy
  // `render_profiles` field is kept temporarily for places that still
  // read it (e.g. RenderQueue); new code should use `render_profile`.
  render_profile: RenderProfileRef | null;
  render_profiles?: RenderProfile;
  source_urls: Array<{ url: string; source: string }> | null;
  // Single-row "when should this piece go live" date. The per-channel
  // schedule lives on `scheduled_posts`; this column is kept on the row
  // for the Planner's day-grouping (it picks the earliest channel slot).
  scheduled_for: string | null;
  // Per-channel state. Always an array — empty if no scheduled_posts rows
  // exist yet for this piece (legacy data).
  scheduled_posts: ScheduledPost[];
  // Full generation prompt chain context (set by content_gen agent).
  generation_context: GenerationContext | null;
}

export interface GenerationContext {
  model: string;
  system_prompt: string;
  user_prompt: string;
  briefing_id: string | null;
  briefing_slice: BriefingOpportunity | null;
  active_directives: Array<{ directive_type: string; directive: string; parameters?: any }>;
  pillar_input: string;
  format_input: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  agent_run_id: string | null;
  created_at: string;
  needs_review_reason?: string | null;

  // Agent Skills v1.0.0 — versioned skill audit trail. Populated by the
  // four smt_* agents starting 2026-05-11. Older rows have nulls.
  agent_slug?: string | null;
  skill_version?: string | null;
  contract_version?: string | null;

  // Reconstructed-data conventions — established by PR #21 backfill.
  // Canonical reference: agents/lib/prompt_logger.js JSDoc.
  // Spec: docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md §5.
  // Real-time-logged pieces have NONE of these keys set; only backfilled
  // pieces carry them. UI consumes _reconstructed for the GenerationPanel
  // banner (YAR-110) and _estimated_cost_breakdown for the Render Cost
  // info-icon hover.
  _reconstructed?: boolean;
  _reconstructed_note?: string;
  _estimated_cost_breakdown?: {
    [stepName: string]: number | string;
    total_estimated: number;
    note: string;
  };
  _cost_honesty_pass_applied_at?: string;
  _active_directives_note?: string;
  _pillar_input_note?: string;
  _format_input_note?: string;
  _token_cost_note?: string;
}

export interface PromptExecution {
  id: string;
  content_id: string;
  agent_name: string;
  step_name: string;
  step_order: number;
  model: string;
  system_prompt: string | null;
  user_prompt: string;
  rendered_output: string | null;
  output_json: any | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  // 'reconstructed' added by PR #21's cost-honesty pass (DB CHECK widened
  // to allow the value). Reserved for backfilled rows that synthesize a
  // prompt chain from indirect sources. See agents/lib/prompt_logger.js
  // JSDoc — real-time-logged executions must NEVER claim 'reconstructed'.
  status: 'ok' | 'error' | 'retry' | 'skipped' | 'reconstructed';
  error_message: string | null;
  latency_ms: number | null;
  agent_run_id: string | null;
  supersedes_id: string | null;
  created_at: string;
}

export interface MetricSnapshot {
  id: string;
  content_id: string;
  channel: 'instagram' | 'tiktok';
  snapshot_at: string;
  source: 'apify' | 'graph_api' | 'tiktok_api' | 'manual';
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  impressions: number | null;
  profile_visits: number | null;
  follows: number | null;
  watch_time_seconds: number | null;
  avg_watch_duration_seconds: number | null;
  completion_rate: number | null;
  raw_payload: any;
  created_at: string;
}

export interface PiecePagePayload {
  piece: ContentItem;
  generation_context: GenerationContext | null;
  render: {
    queue_row: {
      render_status: string | null;
      render_started_at: string | null;
      render_completed_at: string | null;
      render_error: string | null;
      render_cost_usd: number | null;
      final_asset_url: string | null;
      image_status: string | null;
      image_url: string | null;
      slide_images: any[] | null;
    };
    profile: RenderProfile | null;
    output_urls: { video?: string; carousel_slides?: string[]; static?: string };
    qa_score: number | null;
    cost_usd: number | null;
  };
  prompt_chain: PromptExecution[];
  metrics: {
    ig: { latest: MetricSnapshot | null; series: MetricSnapshot[] };
    tt: { latest: MetricSnapshot | null; series: MetricSnapshot[] };
    derived: {
      save_rate_ig: number | null;
      share_rate_ig: number | null;
      engagement_rate_ig: number | null;
      save_rate_tt: number | null;
      share_rate_tt: number | null;
      engagement_rate_tt: number | null;
    };
    performance_vs_pillar: { ig: number | null; tt: number | null };
  };
  // CHANNEL_MODEL_V1: per-channel state is now on each scheduled_posts
  // row (carried on `piece.scheduled_posts`); the payload-level `schedule`
  // object only exposes derived/next-slot info the server computes.
  schedule: {
    next_available_slot: Record<Channel, string>;
  };
}

export interface Slide {
  slide_number: number;
  text: string;
  type: 'hook' | 'content' | 'cta';
  image_prompt?: string | null;
}

// Agents
export interface Agent {
  id: string;
  name: string;
  slug: string;
  agent_type: 'orchestrator' | 'data' | 'content' | 'strategy';
  schedule: string | null;
  depends_on: string[] | null;
  status: 'idle' | 'running' | 'failed' | 'disabled';
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_duration_ms: number | null;
  retry_policy: { max_retries: number; backoff_ms: number };
  config: Record<string, any>;
  cost_budget_daily_usd: number | null;
  cost_spent_today_usd: number;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  trigger: 'scheduled' | 'manual' | 'dependency' | 'retry';
  input_data: any;
  output_data: any;
  cost_usd: number;
  error: string | null;
}

// Strategy
export interface StrategyTask {
  id: string;
  insight_id: string | null;
  task_type: string;
  title: string;
  description: string;
  recommended_action: string;
  proposed_directive: any;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  admin_notes: string | null;
  created_at: string;
}

export interface StrategyInsight {
  id: string;
  insight_type: string;
  insight: string;
  confidence: number;
  status: 'hypothesis' | 'confirmed' | 'applied' | 'invalidated';
  times_confirmed: number;
  first_observed: string;
  last_confirmed: string;
}

export interface DailyBriefing {
  id: string;
  briefing_date: string;
  opportunities: BriefingOpportunity[];
  sources: Record<string, any>;
}

export interface BriefingOpportunity {
  topic: string;
  category: string;
  angle: string;
  source: string;
  source_url: string;
  content_type: string;
  platform_fit: string;
  priority: number;
  suggested_hook: string;
  recommended_format?: string;
  signal_strength?: number;
  age_range?: string;
  reasoning?: string;
}

// Services
export interface Service {
  id: string;
  name: string;
  slug: string;
  service_type: string;
  provider: string;
  status: 'active' | 'no_key' | 'disabled' | 'rate_limited' | 'not_configured';
  cost_per_unit: number | null;
  cost_unit: string | null;
  fallback_service_id: string | null;
  health_status: string | null;
}

// Render Profiles
export interface RenderProfile {
  id: string;
  name: string;
  slug: string;
  version: number;
  profile_type: 'video' | 'image' | 'carousel' | 'static';
  status: 'draft' | 'active' | 'deprecated';
  required_services: string[];
  pipeline_steps: any[];
  cost_estimate_usd: number | null;
}

// System
export interface SystemDirective {
  id: string;
  directive: string;
  directive_type: string;
  target_agent: string | null;
  parameters: any;
  status: 'pending' | 'active' | 'completed' | 'paused' | 'rejected';
  priority: number;
  created_at: string;
  applied_at: string | null;
  expires_at: string | null;
}

export interface SystemHealth {
  agents: { total: number; healthy: number; failed: number; disabled: number };
  services: { total: number; active: number; down: number };
  pipeline?: {
    total: number;
    on_time: number;
    late: number;
    missed: number;
    pending: number;
    detail: Array<{
      slug: string;
      deadline_utc: string;
      status: 'on_time' | 'late' | 'missed' | 'pending';
      completed_at: string | null;
    }>;
  };
  today_cost: number;
  pending_tasks: number;
  pending_content: number;
  failed_renders: number;
}

export interface PipelineHealth {
  state: 'green' | 'yellow' | 'red';
  counts: {
    total: number;
    on_time: number;
    late: number;
    missed: number;
    pending: number;
  };
  rows: Array<{
    slug: string;
    name: string;
    schedule: string | null;
    deadline_utc: string;
    status: 'on_time' | 'late' | 'missed' | 'pending' | 'running' | 'failed';
    last_run_at: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>;
  orchestrator: {
    last_tick: string | null;
    last_status: string | null;
    silent_hours: number | null;
    silent: boolean;
  };
  monitor: { last_run_at: string | null };
  alerts: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    subject_id: string;
    created_at: string;
  }>;
}

// Analytics
export interface CostSummary {
  total: number;
  by_stage: Record<string, number>;
  by_service: Record<string, number>;
  trend: { date: string; total: number }[];
}


// Agent Skills v1.0.0 — pipeline_runs + content_queue_rejected

export interface PipelineRun {
  id: string;
  mode: "daily" | "hot_signal" | "resume_from_stage" | "dry_run";
  status: "in_progress" | "completed" | "partial" | "failed" | "escalated" | "timeout";
  parent_run_id: string | null;
  started_at: string;
  completed_at: string | null;
  stages: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
  pre_flight: Record<string, unknown> | null;
  total_cost_usd: number | null;
  next_action: string | null;
  trigger_source: string | null;
}

export interface ContentQueueRejected {
  id: string;
  pipeline_run_id: string | null;
  briefing_id: string | null;
  signal_id: string | null;
  agent_id: string | null;
  rejected_at: string;
  reason: string;
  field: string | null;
  evidence: string | null;
  raw_llm_output: unknown;
  raw_briefing_row: unknown;
}
