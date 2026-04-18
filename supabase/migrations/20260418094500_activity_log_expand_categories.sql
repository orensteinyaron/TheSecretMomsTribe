-- Expand activity_log check constraints so the V2 orchestrator's
-- logActivity() calls are accepted.
-- Pre-V2 allowed list was narrower than the spec's category taxonomy.
-- Keep legacy values for backwards compat.

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_category_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_category_check
  CHECK (category = ANY (ARRAY[
    -- new (spec §8.2)
    'pipeline', 'agent', 'system', 'debug', 'alert',
    -- legacy
    'agent_action', 'admin_action', 'system_action',
    'content_change', 'strategy_event', 'notification'
  ]));

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_actor_type_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_actor_type_check
  CHECK (actor_type = ANY (ARRAY['agent', 'admin', 'system', 'user']));

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_entity_type_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_entity_type_check
  CHECK (entity_type IS NULL OR entity_type = ANY (ARRAY[
    'content', 'agent', 'service', 'directive', 'task',
    'insight', 'briefing', 'report', 'notification',
    'agent_run'
  ]));
