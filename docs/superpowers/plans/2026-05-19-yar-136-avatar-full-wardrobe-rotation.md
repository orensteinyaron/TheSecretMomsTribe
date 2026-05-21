# YAR-136 — Avatar Full Wardrobe Rotation Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an LRU wardrobe-rotation system for Rachel (cooldown=2) backed by a DB ledger, plus a "create new look" flow that generates Higgsfield Soul 2.0 candidates for Yaron's approval, exposed as a Skill so it's reusable wherever Avatar Full work happens.

**Architecture:** New Supabase table `rachel_looks` replaces the imagined hardcoded ledger. A pure-function LRU picker (no I/O) sits behind a thin DB layer. The Avatar Full v5 renderer's init phase calls the picker once per render and persists `look_id` to `content_queue.avatar_config`. New looks are minted via Higgsfield Soul 2.0 → inserted `pending` → manually promoted to `active` via skill commands. A `skills/avatar-full-wardrobe-rotation/SKILL.md` is the human-and-orchestrator entry point for all three sub-flows (pick / create / manage).

**Tech Stack:** TypeScript (matches existing `video/lib/*.ts`), Node `--test` runtime via `tsx`, `@supabase/supabase-js`, Higgsfield MCP for Soul 2.0 generation, plain SQL migrations (no ORM).

---

## PR scope (locked 2026-05-19 by Yaron)

**This plan ships as PR-A only.** PR-B (v5 integration) is a separate follow-up plan, blocked on the v5 renderer merging into `main`.

### PR-A (this plan) — standalone wardrobe infrastructure
- Migration: `rachel_looks` table + Look #1 seed
- `video/lib/wardrobe-rotation/*` — types, pure-function picker, DB layer, generate-look-id, create-new-look, approve-look, retire-look, public index
- `skills/avatar-full-wardrobe-rotation/SKILL.md`
- TS test wiring in `npm test`
- `claude.md` pointer
- No integration site changes — the picker is callable but no production renderer calls it yet
- After merge: bootstrap session with Yaron to run `createNewLook` ~10× and approve looks 2-11

### PR-B (follow-up, blocked on v5) — Avatar Full v5 phaseInit integration
- Wire `pickNextLook` into `video/scripts/render-avatar-full-v5.ts` `phaseInit`
- Persist `look_id` to `content_queue.avatar_config` with post-write verify
- Pass `look.soul_still_url` to Seedance `start_image`/`end_image`
- Deprecate `RACHEL_SOUL_STILL_*` aliases in `avatar-constants.ts`
- Update `docs/specs/AVATAR_FULL_V5.md` "Follow-ups"
- Smoke 1, 3 (require a live render through v5) — moved to PR-B
- Smoke 2 (createNewLook + approve + retire) — runs in PR-A's post-merge bootstrap session

### Resolved blockers
- **Soul stills:** seed Look #1 only; bootstrap looks 2-11 via skill post-merge.
- **v5 sequencing:** split into PR-A (this) + PR-B (follow-up). PR-A is mergeable today.
- **TS tests:** extend `npm test` to run `video/lib/**/__tests__/*.test.ts` via `tsx`.
- **Higgsfield MCP shape:** schema check is the first in-execution step (Task 0). Not a plan-time blocker.

---

## File Structure

### New files
```
skills/avatar-full-wardrobe-rotation/
  SKILL.md                                     -- skill entry point, 3 sub-flow triggers
video/lib/wardrobe-rotation/
  index.ts                                     -- public re-exports
  types.ts                                     -- RachelLook, RachelLookStatus, RecentPick
  pick-next-look.ts                            -- pure-function LRU picker (no I/O)
  db.ts                                        -- Supabase queries for rachel_looks
  generate-look-id.ts                          -- sequential look_NN generator (extracted for testability)
  create-new-look.ts                           -- Higgsfield Soul 2.0 candidate generator
  approve-look.ts                              -- pending → active
  retire-look.ts                               -- active → retired, with floor-3 guard
  __tests__/
    pick-next-look.test.ts
    generate-look-id.test.ts
supabase/migrations/
  20260519140000_create_rachel_looks.sql       -- table + index + seed (Look #1)
```

