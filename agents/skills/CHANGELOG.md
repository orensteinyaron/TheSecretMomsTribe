# Agent Skills Changelog

## v1.0.0 — 2026-05-11

Initial extraction of orchestrator + agent system prompts into SKILL.md files under the smt_* namespace. Triggered by May 11 fabricated AI Magic incident.

- New skill files (read-only at v1.0.0):
  - `SMT_PIPELINE_CONTRACT.md` (v1.0.0) — single source of truth for handoffs
  - `smt_orchestrator/SKILL.md` (v1.0.0)
  - `smt_research/SKILL.md` (v1.0.0)
  - `smt_strategist_daily/SKILL.md` (v1.0.0)
  - `smt_content_text_gen/SKILL.md` (v1.0.0)
- Companion files referenced by `smt_content_text_gen` are resolved by the
  skill loader to their existing on-disk paths under `prompts/` and the repo
  root — see `agents/skills/README.md` for the mapping.
- TypeScript gate validators (`agents/lib/gate_validators.js`) and pillar
  translation layer (`agents/lib/pillar_translation.js`) introduced as the
  hard safety net beneath the LLM agents.
- Regression test for the May 11 fabricated `ai_magic` incident locked in at
  `agents/skills/regression_tests/may_11_fabricated_ai_magic.json`.
- Trigger layer kept as GitHub Actions cron. Claude Code Routines deferred
  to a later phase.
