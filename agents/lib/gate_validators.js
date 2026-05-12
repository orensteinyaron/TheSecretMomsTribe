/**
 * TypeScript-style gate validators — the deterministic safety net under
 * the four LLM agents. Every rule the SKILL.md files describe is
 * mirrored here, so if an LLM forgets the rule (or hallucinates), we
 * catch it before the row reaches `content_queue`.
 *
 * Anchor reference: `agents/skills/SMT_PIPELINE_CONTRACT.md`.
 * Anchor incident:  May 11 fabricated AI Magic row, signal_id
 * `6d65fbae-f0fb-4000-96b2-b4fc8144ab81`. The defensive substring check
 * in `validateContentQueueRow` would have caught that one.
 */
import { CANONICAL_PILLARS, isCanonicalPillar } from './pillar_translation.js';

const VALID_AGE_RANGES = new Set([
  'toddler', 'little_kid', 'school_age', 'teen', 'universal',
]);

const VALID_CHANNEL_TYPES = new Set([
  'ai_native', 'mom_parenting', 'general',
]);

const VALID_SOURCE_PLATFORMS = new Set([
  'reddit', 'tiktok', 'instagram', 'hacker_news', 'web',
]);

const MIN_PROMPT_LENGTH = 10;
const MIN_OUTPUT_LENGTH = 30;

function ok() {
  return { ok: true };
}

function fail(reason, field) {
  const out = { ok: false, reason };
  if (field) out.field = field;
  return out;
}

function isNonEmptyString(value, minLen = 1) {
  return typeof value === 'string' && value.trim().length >= minLen;
}

/**
 * Defensive AI Magic gate. Mirrors the contract's STRICT GATE: all four
 * fields must be present and well-formed for a row to remain `ai_magic`.
 */
export function validateAiMagicGate(row) {
  if (!row || typeof row !== 'object') {
    return fail('ai_magic_gate_failed: row missing or not an object');
  }
  if (!isNonEmptyString(row.original_prompt, MIN_PROMPT_LENGTH)) {
    return fail(
      `ai_magic_gate_failed: original_prompt missing or shorter than ${MIN_PROMPT_LENGTH} chars`,
      'original_prompt',
    );
  }
  if (!isNonEmptyString(row.original_output, MIN_OUTPUT_LENGTH)) {
    return fail(
      `ai_magic_gate_failed: original_output missing or shorter than ${MIN_OUTPUT_LENGTH} chars`,
      'original_output',
    );
  }
  if (!isNonEmptyString(row.ai_tool_name)) {
    return fail('ai_magic_gate_failed: ai_tool_name missing', 'ai_tool_name');
  }
  if (!isNonEmptyString(row.source_url)) {
    return fail('ai_magic_gate_failed: source_url missing', 'source_url');
  }
  return ok();
}

/**
 * Base schema check that applies to every row, regardless of pillar.
 * Mirrors "All rows (regardless of pillar)" in the contract.
 */
export function validateBaseSchema(row) {
  if (!row || typeof row !== 'object') {
    return fail('base_schema_failed: row missing or not an object');
  }
  if (!isNonEmptyString(row.signal_id)) {
    return fail('base_schema_failed: signal_id missing', 'signal_id');
  }
  if (!isNonEmptyString(row.source_url)) {
    return fail('base_schema_failed: source_url missing', 'source_url');
  }
  if (!isNonEmptyString(row.source_platform) || !VALID_SOURCE_PLATFORMS.has(row.source_platform)) {
    return fail(
      `base_schema_failed: source_platform invalid (got "${row.source_platform}")`,
      'source_platform',
    );
  }
  if (!isNonEmptyString(row.age_range) || !VALID_AGE_RANGES.has(row.age_range)) {
    return fail(
      `base_schema_failed: age_range invalid (got "${row.age_range}")`,
      'age_range',
    );
  }
  if (!isNonEmptyString(row.channel_type) || !VALID_CHANNEL_TYPES.has(row.channel_type)) {
    return fail(
      `base_schema_failed: channel_type invalid (got "${row.channel_type}")`,
      'channel_type',
    );
  }
  if (!isNonEmptyString(row.content_pillar)) {
    return fail('base_schema_failed: content_pillar missing', 'content_pillar');
  }
  return ok();
}

