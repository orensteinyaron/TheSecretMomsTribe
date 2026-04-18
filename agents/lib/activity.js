/**
 * activity_log writer. Never throws — callers must never be broken by
 * a logging failure. Categories: pipeline | agent | system | debug | alert.
 */

import { supabase } from './supabase.js';

/**
 * @param {object} payload
 * @param {'pipeline'|'agent'|'system'|'debug'|'alert'} payload.category
 * @param {'system'|'agent'|'user'} payload.actor_type
 * @param {string} payload.actor_name   - e.g. 'system-orchestrator', 'research-agent', 'yaron'
 * @param {string} payload.action       - short verb phrase: 'orchestrator_tick_started'
 * @param {string} payload.description  - human-readable one-liner for UI
 * @param {string} [payload.entity_type]
 * @param {string} [payload.entity_id]
 * @param {object} [payload.metadata]
 * @param {string} [payload.agent_run_id]
 */
export async function logActivity(payload) {
  try {
    const { error } = await supabase.from('activity_log').insert({
      category:     payload.category,
      actor_type:   payload.actor_type,
      actor_name:   payload.actor_name,
      action:       payload.action,
      description:  payload.description,
      entity_type:  payload.entity_type ?? null,
      entity_id:    payload.entity_id ?? null,
      metadata:     payload.metadata ?? null,
      agent_run_id: payload.agent_run_id ?? null,
    });
    if (error) {
      console.error('[activity_log] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[activity_log] write threw:', err.message);
  }
}