### Modified files
```
package.json                                   -- extend `test` script to run video/lib/**/__tests__/*.test.ts via tsx
claude.md                                      -- one-line pointer to skills/avatar-full-wardrobe-rotation/SKILL.md under the Agent Skills section
```

### Out of scope for PR-A (deferred to PR-B)
- `video/scripts/render-avatar-full-v5.ts` — does not exist on `main`; modified in PR-B
- `video/lib/avatar-constants.ts` — does not exist on `main`; deprecated aliases added in PR-B
- `docs/specs/AVATAR_FULL_V5.md` — does not exist on `main`; "Follow-ups" updated in PR-B

---

## DB Schema (full migration SQL)

```sql
-- supabase/migrations/20260519140000_create_rachel_looks.sql
BEGIN;

CREATE TABLE rachel_looks (
  look_id       text PRIMARY KEY,
  soul_still_id text NOT NULL,
  soul_still_url text NOT NULL,
  wardrobe      text NOT NULL,
  setting       text NOT NULL,
  notes         text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'retired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  retired_at    timestamptz,
  created_by    text NOT NULL,
  source        text NOT NULL DEFAULT 'skill_v1'
                CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_looks_status_idx ON rachel_looks(status);

COMMENT ON TABLE rachel_looks IS
  'Mutable registry of Higgsfield Soul 2.0 stills for Rachel (Face of SMT). '
  'Canon doc FACE_OF_SMT_V1.md governs aesthetic intent; this table governs runtime rotation. '
  'Looks are picked LRU with cooldown=2 by video/lib/wardrobe-rotation/pick-next-look.ts.';

COMMENT ON COLUMN rachel_looks.status IS
  'pending = generated, awaiting Yaron approval; '
  'active = in rotation; retired = removed from pool, history preserved.';

COMMENT ON COLUMN rachel_looks.source IS
  'canon_seed = inserted by migration from FACE_OF_SMT_V1.md; '
  'skill_v1 = generated via skills/avatar-full-wardrobe-rotation create_new_look flow.';

-- Seed: Look #1 only. The other 10 canon looks have no Soul still IDs/URLs;
-- they will be minted via the skill's create_new_look flow (see YAR-136 spec).
INSERT INTO rachel_looks (
  look_id, soul_still_id, soul_still_url, wardrobe, setting, notes,
  status, approved_at, created_by, source
) VALUES (
  'look_01',
  'f757b09c-d94d-4ade-a076-4a1a496c641e',
  'https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png',
  'cozy cream knit sweater, loose half-up hair',
  'home interior, natural warm light',
  'Canon Look #1 — the production-locked still used for every Avatar Full render up to YAR-136. Pre-existing reference; carried forward as seed.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

COMMIT;
```

**Note:** the migration intentionally **does not** insert looks 2-11. That's the bootstrap path described in Blocker 1. The plan is portable to "seed all 11" if Yaron decides to pre-generate the stills before this PR — just append 10 INSERTs.

---

## Cost preflight (Task 0 results, 2026-05-19)

Higgsfield MCP `generate_image` dry-run for `model: 'soul_2'`, `soul_id: RACHEL_SOUL_ID`, `aspect_ratio: '9:16'`, `count: 3`, `quality: '2k'`:
- **0.36 credits exact** (billed as 1 credit due to rounding) — ~$0.04 per `createNewLook` call.
- Current Higgsfield balance: 34 credits (Plus plan). Plenty of headroom.

