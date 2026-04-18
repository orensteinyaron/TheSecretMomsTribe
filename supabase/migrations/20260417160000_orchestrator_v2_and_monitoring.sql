-- Orchestrator V2 + Pipeline Monitoring
-- Adds: notifications columns for pipeline alerts, activity_log indexes,
--       pipeline-monitor agent row.
-- Idempotent; safe to re-run.

-- ── notifications: new columns for pipeline alerts ──────────────
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subject_id text,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS delivered_channels jsonb DEFAULT '{}'::jsonb;

-- One critical alert per (category, subject_id) per UTC day
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_daily_dedup
  ON notifications (category, subject_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE category IS NOT NULL AND subject_id IS NOT NULL;

-- Fast "today's pipeline-health notifications" query
CREATE INDEX IF NOT EXISTS idx_notifications_pipeline_today
  ON notifications (created_at DESC)
  WHERE category = 'pipeline_health';

-- ── activity_log: indexes for dashboard + agent-run drilldown ───
CREATE INDEX IF NOT EXISTS idx_activity_log_recent
  ON activity_log (created_at DESC)
  WHERE category <> 'debug';

CREATE INDEX IF NOT EXISTS idx_activity_log_agent_run
  ON activity_log (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_category_recent
  ON activity_log (category, created_at DESC);

-- ── agents: extend agent_type whitelist to include 'monitoring' ─
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_agent_type_check;
ALTER TABLE agents ADD CONSTRAINT agents_agent_type_check
  CHECK (agent_type = ANY (ARRAY['orchestrator', 'data', 'content', 'strategy', 'monitoring']));

-- ── pipeline-monitor agent row (idempotent upsert) ──────────────
INSERT INTO agents (name, slug, agent_type, schedule, depends_on, status, cost_budget_daily_usd, config)
VALUES (
  'Pipeline Monitor',
  'pipeline-monitor',
  'monitoring',
  '0 * * * *',
  NULL,
  'idle',
  0,
  jsonb_build_object(
    'description', 'Checks pipeline SLAs hourly, fires alerts on missed deadlines.',
    'sla_definitions', jsonb_build_object(
      'data-fetcher',     jsonb_build_object('must_complete_by_utc', '04:00'),
      'research-agent',   jsonb_build_object('must_complete_by_utc', '04:15'),
      'content-text-gen', jsonb_build_object('must_complete_by_utc', '04:45'),
      'strategist-daily', jsonb_build_object('must_complete_by_utc', '05:00')
    ),
    'orchestrator_max_silence_hours', 2
  )
)
ON CONFLICT (slug) DO UPDATE
  SET agent_type = EXCLUDED.agent_type,
      schedule   = EXCLUDED.schedule,
      config     = EXCLUDED.config,
      updated_at = now();