/**
 * Confirms the pillar is one of the six canonical names. Pillar
 * translation to DB names happens elsewhere (pillar_translation.js); this
 * gate exists so an LLM that emits "parenting" or "kids" or "ai" gets
 * caught before insertion.
 */
export function validatePillarRouting(row) {
  if (!row || typeof row !== 'object') {
    return fail('pillar_routing_failed: row missing or not an object');
  }
  if (!isCanonicalPillar(row.content_pillar)) {
    return fail(
      `pillar_routing_failed: "${row.content_pillar}" is not one of the canonical pillars (${CANONICAL_PILLARS.join(', ')})`,
      'content_pillar',
    );
  }
  return ok();
}

/**
 * Defensive insert-time check used by the ContentGen agent.
 *
 * If the row says `content_pillar == 'ai_magic'`, this verifies the
 * agent's emitted `ai_magic_output` actually contains the briefing's
 * `original_prompt` AND `original_output` verbatim — a byte-for-byte
 * substring check, NOT a similarity score. The May 11 fabrication
 * passed every check except this one (it would have failed here, because
 * the briefing had no real artifact to quote).
 */
export function validateContentQueueRow(row, briefingRow) {
  if (!row || typeof row !== 'object') {
    return fail('content_queue_row_invalid: row missing or not an object');
  }
  if (row.content_pillar !== 'ai_magic') {
    return ok();
  }
  if (!briefingRow || typeof briefingRow !== 'object') {
    return fail(
      'ai_magic_defensive_gate_failed: ai_magic row produced without a briefing row to compare against',
      'briefing_row',
    );
  }
  const briefingPrompt = briefingRow.original_prompt;
  const briefingOutput = briefingRow.original_output;
  if (!isNonEmptyString(briefingPrompt, MIN_PROMPT_LENGTH)) {
    return fail(
      'ai_magic_defensive_gate_failed: briefing row missing verbatim original_prompt',
      'original_prompt',
    );
  }
  if (!isNonEmptyString(briefingOutput, MIN_OUTPUT_LENGTH)) {
    return fail(
      'ai_magic_defensive_gate_failed: briefing row missing verbatim original_output',
      'original_output',
    );
  }
  const generated = typeof row.ai_magic_output === 'string' ? row.ai_magic_output : '';
  if (!generated.includes(briefingPrompt)) {
    return fail(
      'ai_magic_defensive_gate_failed: ai_magic_output does not contain the briefing original_prompt verbatim',
      'ai_magic_output',
    );
  }
  if (!generated.includes(briefingOutput)) {
    return fail(
      'ai_magic_defensive_gate_failed: ai_magic_output does not contain the briefing original_output verbatim',
      'ai_magic_output',
    );
  }
  return ok();
}

/**
 * Scan strategist `notes_for_content_gen` for fabrication telltales.
 * The Strategist is allowed to reorder, prioritize, and adjust mix —
 * but not to invent prompts or outputs. If any of these patterns appear,
 * the orchestrator strips the offending text before passing the briefing
 * to ContentGen and writes a warn-level escalation.
 *
 * Returns `{ detected: boolean, matches: string[] }`.
 */
export function detectStrategistInvention(notesText) {
  if (typeof notesText !== 'string' || notesText.length === 0) {
    return { detected: false, matches: [] };
  }
  const patterns = [
    /Show the prompt/i,
    /e\.g\.,?\s*['"]/i,
    /Sample output:/i,
    /prompt example/i,
  ];
  const matches = [];
  for (const re of patterns) {
    const m = notesText.match(re);
    if (m) matches.push(m[0]);
  }
  return { detected: matches.length > 0, matches };
}

export const GATE_VALIDATOR_CONSTANTS = Object.freeze({
  MIN_PROMPT_LENGTH,
  MIN_OUTPUT_LENGTH,
  VALID_AGE_RANGES: [...VALID_AGE_RANGES],
  VALID_CHANNEL_TYPES: [...VALID_CHANNEL_TYPES],
  VALID_SOURCE_PLATFORMS: [...VALID_SOURCE_PLATFORMS],
});