**Confirmed MCP shape:**
- `count: 1–4` is supported in a single call (no loop needed for the default 3-per-call).
- `soul_id` is a top-level param (NOT nested under `medias`). Rachel's `34a349a6-d6d9-423f-8c80-e4b4c8d6e770` is `status: ready` in the workspace.
- Supported aspect ratios: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`. Using `9:16`.
- Explicit `quality: "2k"` to lock against future default-change.
- Async job pattern: `generate_image` returns a `job_id`; result is polled via `mcp__78d93fcf-...__job_display`. Same pattern as Seedance.
- `media_confirm` step needed only if the output is later fed into another generation as input (not required for PR-A — the still gets stored in `rachel_looks` and read by future renders via `soul_still_url`).
- (Future-tic, NOT in PR-A) `medias: [{value, role: 'image'}]` accepts one reference photo for outfit/background steering. Could be used later to pin outfits to real-world wardrobe references.

---

## Tasks

Each task is bite-sized (2–5 min steps). TDD where it applies. Commit per task.

### Task 0 — Higgsfield MCP schema check + cost preflight

**Files:** none (research step)

- [ ] **Step 1: Load Higgsfield MCP schemas** via `ToolSearch({ query: "higgsfield", max_results: 10 })` — find `generate_image`, `balance`, and any cost-related tools.

- [ ] **Step 2: Confirm calling shape** — does `generate_image` accept `count` for multi-variation, or must we loop? Document the answer inline in `create-new-look.ts` JSDoc.

- [ ] **Step 3: Confirm aspect ratio support** — `'9:16'` matches Look #1's 9:16 still. Verify the MCP accepts this literal.

- [ ] **Step 4: Cost preflight** — call the appropriate dry-run / get_cost path for one `generate_image` at `model: 'soul_2'`, `soul_id: RACHEL_SOUL_ID`, `aspect_ratio: '9:16'`, `count: 3` (or 1 × loop). Multiply through. Paste exact dollar figure into this plan's "Cost preflight" section (replacing the placeholder) and into the PR description.

- [ ] **Step 5: No commit** — research only. Findings inform Task 8 implementation.

### Task 1 — Migration: create `rachel_looks` table + seed Look #1

**Files:**
- Create: `supabase/migrations/20260519140000_create_rachel_looks.sql`

- [ ] **Step 1: Write the migration file** with the SQL above (full body, BEGIN/COMMIT, table + index + comments + Look #1 INSERT).

- [ ] **Step 2: Apply migration locally** (via `mcp__7ec6faff-..__apply_migration` against the dev branch, or `supabase db push` if that's the local convention — check `tasks/lessons.md` for the SMT migration runbook before deciding).

- [ ] **Step 3: Verify table state**
  ```sql
  SELECT look_id, status, source, soul_still_id FROM rachel_looks ORDER BY look_id;
  ```
  Expected: 1 row, `look_01`, `status=active`, `source=canon_seed`, `soul_still_id=f757b09c-d94d-4ade-a076-4a1a496c641e`.

- [ ] **Step 4: Commit**
  ```bash
  git add supabase/migrations/20260519140000_create_rachel_looks.sql
  git commit -m "feat(wardrobe): create rachel_looks table + seed canon Look #1 (YAR-136)"
  ```

### Task 2 — Types

**Files:**
- Create: `video/lib/wardrobe-rotation/types.ts`

- [ ] **Step 1: Write types** as specified in spec (`RachelLook`, `RachelLookStatus`, `RecentPick`, `CreateLookInput`, `CreateLookResult`). Verbatim from spec — no schema additions.

- [ ] **Step 2: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/types.ts
  git commit -m "feat(wardrobe): add RachelLook + LRU picker types (YAR-136)"
  ```

### Task 3 — Pure LRU picker (TDD)

**Files:**
- Create: `video/lib/wardrobe-rotation/pick-next-look.ts`
- Test: `video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts`

