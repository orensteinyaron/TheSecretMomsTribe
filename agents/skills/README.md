# SMT Agent Skills

This directory is the runtime source of truth for what each of the four SMT
content-pipeline agents actually does. The agents themselves are thin shells:
they load a SKILL.md at startup, hand it to the LLM as the system prompt,
and rely on TypeScript gate validators to verify the LLM obeyed.

## The four agents

| Canonical slug          | Directory                        | Display name (agents table)   |
|-------------------------|----------------------------------|-------------------------------|
| `smt_orchestrator`      | `smt_orchestrator/`              | System Orchestrator           |
| `smt_research`          | `smt_research/`                  | Research Agent                |
| `smt_strategist_daily`  | `smt_strategist_daily/`          | Strategist - Daily Pulse      |
| `smt_content_text_gen`  | `smt_content_text_gen/`          | Content Agent - Text Gen      |

The slug is the **skill identifier** — what `loadSkill('smt_research')`
resolves to. It is intentionally distinct from the human-readable display
name in the `agents` DB table; changing one does not change the other.

## Load order

`loadSkill(agentSlug)` assembles the system prompt in this exact order:

1. **`SMT_PIPELINE_CONTRACT.md`** — the cross-agent contract. Loaded first so
   the agent has the contract in mind before reading its own role-specific
   instructions.
2. **`<agentSlug>/SKILL.md`** — the agent's own behavior, framed as "what
   to do, given the contract above."
3. **(content_text_gen only) Companion files** in this exact order:
    1. `prompts/brand-voice.md`            (referenced as `brand_voice_bible.md`)
    2. `prompts/content-dna.md`            (referenced as `content_dna_framework.md`)
    3. `prompts/visual-design.md`          (referenced as `visual_design_guide.md`)
    4. `FACE_OF_SMT_V1.md`                 (referenced as `face_of_smt_v1.md`)

The companion files referenced in `smt_content_text_gen`'s frontmatter use
canonical names; the SKILL author chose names that describe the file's
purpose, not the path on disk. The skill loader translates between the two.

## Contract-wins precedence

If `SMT_PIPELINE_CONTRACT.md` and a `SKILL.md` disagree, the contract wins.
The contract is the schema/protocol layer; the SKILL is role behavior on
top of that schema. If a SKILL ever appears to override the contract, treat
that as a bug in the SKILL and file a v-bump request.

## Pillar translation boundary

The SKILL.md files speak the **canonical** pillar vocabulary, which uses
the long, editorial names:

- `ai_magic`, `parenting_insights`, `mom_health`, `tech_for_moms`,
  `trending`, `financial`

The `content_queue.content_pillar` column uses the **DB** vocabulary, which
uses short names from a pre-V1.0 era we have not yet migrated:

- `ai_magic`, `parenting`, `health`, `tech`, `trending`, `financial`

The single boundary between these two vocabularies is
`agents/lib/pillar_translation.js`. The orchestrator translates canonical →
DB at the exact point of insert into `content_queue`. Nowhere else in the
codebase should the translation appear; if you find a second site, that is
a bug.

When we eventually migrate the DB constraint to canonical names, the entire
intended diff is "delete `pillar_translation.js`."

## How to update a skill

1. Edit the SKILL.md (or the contract, if the change is cross-agent).
2. Bump `version:` in its frontmatter.
3. Add a CHANGELOG entry with the date and a one-line summary.
4. If the change is a tightening of a gate, add a regression test under
   `regression_tests/` that would have caught the bug the tightening
   prevents.
5. Commit. The next pipeline run automatically picks up the new version —
   no agent code change is needed, because the agent loads the file at
   startup.

`pipeline_runs.contract_version` and `agent_runs.skill_version` record the
exact versions in force for every run, so you can rebuild "what produced
this row" purely from DB state.
