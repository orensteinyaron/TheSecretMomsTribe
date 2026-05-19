---
name: avatar-full-wardrobe-rotation
description: Wardrobe management for Rachel (Face of SMT). Picks the next look for an Avatar Full render using LRU rotation with cooldown=2; generates new candidate looks via Higgsfield Soul 2.0 for Yaron's approval; manages the active/pending/retired lifecycle of the look pool. Use when any Avatar Full render initializes, when adding a new wardrobe variation to Rachel's rotation, or when approving/retiring looks. Triggers on phrases like "pick Rachel's look", "next wardrobe", "which look should this render use", "rotate Rachel's wardrobe", "create a new look for Rachel", "generate a new wardrobe", "add a look to the pool", "approve the pending look", "retire look_X", and on any Avatar Full render init phase invocation.
---

# Avatar Full — Wardrobe Rotation Skill

Rachel's wardrobe is a pool of looks stored in the `rachel_looks` table. Each look is a Soul 2.0 still generated via Higgsfield, tagged with a wardrobe description (clothing + setting), and assigned a lifecycle status (`pending` / `active` / `retired`). At render time, the orchestrator picks the next active look using an LRU algorithm with a cooldown of 2, so the same look is never used in two consecutive renders. New looks are generated as candidates, reviewed by Yaron, and explicitly approved before they join the active pool. This skill covers all three phases: pick, create, and manage.

## When to use

- **Avatar Full render init** — the orchestrator needs a `look_id` to pass as `start_image`/`end_image` to Seedance. Call `pickNextLook` from the active pool.
- **Adding a new wardrobe variation** — Yaron wants a new outfit or setting. Generate Soul 2.0 candidates (`create_new_look`), surface the stills, get approval, then `approveLook`.
- **Pool management** — approve a pending look that passed visual review, or retire an active look that no longer fits the brand. Managed via `approveLook` / `retireLook`.

## Sub-flow A — pick_next_look

For the render init case: select which look to use for this render.

**Inputs:** none — queries the DB directly.

**Behavior:**
1. Call `listActiveLooks()` to get the current active pool (status = `active`).
2. Call `getRecentPicks(WARDROBE_COOLDOWN)` to get the last N looks used.
3. Call `pickNextLook(activeLooks, recentPicks)` — pure LRU with cooldown. Returns the `look_id` of the selected look (least recently used that is not in the cooldown window).

**Returns:** `look_id` (string, e.g. `look_03`)

**Where the code lives:**
- Pure logic: `video/lib/wardrobe-rotation/pick-next-look.ts`
- I/O: `video/lib/wardrobe-rotation/db.ts`
- Public API: `video/lib/wardrobe-rotation/index.ts`

**Caller integration note (PR-A):** the orchestrator's render init phase will call `pickNextLook(...)`, persist the result to `content_queue.avatar_config.look_id`, and pass the corresponding `soul_still_url` to Seedance as `start_image`/`end_image`. This integration site is created in PR-B once Avatar Full v5 merges. Sub-flow A is fully callable now but is not yet wired into any production renderer.

## Sub-flow B — create_new_look

For adding a new wardrobe variation to the candidate pool.

**Inputs:**

| field | type | required | notes |
|---|---|---|---|
| `wardrobe` | string | yes | outfit description (no identity features) |
| `setting` | string | yes | environment / background |
| `notes` | string | no | optional style notes |
| `variation_count` | number | no | 1-4, default 3 |

**Behavior:**
1. Call `assembleLookPrompt(wardrobe, setting)` — prepends the wardrobe+setting description to the canon tail, then runs `FORBIDDEN_RE` against the result. If any identity feature is detected, the call throws before any generation happens.
2. For each variation, call Higgsfield `generate_image` with Soul 2.0 and Rachel's `soul_id`. Poll until complete.
3. Insert each variation into `rachel_looks` with `status = 'pending'` and a sequential `look_NN` id (via `generateNextLookId()`).