- [ ] **Step 1: Write failing tests** — all cases from spec:

  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { pickNextLook, WARDROBE_COOLDOWN } from '../pick-next-look.ts';

  // Helper: synthesize 11 look_ids
  const eleven = Array.from({ length: 11 }, (_, i) => `look_${String(i + 1).padStart(2, '0')}`);

  test('WARDROBE_COOLDOWN is 2', () => {
    assert.equal(WARDROBE_COOLDOWN, 2);
  });

  test('empty history with 11 active looks returns look_01', () => {
    assert.equal(pickNextLook(eleven, []), 'look_01');
  });

  test('11 sequential calls cycle through all 11 looks with no consecutive repeat and no repeat within cooldown=2 window', () => {
    const history: { look_id: string; used_at: string }[] = [];
    const picks: string[] = [];
    for (let i = 0; i < 11; i++) {
      const pick = pickNextLook(eleven, history);
      picks.push(pick);
      history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
    }
    // No duplicates in first 11 picks
    assert.equal(new Set(picks).size, 11);
    // No repeat within any 2-pick window
    for (let i = 2; i < picks.length; i++) {
      assert.notEqual(picks[i], picks[i - 1]);
      assert.notEqual(picks[i], picks[i - 2]);
    }
  });

  test('22 sequential calls — each look appears exactly twice; 12th pick equals 1st', () => {
    const history: { look_id: string; used_at: string }[] = [];
    const picks: string[] = [];
    for (let i = 0; i < 22; i++) {
      const pick = pickNextLook(eleven, history);
      picks.push(pick);
      history.push({ look_id: pick, used_at: new Date(Date.now() + i * 1000).toISOString() });
    }
    const counts = picks.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }), {});
    for (const id of eleven) assert.equal(counts[id], 2);
    assert.equal(picks[11], picks[0]);
  });

  test('history [look_01, look_02] → next pick is never look_01 or look_02', () => {
    const now = Date.now();
    const history = [
      { look_id: 'look_01', used_at: new Date(now - 2000).toISOString() },
      { look_id: 'look_02', used_at: new Date(now - 1000).toISOString() },
    ];
    const pick = pickNextLook(eleven, history);
    assert.notEqual(pick, 'look_01');
    assert.notEqual(pick, 'look_02');
  });

  test('deterministic — same input returns same output', () => {
    const history = [
      { look_id: 'look_03', used_at: '2026-05-19T10:00:00Z' },
      { look_id: 'look_01', used_at: '2026-05-19T10:01:00Z' },
    ];
    const a = pickNextLook(eleven, history);
    const b = pickNextLook(eleven, history);
    assert.equal(a, b);
  });

  test('only 2 active looks with cooldown=2 → fallback to oldest-used active look', () => {
    const two = ['look_01', 'look_02'];
    const history = [
      { look_id: 'look_01', used_at: '2026-05-19T10:00:00Z' },
      { look_id: 'look_02', used_at: '2026-05-19T10:01:00Z' },
    ];
    // Both blocked by cooldown; fallback returns oldest = look_01
    assert.equal(pickNextLook(two, history), 'look_01');
  });

  test('tie-break: equal recency → ascending look_id', () => {
    const three = ['look_01', 'look_02', 'look_03'];
    const sameTime = '2026-05-19T10:00:00Z';
    const history = [
      { look_id: 'look_02', used_at: sameTime },
      { look_id: 'look_03', used_at: sameTime },
    ];
    // look_01 never used → it wins. But if we pin to candidates only after cooldown:
    // history's 2 most-recent are look_02, look_03 → blocked. candidates = [look_01]. pick = look_01.
    assert.equal(pickNextLook(three, history), 'look_01');
  });
  ```

- [ ] **Step 2: Run tests, verify they fail**
  ```bash
  npx tsx --test video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts
  ```
  Expected: all tests fail with "Cannot find module ../pick-next-look.ts".

- [ ] **Step 3: Implement `pick-next-look.ts`**

  ```ts
  // video/lib/wardrobe-rotation/pick-next-look.ts
  import type { RecentPick } from './types.ts';

  export const WARDROBE_COOLDOWN = 2;

  export function pickNextLook(activeLooks: string[], recentlyUsed: RecentPick[]): string {
    if (activeLooks.length === 0) {
      throw new Error('pickNextLook: no active looks available');
    }
    const sortedActive = [...activeLooks].sort();
    if (recentlyUsed.length === 0) return sortedActive[0];

    const sortedRecent = [...recentlyUsed].sort(
      (a, b) => new Date(b.used_at).getTime() - new Date(a.used_at).getTime(),
    );
    const blocked = new Set<string>();
    for (const p of sortedRecent) {
      if (blocked.size >= WARDROBE_COOLDOWN) break;
      blocked.add(p.look_id);
    }
    const candidates = sortedActive.filter((id) => !blocked.has(id));

    if (candidates.length === 0) {
      // Fewer active looks than cooldown — fall back to active look with oldest used_at.
      const lastUsed = new Map<string, number>();
      for (const p of recentlyUsed) {
        const t = new Date(p.used_at).getTime();
        const prev = lastUsed.get(p.look_id);
        if (prev === undefined || t > prev) lastUsed.set(p.look_id, t);
      }
      return [...sortedActive].sort((a, b) => {
        const ta = lastUsed.get(a) ?? -Infinity;
        const tb = lastUsed.get(b) ?? -Infinity;
        if (ta !== tb) return ta - tb;
        return a.localeCompare(b);
      })[0];
    }

    // Among candidates: pick the one whose most-recent usage is oldest. Never-used = -Infinity (oldest).
    const lastUsed = new Map<string, number>();
    for (const p of recentlyUsed) {
      const t = new Date(p.used_at).getTime();
      const prev = lastUsed.get(p.look_id);
      if (prev === undefined || t > prev) lastUsed.set(p.look_id, t);
    }
    return [...candidates].sort((a, b) => {
      const ta = lastUsed.get(a) ?? -Infinity;
      const tb = lastUsed.get(b) ?? -Infinity;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    })[0];
  }
  ```

- [ ] **Step 4: Run tests, verify they pass**
  ```bash
  npx tsx --test video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/pick-next-look.ts video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts
  git commit -m "feat(wardrobe): pure-function LRU picker with cooldown=2 (YAR-136)"
  ```

### Task 4 — Wire TS tests into `npm test`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check tsx availability** — `npx tsx --version`. If not installed, `npm install --save-dev tsx`. (Confirm against v5's existing convention — multiple sibling-branch commits run `npx tsx --test` ad hoc, so tsx likely already resolvable.)

- [ ] **Step 2: Update `scripts.test`**
  Current: `"test": "node --test agents/lib/__tests__/*.test.js scripts/__tests__/*.test.js"`
  New: `"test": "node --test agents/lib/__tests__/*.test.js scripts/__tests__/*.test.js && tsx --test video/lib/**/__tests__/*.test.ts"`

- [ ] **Step 3: Run `npm test`** — confirm existing JS tests still pass AND the new TS picker tests run.

- [ ] **Step 4: Commit**
  ```bash
  git add package.json package-lock.json
  git commit -m "chore(test): run video/lib TS tests via tsx in npm test (YAR-136)"
  ```

### Task 5 — Look-ID generator (TDD)

**Files:**
- Create: `video/lib/wardrobe-rotation/generate-look-id.ts`
- Create: `video/lib/wardrobe-rotation/db.ts` (skeleton — only what Task 5 needs)
- Test: `video/lib/wardrobe-rotation/__tests__/generate-look-id.test.ts`

- [ ] **Step 1: Write failing tests**
  - Empty table → returns `look_01`.
  - Existing `look_11` → returns `look_12`.
  - Existing `look_99` → throws with a clear "look_id overflow" error message.
  - Gaps in numbering (`look_01`, `look_03`, `look_05`) → returns `look_06` (max+1, NOT gap-fill).

  Tests pass in a fake/array-backed "max look_id" lookup so they don't need a live DB. The pure function under test takes a `currentMaxLookId: string | null` and returns the next id.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** `nextLookIdFrom(currentMaxLookId: string | null): string` as a pure function. Parse numeric suffix; pad to 2 digits; overflow at 99 throws.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/generate-look-id.ts video/lib/wardrobe-rotation/__tests__/generate-look-id.test.ts
  git commit -m "feat(wardrobe): sequential look_NN generator with overflow guard (YAR-136)"
  ```

