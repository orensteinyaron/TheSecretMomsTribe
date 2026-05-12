/**
 * Skill loader for the four SMT pipeline agents.
 *
 * Each agent loads its behavior from a versioned SKILL.md at runtime, not
 * from a hardcoded SYSTEM_PROMPT in code. The cross-agent contract
 * (`SMT_PIPELINE_CONTRACT.md`) is prepended to every skill, so every agent
 * sees the same handoff schema before reading its own role-specific
 * instructions.
 *
 * The loader is process-scoped (one cache per Node process). Tests call
 * `clearSkillCache()` to reset state between cases.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const SKILLS_DIR = resolve(REPO_ROOT, 'agents', 'skills');
const CONTRACT_PATH = resolve(SKILLS_DIR, 'SMT_PIPELINE_CONTRACT.md');

const CANONICAL_SLUGS = Object.freeze([
  'smt_orchestrator',
  'smt_research',
  'smt_strategist_daily',
  'smt_content_text_gen',
]);

/**
 * Companion files referenced by SKILL frontmatter (logical name) →
 * resolved path on disk. Only `smt_content_text_gen` uses these; the
 * SKILL author chose canonical names that describe purpose, not file
 * location. The loader translates here so the SKILL stays clean.
 */
const COMPANION_PATHS = Object.freeze({
  brand_voice_bible: resolve(REPO_ROOT, 'prompts', 'brand-voice.md'),
  content_dna_framework: resolve(REPO_ROOT, 'prompts', 'content-dna.md'),
  visual_design_guide: resolve(REPO_ROOT, 'prompts', 'visual-design.md'),
  face_of_smt_v1: resolve(REPO_ROOT, 'FACE_OF_SMT_V1.md'),
});

const SKILLS_WITH_COMPANIONS = Object.freeze({
  smt_content_text_gen: [
    'brand_voice_bible',
    'content_dna_framework',
    'visual_design_guide',
    'face_of_smt_v1',
  ],
});

const cache = new Map();

/**
 * Parse a `---\nkey: value\nkey: value\n---` YAML frontmatter block. We
 * intentionally do not pull a YAML dependency: every frontmatter field in
 * the SKILL.md files is either a flat scalar or a single-level list, and
 * a 30-line parser is auditable.
 *
 * Returns `{ frontmatter, body }`. If no frontmatter is present, returns
 * `{ frontmatter: {}, body: <whole file> }`.
 */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: raw };
  }
  const yamlBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');

  const frontmatter = {};
  let currentListKey = null;
  for (const line of yamlBlock.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('  - ') && currentListKey) {
      const item = line.slice(4).trim();
      frontmatter[currentListKey].push(item);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === '') {
      frontmatter[key] = [];
      currentListKey = key;
    } else {
      frontmatter[key] = rest.replace(/^["']|["']$/g, '');
      currentListKey = null;
    }
  }
  return { frontmatter, body };
}

function readSkillFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`skill_loader: failed to read ${path}: ${err.message}`);
  }
  return parseFrontmatter(raw);
}

function buildCompanionSection(slug) {
  const companions = SKILLS_WITH_COMPANIONS[slug];
  if (!companions) return '';
  const blocks = [];
  for (const name of companions) {
    const path = COMPANION_PATHS[name];
    if (!path) {
      throw new Error(`skill_loader: no path mapping for companion "${name}"`);
    }
    let content;
    try {
      content = readFileSync(path, 'utf-8');
    } catch (err) {
      throw new Error(
        `skill_loader: ${slug} references companion "${name}" but ${path} is unreadable: ${err.message}`,
      );
    }
    blocks.push(`# ${name}\n\n${content.trim()}`);
  }
  return blocks.join('\n\n---\n\n');
}

/**
 * Load and assemble the runtime system prompt for one of the four SMT
 * agents. Throws on unknown slugs — there is intentionally no fallback,
 * because typos here silently route the wrong instructions to the LLM.
 *
 * Returns:
 *   {
 *     agentSlug,            // the slug requested
 *     systemPrompt,         // contract + skill (+ companions for content)
 *     skillVersion,         // SKILL.md frontmatter `version`
 *     contractVersion,      // contract frontmatter `version`
 *     loadedAt,             // ISO timestamp of first assembly
 *   }
 */
export async function loadSkill(agentSlug) {
  if (!CANONICAL_SLUGS.includes(agentSlug)) {
    throw new Error(
      `skill_loader: unknown agent slug "${agentSlug}". ` +
        `Valid slugs: ${CANONICAL_SLUGS.join(', ')}`,
    );
  }

  if (cache.has(agentSlug)) {
    return cache.get(agentSlug);
  }

  const contract = readSkillFile(CONTRACT_PATH);
  const skillPath = resolve(SKILLS_DIR, agentSlug, 'SKILL.md');
  const skill = readSkillFile(skillPath);

  const parts = [contract.body.trim(), skill.body.trim()];
  const companionSection = buildCompanionSection(agentSlug);
  if (companionSection) parts.push(companionSection);

  const systemPrompt = parts.join('\n\n---\n\n');

  const loaded = {
    agentSlug,
    systemPrompt,
    skillVersion: skill.frontmatter.version || 'unversioned',
    contractVersion: contract.frontmatter.version || 'unversioned',
    loadedAt: new Date().toISOString(),
  };
  cache.set(agentSlug, loaded);
  return loaded;
}

export function clearSkillCache() {
  cache.clear();
}

export const CANONICAL_SKILL_SLUGS = CANONICAL_SLUGS;
