// Content
export interface ContentItem {
  id: string;
  briefing_id: string | null;
  platform: 'instagram' | 'tiktok';
  content_type: 'wow' | 'trust' | 'cta';
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  hook: string;
  caption: string;
  hashtags: string[];
  ai_magic_output: string | null;
  image_prompt: string | null;
  audio_suggestion: string | null;
  slides: Slide[] | null;
  age_range: 'toddler' | 'little_kid' | 'school_age' | 'teen' | 'universal' | null;
  content_pillar: 'ai_magic' | 'parenting_insights' | 'tech_for_moms' | 'mom_health' | 'trending' | null;
  post_format: string | null;
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
  render_profiles?: RenderProfile;
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
  today_cost: number;
  pending_tasks: number;
  pending_content: number;
  failed_renders: number;
}

// Analytics
export interface CostSummary {
  total: number;
  by_stage: Record<string, number>;
  by_service: Record<string, number>;
  trend: { date: string; total: number }[];
}