### Task 6 — DB layer

**Files:**
- Modify: `video/lib/wardrobe-rotation/db.ts`

- [ ] **Step 1: Implement** Supabase queries (matching the existing pattern in `agents/lib/` — read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env, use `@supabase/supabase-js`):
  - `listActiveLooks(): Promise<RachelLook[]>` — `WHERE status='active' ORDER BY look_id`
  - `listLooks(status?): Promise<RachelLook[]>` — optional filter
  - `getLook(look_id): Promise<RachelLook | null>`
  - `getRecentPicks(limit): Promise<RecentPick[]>` — `SELECT id, avatar_config->>'look_id' AS look_id, updated_at AS used_at FROM content_queue WHERE render_profile_id IN (<v5 + v1 fallback per Blocker 2>) AND avatar_config ? 'look_id' ORDER BY updated_at DESC LIMIT $1`
  - `insertLook(...): Promise<RachelLook>`
  - `updateLookStatus(look_id, status): Promise<RachelLook>` — also sets `approved_at` / `retired_at` based on target status
  - `generateNextLookId(): Promise<string>` — calls `nextLookIdFrom(maxLookId)` where maxLookId comes from `SELECT look_id FROM rachel_looks ORDER BY look_id DESC LIMIT 1`

- [ ] **Step 2: No unit tests for db.ts** (it's the thin I/O layer — covered by smoke test). Manual sanity: `npx tsx -e "import { listActiveLooks } from './video/lib/wardrobe-rotation/db.ts'; (async () => console.log(await listActiveLooks()))()"` should print 1 row (Look #1).

- [ ] **Step 3: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/db.ts
  git commit -m "feat(wardrobe): Supabase queries for rachel_looks (YAR-136)"
  ```

### Task 7 — Approve + retire flows

**Files:**
- Create: `video/lib/wardrobe-rotation/approve-look.ts`
- Create: `video/lib/wardrobe-rotation/retire-look.ts`

- [ ] **Step 1: Implement `approveLook(look_id)`** — load row; if `status !== 'pending'` throw with explicit message; call `updateLookStatus(id, 'active')` which sets `approved_at = now()`. Return updated row.

- [ ] **Step 2: Implement `retireLook(look_id)`** — load row; if `status !== 'active'` throw; **before** updating, query `SELECT COUNT(*) FROM rachel_looks WHERE status='active'` — if the count is < 4 (i.e. retiring would drop active count below 3), throw `"refusing to retire: only N active looks remain; pool floor is 3"`. Then `updateLookStatus(id, 'retired')` which sets `retired_at = now()`. Return updated row.

- [ ] **Step 3: Lightweight smoke** — insert a fake `pending` row via direct SQL, run `approveLook`, confirm row flips to `active` with `approved_at` populated, then run `retireLook` and confirm the floor-3 guard correctly **rejects** it (because we'd be at 1 active after retire). Cleanup test row.

- [ ] **Step 4: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/approve-look.ts video/lib/wardrobe-rotation/retire-look.ts
  git commit -m "feat(wardrobe): approve + retire flows with floor-3 guard (YAR-136)"
  ```

### Task 8 — Create new look (Higgsfield Soul 2.0)

**Files:**
- Create: `video/lib/wardrobe-rotation/create-new-look.ts`

- [ ] **Step 0: Cost preflight** (per spec). Call the Higgsfield MCP with `get_cost: true` (or whatever the schema names it after loading via ToolSearch) for one Soul 2.0 generation at the chosen aspect ratio. Multiply by `variation_count` (default 3). Record the dollar figure in the PR description.

- [ ] **Step 1: Implement `createNewLook(input)`**:
  1. Validate `variation_count` (default 3, clamp 1–10).
  2. Assemble prompt: `${wardrobe}, ${setting}` — plus a hardcoded canon-aligned tail: `"warm natural light, half-smile resting expression, vertical 9:16 portrait, no airbrushing"`. **Critically: do NOT mention skin tone, freckles, scar, hair color, or any identity feature** — Soul 2.0 carries identity via `soul_id`. Rule sourced from `skills/full-avatar-profile/SKILL.md` "Hard rules" §1.
  3. Call `mcp__78d93fcf-...__generate_image` with `model: 'soul_2'`, `soul_id: RACHEL_SOUL_ID`, the assembled prompt, `count: variation_count`, `aspect_ratio: '9:16'`. (Confirm `count` is supported via schema check; otherwise loop N times.)
  4. For each returned image: `generateNextLookId()` (sequential), insert row with `status='pending'`, `source='skill_v1'`, `created_by='skill_v1'` (TODO: thread real user identity when skill is invoked by Yaron vs orchestrator), `notes` left null unless input.notes provided.
  5. Return `{ candidate_look_ids, candidates: [{ look_id, soul_still_id, soul_still_url }] }`.

- [ ] **Step 2: Constant** — `RACHEL_SOUL_ID = '34a349a6-d6d9-423f-8c80-e4b4c8d6e770'` (from `skills/full-avatar-profile/SKILL.md` character library row). Lives in `video/lib/wardrobe-rotation/index.ts` re-export so the v5 work can pick it up without duplicating.

- [ ] **Step 3: No unit test for create-new-look** — it's an MCP-call wrapper. Covered by Smoke 2.

- [ ] **Step 4: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/create-new-look.ts video/lib/wardrobe-rotation/index.ts
  git commit -m "feat(wardrobe): createNewLook generates Soul 2.0 candidates as pending (YAR-136)"
  ```

### Task 9 — Public index + skill module

**Files:**
- Create: `video/lib/wardrobe-rotation/index.ts` (finalize)
- Create: `skills/avatar-full-wardrobe-rotation/SKILL.md`

- [ ] **Step 1: `index.ts`** re-exports `pickNextLook`, `WARDROBE_COOLDOWN`, `createNewLook`, `approveLook`, `retireLook`, `listActiveLooks`, `listLooks`, `getLook`, `getRecentPicks`, types, `RACHEL_SOUL_ID`.

- [ ] **Step 2: `SKILL.md`** — write with frontmatter (`name`, `description`) and three sub-flow sections. Description includes every trigger phrase the spec lists ("pick Rachel's look", "next wardrobe", "which look should this render use", "rotate Rachel's wardrobe", "create a new look for Rachel", "generate a new wardrobe", "add a look to the pool", "approve the pending look", "retire look_X", plus an init-phase invocation). Each sub-flow section: inputs, behavior, return shape, file pointer.

  Explicit text inside the `create_new_look` section: **"Generating candidates does NOT add them to rotation. The looks are inserted with `status='pending'`. Yaron must review the 3 returned stills and explicitly approve at least one via `approveLook(look_id)` before it appears in the picker's `activeLooks` pool. Unwanted candidates should be `retireLook`-ed (with the guard exception — if retire would drop active count below 3, leave as pending instead)."**

- [ ] **Step 3: Commit**
  ```bash
  git add skills/avatar-full-wardrobe-rotation/SKILL.md video/lib/wardrobe-rotation/index.ts
  git commit -m "feat(wardrobe): SKILL.md + public index for wardrobe-rotation (YAR-136)"
  ```

### Task 10 — Docs

**Files:**
- Modify: `claude.md`

- [ ] **Step 1: Add one-line pointer to `claude.md`** under the Agent Skills v1.0.0 section table or the skills list, referencing `skills/avatar-full-wardrobe-rotation/`. Keep entry concise — pattern matches existing skill pointers in that section.

- [ ] **Step 2: Commit**
  ```bash
  git add claude.md
  git commit -m "docs(claude.md): point at wardrobe-rotation skill (YAR-136)"
  ```

### Task 11 — Smoke tests (PR-A scope; gate merge)

**Smoke 2 — createNewLook returns 3 pending candidates, approve/retire flips state.**
Runs in a post-merge bootstrap session with Yaron (per Q1 resolution) BUT also runs once before PR-A merges to prove the flow works end-to-end.

- Pre-merge smoke (gates PR-A): `createNewLook({ wardrobe: 'olive linen jumpsuit, low ponytail', setting: 'backyard porch, afternoon light', variation_count: 3 })`
- Expected:
  - 3 new `rachel_looks` rows with `status='pending'`
  - 3 CDN-hosted Soul still URLs returned
  - Cost within ±10% of Task 0 preflight
  - Visual review: identity holds (Rachel is Rachel across all 3), wardrobe + setting reflected
- Approve one via `approveLook(look_id)`. Confirm DB flip + `approved_at` populated.
- Retire one of the other two via `retireLook(look_id)`. With 2 active looks, retiring would drop us to 1 (below floor of 3) — expect the **floor-3 guard to refuse** with a clear error. This is the guard test; treat the refusal as the success signal. Leave both rejected candidates as `pending` (they're not in rotation, no harm).
- Paste output (DB query + Soul still URLs) into PR description.

**Smoke 1 + Smoke 3 — deferred to PR-B** (require a live render through the v5 pipeline which doesn't exist on `main`).

- [ ] **Step 1: Run Smoke 2 pre-merge; paste results into PR body.**

---

## Open assumptions (call out, no need to wait for answers)

1. **Aspect ratio = 9:16** for new Soul 2.0 stills. Matches Look #1 and final video target. Confirmed via Task 0.
2. **`created_by = 'skill_v1'`** literal for skill-minted looks. Caller-identity detection (yarono vs orchestrator) is a future-tic enhancement.
3. **`getRecentPicks` window = last 5 renders.** Picker only needs `WARDROBE_COOLDOWN=2`-deep but 5 gives headroom for tie-breaking.
4. **`look_99` overflow → throw.** Format decision (look_100 vs reset) deferred.
5. **No canon-doc update in PR-A.** `FACE_OF_SMT_V1.md` stays as design intent. A one-paragraph "see rachel_looks for runtime registry" note can be a docs-only follow-up if Yaron wants.
6. **Skill description trigger words** — using spec's list verbatim plus "rotate wardrobe" (no Rachel's). Reviewable in Task 9 output.

---

## Out of scope

**PR-B (follow-up):**
- `phaseInit` integration into `video/scripts/render-avatar-full-v5.ts`
- Deprecated `RACHEL_SOUL_STILL_*` aliases in `avatar-constants.ts`
- `docs/specs/AVATAR_FULL_V5.md` "Follow-ups" update
- Smoke 1 (rotation picks fresh look on real render) + Smoke 3 (new look enters rotation)

**Per original spec:**
- Mid-video look changes
- Schema extension for `register` / `hands_visible` / `framing` / `setting` as first-class `content_queue.avatar_config` fields
- Pipeline UI surface for the look library
- Per-pillar look mapping
- Auto-canon-doc updates when a new look is approved

---

## Acceptance criteria (PR-A scope)

- [ ] Skill exists at `skills/avatar-full-wardrobe-rotation/SKILL.md` with trigger guidance for all 3 sub-flows.
- [ ] `rachel_looks` table created via migration, seeded with Look #1 (`status='active'`, `source='canon_seed'`).
- [ ] `pickNextLook` LRU with cooldown 2, deterministic, fully tested.
- [ ] `createNewLook` generates N candidates via Higgsfield Soul 2.0, inserts each as `pending`, returns metadata for review.
- [ ] `approveLook` + `retireLook` transition states with guards (floor of 3 active looks).
- [ ] `npm test` runs both JS and new TS tests; all pass.
- [ ] Smoke 2 documented in PR description with query results + Soul still URLs + cost-vs-preflight.
- [ ] `claude.md` updated to point at the new skill.
- [ ] No integration with Avatar Full renderer (deferred to PR-B).

### Post-merge bootstrap (separate session with Yaron)
- Run `createNewLook` ~10× against canon-derived wardrobe descriptions for looks 2-11.
- Approve one candidate per call; retire the unwanted candidates (subject to floor-3 guard until pool is large enough).
- Final state: 11 active looks in `rachel_looks` → picker has full LRU range to draw from.
