/**
 * The SKILL.md files (and SMT_PIPELINE_CONTRACT.md) use canonical pillar
 * names — the source of truth for editorial taxonomy. The database
 * `content_queue.content_pillar` column uses legacy short names from
 * before V1.1. This file is the single boundary between the two
 * vocabularies.
 *
 * When the DB constraint is migrated to canonical names, the entire
 * intended diff is "delete this file." Until then, every read/write that
 * crosses the boundary funnels through these two helpers, so there is
 * exactly one place to audit.
 *
 * The `uncategorized` DB value has no canonical equivalent — it's a
 * schema artifact, not an editorial pillar — and is intentionally absent
 * from this map. Callers that need to write `uncategorized` go around
 * this translation layer (or fail, which is the safer default).
 */
export const CANONICAL_TO_DB = Object.freeze({
  ai_magic: 'ai_magic',
  parenting_insights: 'parenting',
  mom_health: 'health',
  tech_for_moms: 'tech',
  trending: 'trending',
  financial: 'financial',
});

export const DB_TO_CANONICAL = Object.freeze(
  Object.fromEntries(
    Object.entries(CANONICAL_TO_DB).map(([k, v]) => [v, k]),
  ),
);

export const CANONICAL_PILLARS = Object.freeze(Object.keys(CANONICAL_TO_DB));
export const DB_PILLARS = Object.freeze(Object.values(CANONICAL_TO_DB));

export function toDbPillar(canonical) {
  const db = CANONICAL_TO_DB[canonical];
  if (!db) {
    throw new Error(
      `pillar_translation.toDbPillar: unknown canonical pillar "${canonical}". ` +
        `Valid: ${CANONICAL_PILLARS.join(', ')}`,
    );
  }
  return db;
}

export function toCanonicalPillar(db) {
  const canonical = DB_TO_CANONICAL[db];
  if (!canonical) {
    throw new Error(
      `pillar_translation.toCanonicalPillar: unknown DB pillar "${db}". ` +
        `Valid: ${DB_PILLARS.join(', ')}`,
    );
  }
  return canonical;
}

export function isCanonicalPillar(value) {
  return Object.prototype.hasOwnProperty.call(CANONICAL_TO_DB, value);
}

export function isDbPillar(value) {
  return Object.prototype.hasOwnProperty.call(DB_TO_CANONICAL, value);
}