**Returns:**
```json
{
  "candidate_look_ids": ["look_04", "look_05", "look_06"],
  "candidates": [
    { "look_id": "look_04", "soul_still_id": "...", "soul_still_url": "..." }
  ]
}
```

**CRITICAL — approval gate:** generating candidates does NOT add them to rotation. The looks are inserted with `status='pending'`. Yaron must review the returned stills and explicitly approve at least one via `approveLook(look_id)` before it appears in the picker's `activeLooks` pool. Unwanted candidates should be `retireLook`-ed (subject to the floor-3 guard — if retire would drop the active count below 3, leave the candidate as pending instead, or skip retire).

**MCP calling shape** (validated in Task 0 preflight):
```
mcp__78d93fcf-...__generate_image({
  model: 'soul_2',
  soul_id: '34a349a6-d6d9-423f-8c80-e4b4c8d6e770',  // Rachel
  prompt: '<assembled prompt — wardrobe + setting + canon tail>',
  count: 1-4,
  aspect_ratio: '9:16',
  quality: '2k',
})
```
Returns `{ job_id }`. Poll `mcp__78d93fcf-...__job_display` until complete.

**Cost:** 0.36 credits exact for 3 stills (~$0.04 USD).

**Transport note (DI / GenerateImagesFn):** `createNewLook` accepts a `GenerateImagesFn` callback so the MCP call is injected by the executing Claude session rather than hardcoded in the library. Wire it like this:

```ts
const generateImages: GenerateImagesFn = async (input) => {
  const { job_id } = await callMcp('mcp__78d93fcf-...__generate_image', input);
  const result = await pollMcpJob(job_id);
  return result.images.map(img => ({ soul_still_id: img.id, soul_still_url: img.url }));
};
await createNewLook({ wardrobe, setting }, generateImages);
```

The actual `callMcp`/`pollMcpJob` shapes depend on the executing harness's MCP tool surface — Claude infers them at call time.

## Sub-flow C — manage_looks

For approving or retiring looks after visual review.

**`approveLook(look_id)`**
- Transitions `pending` → `active`, sets `approved_at` to now.
- Throws if the look is not in `pending` status.

**`retireLook(look_id)`**
- Transitions `active` → `retired`, sets `retired_at` to now.
- Throws if the look is not in `active` status.
- **Floor-3 guard:** refuses if the current active count is 3 or fewer. The error message includes the current count. This prevents the picker from being left with fewer than 3 viable options.

**Where the code lives:**
- `video/lib/wardrobe-rotation/approve-look.ts`
- `video/lib/wardrobe-rotation/retire-look.ts`

## Architecture

| Component | Location |
|---|---|
| DB table | `rachel_looks` — `supabase/migrations/20260519140000_create_rachel_looks.sql` |
| Canon / source of truth | `FACE_OF_SMT_V1.md` |
| Mutable registry | `rachel_looks` DB table (status, timestamps, soul_still_url) |
| Public API | `video/lib/wardrobe-rotation/index.ts` |

The canon (`FACE_OF_SMT_V1.md`) defines who Rachel is and what Soul 2.0 carries intrinsically. The DB table tracks the runtime wardrobe pool. These two sources never conflict — the DB only stores wardrobe metadata (look IDs, settings, URLs, lifecycle status), never identity.

## Hard rules (do not violate)

- **No identity features in Soul 2.0 prompts.** Wardrobe prompts must describe clothing, setting, and mood — never skin tone, freckles, scars, hair color, age, or any facial feature. Soul carries identity via `soul_id`. Injecting feature directives causes hallucination. `assembleLookPrompt` enforces this with `FORBIDDEN_RE`; if the regex throws, do not proceed.
- **Pool floor of 3 active looks.** The picker requires at least 3 active looks to function without bias. `retireLook` enforces this with a hard guard. If a retire would break the floor, leave the look as pending or contact Yaron to approve additional candidates first.

## Version

v1.0 — 2026-05-20. PR-A: standalone infra (no renderer integration). PR-B: phaseInit integration once Avatar Full v5 lands.
