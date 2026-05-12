-- Agent Skills v1.0.0 — audit + run tracking
--
-- Adds the schema required to make every pipeline cycle auditable:
--   * `agent_runs.skill_version` + `.contract_version`  — which version
--     of which SKILL/contract produced this row.
--   * `pipeline_runs`            — one row per orchestrator invocation.
--   * `content_queue_rejected`   — every row the LLM emitted that the
--                                  gate validators bounced; preserves
--                                  the raw LLM output for forensic use.
--   * `escalations`              — every warn/error/critical event the
--                                  orchestrator surfaced during a run.
--   * Tightens `content_queue.content_pillar` to add `financial` to the
--     allowed set. (Canonical names continue to be translated to DB
--     names by `agents/lib/pillar_translation.js` at insert time.)
--
-- DO NOT APPLY TO PRODUCTION WITHOUT YARON'S APPROVAL. The orchestrator
-- code in this branch assumes these tables exist; running `--mode=daily`
-- against a prod DB without first applying this migration will fail.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS skill_version TEXT,
  ADD COLUMN IF NOT EXISTS contract_version TEXT;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('daily', 'hot_signal', 'resume_from_stage', 'dry_run')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'partial', 'failed', 'escalated', 'timeout')),
  parent_run_id UUID REFERENCES pipeline_runs(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  stages JSONB DEFAULT '[]'::jsonb,
  warnings JSONB DEFAULT '[]'::jsonb,
  escalations JSONB DEFAULT '[]'::jsonb,
  pre_flight JSONB,
  total_cost_usd NUMERIC(10,6) DEFAULT 0,
  next_action TEXT,
  trigger_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at);

CREATE TABLE IF NOT EXISTS content_queue_rejected (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES pipeline_runs(id),
  briefing_id UUID,
  signal_id UUID,
  agent_id UUID REFERENCES agents(id),
  rejected_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT NOT NULL,
  field TEXT,
  evidence TEXT,
  raw_llm_output JSONB,
  raw_briefing_row JSONB
);
CREATE INDEX IF NOT EXISTS idx_content_queue_rejected_pipeline ON content_queue_rejected(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_content_queue_rejected_agent    ON content_queue_rejected(agent_id);

CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES pipeline_runs(id),
  severity TEXT NOT NULL CHECK (severity IN ('warn', 'error', 'critical')),
  reason TEXT NOT NULL,
  details JSONB,
  recommended_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_escalations_unresolved
  ON escalations(resolved_at) WHERE resolved_at IS NULL;

-- Pillar taxonomy: add `financial` (previously absent from the check).
-- Canonical-to-DB translation happens in app code; this constraint is
-- the floor.
ALTER TABLE content_queue DROP CONSTRAINT IF EXISTS content_queue_content_pillar_check;
ALTER TABLE content_queue ADD CONSTRAINT content_queue_content_pillar_check
  CHECK (content_pillar IN ('ai_magic', 'parenting', 'health', 'tech', 'trending', 'financial'));
