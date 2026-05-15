---
name: smt-pipeline-contract
description: The single source of truth for what each agent owes the next in the SMT content pipeline. Every agent loads this file in addition to its own SKILL.md. If a field in this contract is missing on input, the agent MUST abort with a structured error instead of fabricating it. Use this whenever debugging a pipeline failure, designing a new agent, or changing the schema of any handoff between Research Agent, Strategist - Daily Pulse, or Content Agent - Text Gen.
version: 1.0.0
last_updated: 2026-05-11
owner: Yaron Orenstein
---

# SMT Pipeline Contract v1.0.0

This document is the **handoff schema** between agents. It is enforced at the row level. Every agent in the pipeline reads this file at startup and validates inputs against it before doing any work.

The pipeline is:

```
Research Agent
    │ produces: opportunity[]
    ▼
Strategist - Daily Pulse
    │ produces: briefing (curated, gated opportunity[])
    ▼
Content Agent - Text Gen
    │ produces: content_queue row
    ▼
[Render → Publish → Metrics → Learning]
```

## Non-negotiable principles

These are inviolable. Any agent that violates them must abort with `status='failed'` and a structured error.

1. **No fabrication.** No agent invents source content. If a field requires a verbatim artifact from a real source, the field must contain that artifact byte-for-byte or the row must be rejected. An agent never "fills in" what it thinks the source said.

2. **Gates over guesses.** Every agent runs a hard schema check before generating anything. If required fields are missing, the agent aborts. It does not attempt to recover by inferring.

3. **Pillar routing is structural, not optional.** A row's `content_pillar` is determined by the type of evidence carried in the row, not by the agent's editorial preference. The routing rules in this contract are the only valid mapping.

4. **One pillar per row.** A row belongs to exactly one pillar. If evidence supports multiple pillars, the row must be split or the strongest-evidenced pillar chosen with the rest discarded.

5. **Errors are first-class output.** Every agent's response schema includes a `rejected[]` array alongside its primary output. Rejected items carry a reason and the failing field. Rejection is not failure — it is the correct behavior when gates are not met.

## Pillar routing rules (the law)

A row's pillar is determined entirely by what evidence the underlying signal carries. The Research Agent assigns pillar by running this checklist top-down and stopping at the first match.

### `ai_magic` — STRICT GATE
A signal qualifies as `ai_magic` if and only if **all four** of the following are true:

- The source contains a **verbatim AI prompt** that was actually entered by a real person into a real tool (`original_prompt`, copy-pasteable as-is).
- The source contains the **verbatim AI output** that resulted from that prompt (`original_output`, the actual text/image/result the AI returned).
- The source identifies the **AI tool used** (`ai_tool_name`, e.g. "ChatGPT", "Claude", "Midjourney").
- The source URL is **publicly accessible and the artifact is visible at that URL** (not behind a login wall, not paraphrased by the scraper).

If any of these four is missing, the row **cannot** be `ai_magic`. Falling back to another pillar is allowed only if that pillar's gate is met.

A mom *asking* a question (e.g. "how do I tell my 4yo about her absent dad?") is **never** an AI Magic signal. It is a Parenting Insights signal. The question is not a prompt; the empathy in the responses is not an output.

### `parenting_insights`
Signals about parenting situations, emotional dynamics, child development, family communication. Mom-to-mom conversations on Reddit/IG/TikTok asking for advice or describing a moment with their kid land here by default. No verbatim AI artifact required.

### `health`
Signals about maternal mental load, burnout, nervous system, postpartum recovery, identity, marriage stress. Trust-builder content.

### `tech_for_moms`
Signals about specific apps, devices, services, or shortcuts that solve a mom's real-life logistical problem. Lead with the result, not the tool. Distinct from `ai_magic`: `tech_for_moms` is "I found a great app for tracking kids' schedules"; `ai_magic` requires a verbatim prompt + output.

### `trending`
Time-sensitive cultural moments: viral takes, news stories, studies the parenting internet is currently fighting about. Has a 72h expiry window.

### `financial`
First-person framing only. No specific products, stocks, crypto, tax, or legal. Mandatory caption disclaimer.

## Required fields by pillar

Every row that leaves any agent must conform to the pillar-specific schema below. Fields marked **REQUIRED** are gate fields — missing one causes rejection.

### All rows (regardless of pillar)
```
{
  "content_pillar": <one of the six>,             // REQUIRED
  "signal_id": <uuid of the source signal>,      // REQUIRED
  "source_url": <real, fetchable URL>,           // REQUIRED
  "source_platform": "reddit" | "tiktok" | "instagram" | "hacker_news" | "web",  // REQUIRED
  "source_creator": <username/handle if available, null if scraped>,
  "engagement": { "upvotes": int, "comments": int, "views": int },
  "age_range": "toddler" | "little_kid" | "school_age" | "teen" | "universal",  // REQUIRED
  "channel_type": "ai_native" | "mom_parenting" | "general",     // REQUIRED
  "signal_strength": int 1-10,
  "captured_at": ISO8601 timestamp
}
```

### Additional REQUIRED fields when `content_pillar == "ai_magic"`
```
{
  "original_prompt": <verbatim AI prompt from source, copy-pasteable, ≥10 chars>,   // REQUIRED
  "original_output": <verbatim AI output from source, ≥30 chars>,                   // REQUIRED
  "ai_tool_name": <tool used, e.g. "ChatGPT", "Claude", "Midjourney">,              // REQUIRED
  "artifact_excerpt_or_full": "full" | "excerpt"                                     // REQUIRED
}
```

If any of these four are missing or appear paraphrased, the row is **not** AI Magic. Reject or re-route.

### Additional fields for other pillars
- `trending`: `expires_at` (signal + 72h) REQUIRED.
- `financial`: `disclaimer_text` REQUIRED in caption.
- All other pillars: no additional required fields beyond the base.

## Handoff stages

### Stage 1: Research Agent → Strategist
Research outputs:
```json
{
  "opportunities": [<row>, <row>, ...],
  "rejected": [
    {"signal_id": "...", "reason": "ai_magic_gate_failed: missing original_output", "field": "original_output"},
    ...
  ],
  "stats": { "scanned": int, "kept": int, "rejected": int, "by_pillar": {...} }
}
```

Every row in `opportunities[]` already conforms to the schema above. The Strategist may *not* receive a row missing required fields. If Research's gate logic is uncertain about a row, the row goes into `rejected[]`, never into `opportunities[]`.

### Stage 2: Strategist → Content Agent
Strategist outputs a briefing:
```json
{
  "briefing_id": <uuid>,
  "opportunities": [<row>, ...],            // a subset of Research's, possibly re-ordered
  "priorities": [<signal_id>, ...],          // ordered by priority for the day
  "coverage_targets": { "ai_magic": int, "parenting_insights": int, ... },
  "rejected_from_research": [...],           // pass-through
  "notes_for_content_gen": <string>          // editorial guidance, NEVER includes invented content
}
```

The Strategist may re-rank but may **not** alter the gate-verified fields (`original_prompt`, `original_output`, etc.). The Strategist may **not** add invented examples (e.g. `"Show the prompt (e.g., 'My 4yo is asking…')"` — this is the exact failure mode that caused the May 11 incident).

### Stage 3: Content Agent → content_queue
Content Agent reads the briefing and produces one row per opportunity. For each row:

1. Validate that the opportunity passes its pillar's gate (defensive — Research and Strategist should have already done this).
2. If pillar is `ai_magic`, the `ai_magic_output` field in the content_queue row **must** quote `original_prompt` and `original_output` verbatim. The Content Agent may add framing language around them but may not modify them.
3. If the gate fails at this stage, the Content Agent aborts on that row with a `rejected[]` entry. It does not generate a fallback.

## Failure modes the contract prevents

This contract is designed to make these specific failures impossible:

1. **Fabricated AI prompts.** A signal that is not a verbatim AI artifact cannot enter the AI Magic pillar. The gate is the same at every stage. (May 11 incident.)

2. **Mis-routed pillars.** A Parenting Insights signal cannot be silently relabeled `ai_magic` because the editorial inputs to the content agent told it to "show the prompt."

3. **Cascading invention.** The Strategist cannot inject example prompts into its handoff. Editorial guidance is restricted to ordering, prioritization, and pillar mix — never to content invention.

4. **Silent rejection.** Anything dropped must appear in `rejected[]` with a reason. We can audit what was thrown out and why. Drift in the rejection rate is itself a learning signal.

5. **Cross-pillar bleed.** A row has exactly one pillar. No multi-tagging, no fallback inference at generation time.

## Versioning and learning loop

This contract is versioned. Any change to it requires:
- A new `version` in the frontmatter.
- A migration note in `CHANGELOG.md`.
- A regression test set (a stored input + expected output + expected rejected[]) that the new contract must pass.

When an incident occurs (like the May 11 fabrication), the workflow is:
1. Reproduce the failure with the affected `signal_id` against the current contract.
2. Identify which gate should have caught it.
3. If the gate is missing or weak, strengthen it in the contract and bump the version.
4. Add the failing case to the regression test set.
5. Re-run all skills against the regression set before deploying.

The contract gets smarter with every incident. Agents don't drift, because their behavior is defined here and validated against this file at runtime.

## How agents load this contract

Each agent's SKILL.md instructs it to read `SMT_PIPELINE_CONTRACT.md` at startup. The agent's system prompt is the concatenation of:

```
[Agent SKILL.md]
+
[SMT_PIPELINE_CONTRACT.md]
+
[Brand Voice Bible, Content DNA Framework, Visual Design Guide — for ContentGen only]
```

The agent treats the contract as authoritative. If its SKILL.md and the contract disagree, the contract wins, and the agent flags the disagreement in its output for review.
