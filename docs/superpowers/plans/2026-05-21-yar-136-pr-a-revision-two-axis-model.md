# YAR-136 PR-A Revision — Two-Axis Look/Location Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-axis `rachel_looks` model from PR-A v1 with an independent two-axis look (styling) + location (setting) model, with per-combination Soul stills cached in a new `rachel_stills` table. Ship bootstrap flows for canon-locked slots and a `pickCombination` orchestrator that drives both axes.

**Architecture:** Three Supabase tables (`rachel_looks` styling-only; `rachel_locations` with `tier` primary/secondary; `rachel_stills` per-combo cache with partial-unique-index for 1 active per combo). Pickers are independent pure functions: `pickLook` (LRU cooldown=3), `pickLocation` (tier-aware 5/7 primary ratio, within-tier cooldown=1). `pickCombination` composes them and returns the still or signals `needs_generation`. The v1 single-axis tables are renamed to `rachel_looks_legacy_v1` and preserved for 2 weeks of safety rollback.

**Tech Stack:** TypeScript (matches v1), Node `--test` via `tsx`, `@supabase/supabase-js`, Higgsfield MCP (DI transport — same shape as v1).

---

## PR strategy (decided 2026-05-21)

**Locked:** stay on `claude/hopeful-lehmann-92d945`, force-push the revision over v1 commits. PR #35 description gets rewritten to frame this as "v1 shipped, design flaw caught in review, revised before merge." Audit trail stays in one PR. Force-push is safe since #35 has no other reviewers and is unmerged.

---

## Cost preflight (Task 0 re-run, 2026-05-21)

Updated finding from a fresh `get_cost: true` call against `mcp__78d93fcf-...__generate_image`:

- `count: 4` returns `credits: 1, credits_exact: 0.12` — same as `count: 3` from the original Task 0.
- **Conclusion:** `credits_exact` is per-call, not per-image. The original Task 0 report (0.12 per-image) was wrong; v1 Smoke 2 also charged 1 credit (not 3 × 0.12 = 0.36).
- **Higgsfield `count` max is 4** per the schema, so a 6-candidate bootstrap requires 2 calls (e.g. `count: 4` + `count: 2`).

Concrete Smoke A+B+C+D budget:

| Smoke | Calls | Stills | Credits |
|---|---|---|---|
| A: bootstrapCanonLook(2) | 2 (count=4 + count=2) | 6 | 2 |
| B: bootstrapCanonLocation(2) | 2 (count=4 + count=2) | 6 | 2 |
| C: generateStill(look_02, location_02) | 1 (count=3) | 3 | 1 |
| D: forbidden-term guard test | 0 (regex throws before MCP) | 0 | 0 |
| **Total** | **5 calls** | **15 stills** | **5 credits (~$0.20)** |

Current Higgsfield balance: **33.64 credits** (Plus plan). Headroom is comfortable.

---

## Three corrections to the spec (proposed, see Open Questions §2)

### Correction 1 — `rachel_stills` unique constraint

Spec writes `UNIQUE (look_id, location_id, status)` but the comment says "allows multiple pending candidates per combination, but only one active." Those two contradict — a tuple-unique on `(look_id, location_id, status)` allows AT MOST ONE pending row per combo, breaking the bootstrap's 6-candidate pattern.

**Fix:** use a partial unique index for the active-only constraint:

```sql
CREATE UNIQUE INDEX rachel_stills_one_active_per_combo
  ON rachel_stills (look_id, location_id)
  WHERE status = 'active';
```

This allows N pending + N retired per combo (history preserved) but exactly 1 active per combo (the rendering invariant). Matches the spec's intent.

### Correction 2 — Higgsfield count max is 4

Spec says `bootstrapCanonLook` generates 6 candidates in "a call" to Higgsfield. The MCP schema caps `count` at 4. **Fix:** the bootstrap flow makes 2 sequential calls (e.g. `count: 4` then `count: 2`), aggregates the 6 results.

### Correction 3 — `generateStill` auto-approval semantics

Spec says `generateStill` produces `count=3` candidates with "auto-approve the first candidate" but doesn't specify what happens to the other 2. **Proposed:** insert all 3 as pending, then within the same flow immediately approve the first via `approveStill(still_id)` and retire the other 2 via `retireStill(still_id)`. The "first" means the first returned by Higgsfield (no quality scoring — that's a PR-B concern).

Final state: 1 active, 2 retired stills for that combo. The 2 retired stills stay in DB as audit trail.

---

## Migration SQL

**File:** `supabase/migrations/<NEW_TIMESTAMP>_split_looks_into_axes.sql`

Use the timestamp at file-creation time (UTC) in the `yyyyMMddhhmmss` format consistent with the existing migrations dir. For this plan I'll refer to it as `<NEW_TIMESTAMP>`.

```sql
-- YAR-136 PR-A Revision: split looks into two axes (look + location) with
-- per-combination still cache.
--
-- Preserves the v1 rachel_looks table data (Smoke 2 rows) by renaming to
-- _legacy_v1. Drop in a follow-up cleanup migration after 2 weeks of stability.

BEGIN;

-- 1. Preserve v1 table for rollback safety.
ALTER TABLE rachel_looks RENAME TO rachel_looks_legacy_v1;
ALTER INDEX rachel_looks_status_idx RENAME TO rachel_looks_legacy_v1_status_idx;

COMMENT ON TABLE rachel_looks_legacy_v1 IS
  'v1 single-axis look table from PR-A first pass. Preserved for rollback. '
  'Drop in follow-up cleanup migration ~2 weeks after revision merge.';

-- 2. New rachel_looks (styling axis only)
CREATE TABLE rachel_looks (
  look_id     text PRIMARY KEY,
  wardrobe    text NOT NULL,
  hair        text NOT NULL,
  accessories text,
  notes       text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at  timestamptz,
  created_by  text NOT NULL,
  source      text NOT NULL DEFAULT 'skill_v1'
              CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_looks_status_idx ON rachel_looks(status);

COMMENT ON TABLE rachel_looks IS
  'Styling axis of Rachel Avatar Full rotation: wardrobe + hair + accessories. '
  'Independent of location. Composed at render time via pickCombination → '
  'pickLook + pickLocation + rachel_stills cache lookup.';

-- 3. New rachel_locations (setting axis)
CREATE TABLE rachel_locations (
  location_id text PRIMARY KEY,
  setting     text NOT NULL,
  lighting    text NOT NULL,
  framing     text NOT NULL,
  tier        text NOT NULL CHECK (tier IN ('primary', 'secondary')),
  notes       text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at  timestamptz,
  created_by  text NOT NULL,
  source      text NOT NULL DEFAULT 'skill_v1'
              CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_locations_status_idx ON rachel_locations(status);
CREATE INDEX rachel_locations_tier_idx ON rachel_locations(tier)
  WHERE status = 'active';

COMMENT ON TABLE rachel_locations IS
  'Setting axis of Rachel Avatar Full rotation: setting + lighting + framing. '
  'Tier-aware: primary locations (kitchen, studio) appear 5/7 of renders; '
  'secondary 2/7. Independent of look.';

-- 4. New rachel_stills (per-combination cache)
CREATE TABLE rachel_stills (
  still_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id        text NOT NULL REFERENCES rachel_looks(look_id),
  location_id    text NOT NULL REFERENCES rachel_locations(location_id),
  soul_still_id  text NOT NULL,
  soul_still_url text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'retired')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  retired_at     timestamptz,
  created_by     text NOT NULL
);

-- Partial unique: exactly one active still per (look, location) combo.
-- Allows N pending candidates during bootstrap + retire history.
CREATE UNIQUE INDEX rachel_stills_one_active_per_combo
  ON rachel_stills (look_id, location_id)
  WHERE status = 'active';

CREATE INDEX rachel_stills_status_idx ON rachel_stills(status);
CREATE INDEX rachel_stills_combo_idx ON rachel_stills(look_id, location_id);

COMMENT ON TABLE rachel_stills IS
  'Per-combination cache of Higgsfield Soul 2.0 stills for (look × location). '
  'pickCombination reads this table. When a combo has no active still, the '
  'render-time generateStill flow mints one (auto-approves first of 3).';

-- 5. Seed look_01 (Cozy cream knit) — canonical Look #1 from FACE_OF_SMT_V1.md
INSERT INTO rachel_looks (
  look_id, wardrobe, hair, accessories, notes,
  status, approved_at, created_by, source
) VALUES (
  'look_01',
  'cream cable-knit sweater',
  'loose half-up',
  NULL,
  'Canon Look #1 from FACE_OF_SMT_V1.md. Best for trust content, '
  'morning content, comfort topics.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

-- 6. Seed location_01 (Kitchen — primary)
INSERT INTO rachel_locations (
  location_id, setting, lighting, framing, tier, notes,
  status, approved_at, created_by, source
) VALUES (
  'location_01',
  'modern kitchen, kitchen island in background, soft cream walls',
  'morning window light, warm, daylight balanced',
  'medium shot, eye level, shallow depth of field',
  'primary',
  'Canon primary location #1. Best for parenting insights, mom health, day-to-day mom content.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

-- 7. Seed the canonical Soul still for (look_01, location_01) — Yaron's
--    original Cream Knit reference. Carries forward from v1 unchanged.
INSERT INTO rachel_stills (
  look_id, location_id, soul_still_id, soul_still_url,
  status, approved_at, created_by
) VALUES (
  'look_01',
  'location_01',
  'f757b09c-d94d-4ade-a076-4a1a496c641e',
  'https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png',
  'active',
  now(),
  'canon_seed'
);

COMMIT;
```

**Migration does NOT include location_02.** Per the spec, location_02 (studio) is created via the Smoke B bootstrap (which calls `bootstrapCanonLocation(2)`). This dogfoods the bootstrap flow and matches v1's pattern (Smoke 2 created look_02).

**Migration does NOT delete the v1 `rachel_looks` rows.** The rename preserves them in `rachel_looks_legacy_v1` for 2 weeks. A follow-up cleanup migration (separate ticket, NOT in PR-A revision) drops the legacy table after stability is confirmed.

---

## Canon look briefs (hardcoded in `canon-looks.ts`)

Sourced from `FACE_OF_SMT_V1.md` lines 195–202. Verified verbatim:

```ts
// video/lib/wardrobe-rotation/canon/canon-looks.ts
export interface CanonLookBrief {
  wardrobe: string;
  hair: string;
  accessories: string | null;
  best_for: string;
}

export const CANON_LOOKS: Record<string, CanonLookBrief> = {
  look_01: {
    wardrobe: 'cream cable-knit sweater',
    hair: 'loose half-up',
    accessories: null,
    best_for: 'trust content, morning content, comfort topics',
  },
  look_02: {
    wardrobe: 'white casual tee',
    hair: 'hair down',
    accessories: null,
    best_for: 'neutral / default / explainers',
  },
  look_03: {
    wardrobe: 'denim jacket over white top',
    hair: 'hair down, slightly tucked behind one ear',
    accessories: null,
    best_for: 'casual, relatable, going-about-my-day',
  },
  look_04: {
    wardrobe: 'fitted black top',
    hair: 'hair down',
    accessories: 'small gold necklace',
    best_for: 'hot takes, sharper tone, tech content',
  },
  look_05: {
    wardrobe: 'dusty rose blouse',
    hair: 'hair down, natural',
    accessories: null,
    best_for: 'feel-good, trending, wellness',
  },
  // look_06 through look_11 not defined here. Canon doc currently has
  // a single placeholder row ("Additional variations") for 6-11.
  // Defining the wardrobe/hair/accessories briefs is a follow-up.
};
```

---

## Canon location briefs (hardcoded in `canon-locations.ts`)

```ts
// video/lib/wardrobe-rotation/canon/canon-locations.ts
export interface CanonLocationBrief {
  tier: 'primary' | 'secondary';
  setting: string;
  lighting: string;
  framing: string;
  best_for: string;
}

export const CANON_LOCATIONS: Record<string, CanonLocationBrief> = {
  location_01: {
    tier: 'primary',
    setting: 'modern kitchen, kitchen island in background, soft cream walls',
    lighting: 'morning window light, warm, daylight balanced',
    framing: 'medium shot, eye level, shallow depth of field',
    best_for: 'parenting insights, mom health, day-to-day mom content',
  },
  location_02: {
    tier: 'primary',
    setting: 'home office / studio, warm bookshelf or plant backdrop, wooden desk visible',
    lighting: 'desk lamp + ambient afternoon light, slight golden cast',
    framing: 'medium shot, eye level, shallow depth of field',
    best_for: 'AI Magic, Tech for Moms, Financial, Trending — anything explainer-coded',
  },
  // location_03 through location_08 (6 secondaries) not defined here.
  // Defining the secondary briefs is a follow-up task with Yaron.
};
```

---

## File diff list

### Files to **delete** (v1 single-axis files; replaced by new structure)

```
video/lib/wardrobe-rotation/pick-next-look.ts          → moved to pickers/pick-look.ts (algorithm carries over)
video/lib/wardrobe-rotation/create-new-look.ts         → split into flows/bootstrap-canon-look.ts + bootstrap-canon-location.ts + generate-still.ts
video/lib/wardrobe-rotation/approve-look.ts            → moved to flows/approve-look.ts (unchanged behavior); + new flows/approve-location.ts + flows/approve-still.ts
video/lib/wardrobe-rotation/retire-look.ts             → moved to flows/retire-look.ts (unchanged + guard extracted to guards/); + new flows/retire-location.ts + flows/retire-still.ts
video/lib/wardrobe-rotation/generate-look-id.ts        → generalized to flows/generate-id.ts (handles look/location/still ids by prefix)
video/lib/wardrobe-rotation/look-prompt.ts             → moved to prompt/look-prompt.ts (signature changed: takes look + location)
video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts → moved/updated
video/lib/wardrobe-rotation/__tests__/create-new-look.test.ts → split into bootstrap-canon-look.test.ts + (prompt tests stay in look-prompt.test.ts)
video/lib/wardrobe-rotation/__tests__/generate-look-id.test.ts → moved
video/lib/wardrobe-rotation/__tests__/retire-look.test.ts → moved (still tests assertCanRetire, now from guards/)
```

### Files to **keep + modify**

```
video/lib/wardrobe-rotation/types.ts        — add RachelLocation, RachelStill, CanonLookBrief, CanonLocationBrief; modify RachelLook (wardrobe split into wardrobe + hair + accessories)
video/lib/wardrobe-rotation/index.ts        — re-export new public API surface
video/lib/wardrobe-rotation/db.ts           — add queries for rachel_locations + rachel_stills; modify rachel_looks queries to new schema
skills/avatar-full-wardrobe-rotation/SKILL.md — rewrite for two-axis model + 7 sub-flows
claude.md                                    — update "Claude Code Skills" entry (one-line desc change)
```

### Files to **create** (new structure)

```
supabase/migrations/<NEW_TIMESTAMP>_split_looks_into_axes.sql

video/lib/wardrobe-rotation/canon/
  canon-looks.ts                            — CANON_LOOKS dict (looks 1-5 verbatim)
  canon-locations.ts                        — CANON_LOCATIONS dict (locations 1-2 verbatim)

video/lib/wardrobe-rotation/pickers/
  pick-look.ts                              — LRU cooldown=3 (renamed + retuned from pick-next-look.ts)
  pick-location.ts                          — tier-aware 5/7 primary + cooldown=1 within tier
  pick-combination.ts                       — orchestrator returning {look, location, still or needs_generation}

video/lib/wardrobe-rotation/flows/
  bootstrap-canon-look.ts                   — generates 6 candidates for canon look slot N
  bootstrap-canon-location.ts               — generates 6 candidates for canon location slot N
  generate-still.ts                         — render-time on-demand, count=3, auto-approve first
  approve-look.ts                           — pending → active
  approve-location.ts                       — pending → active
  approve-still.ts                          — pending → active (+ retire other pending stills for same combo)
  retire-look.ts                            — active → retired, with floor-3 guard
  retire-location.ts                        — active → retired, with floor-2 + at-least-1-primary guard
  retire-still.ts                           — active → retired, with floor-1-per-combo guard
  generate-id.ts                            — sequential look_NN / location_NN ID generator (NOT used for stills — uuid default)
  get-canon-status.ts                       — surface of which canon slots are filled vs empty vs cached

video/lib/wardrobe-rotation/guards/
  assert-can-retire-look.ts                 — pure: floor=3 active looks
  assert-can-retire-location.ts             — pure: floor=2 active locations AND ≥1 primary
  assert-can-retire-still.ts                — pure: floor=1 active still per (look, location) combo

video/lib/wardrobe-rotation/prompt/
  look-prompt.ts                            — assembles Soul prompt from look + location pair
  forbidden-identity-regex.ts               — FORBIDDEN_RE extracted (unchanged from v1)

video/lib/wardrobe-rotation/__tests__/
  pick-look.test.ts
  pick-location.test.ts
  pick-combination.test.ts
  assert-can-retire-look.test.ts
  assert-can-retire-location.test.ts
  assert-can-retire-still.test.ts
  look-prompt.test.ts
  generate-id.test.ts
```

---

## Picker contracts (full pseudocode)

### `pickers/pick-look.ts`

```ts
import type { RecentPick } from '../types.js';

export const LOOK_COOLDOWN = 3;

export function pickLook(activeLookIds: string[], recentlyUsed: RecentPick[]): string {
  // Identical algorithm to v1 pickNextLook, with cooldown = 3 instead of 2.
  // Algorithm: sort recent desc by used_at, take top COOLDOWN distinct ids as
  // blocked set, candidates = active minus blocked. Tie-break ascending look_id.
  // Empty history → activeLookIds[0] (sorted asc). Fewer active than cooldown
  // → fall back to oldest-used active.
  // [Same impl shape as v1 pick-next-look.ts]
}
```

### `pickers/pick-location.ts`

```ts
import type { RecentLocationPick, RachelLocation } from '../types.js';

export const PRIMARY_LOCATION_RATIO = 5 / 7;
export const LOCATION_COOLDOWN_WITHIN_TIER = 1;
export const LOCATION_RATIO_WINDOW = 7;

export interface RecentLocationPick {
  location_id: string;
  tier: 'primary' | 'secondary';
  used_at: string;
}

export function pickLocation(
  activeLocations: RachelLocation[],
  recentlyUsed: RecentLocationPick[],
): string {
  if (activeLocations.length === 0) {
    throw new Error('pickLocation: no active locations available');
  }

  // 1. Compute primary_ratio from last LOCATION_RATIO_WINDOW picks
  const window = recentlyUsed.slice(0, LOCATION_RATIO_WINDOW);
  const primaryCount = window.filter(p => p.tier === 'primary').length;
  const currentRatio = window.length === 0 ? 0 : primaryCount / window.length;

  // 2. Decide required tier
  const requiredTier: 'primary' | 'secondary' =
    currentRatio < PRIMARY_LOCATION_RATIO ? 'primary' : 'secondary';

  // 3. Filter active to required tier
  let tierActive = activeLocations.filter(l => l.tier === requiredTier);

  // 4. Fall back to other tier if no active in required tier
  let usedFallback = false;
  if (tierActive.length === 0) {
    tierActive = activeLocations.filter(l => l.tier !== requiredTier);
    usedFallback = true;
    if (tierActive.length === 0) {
      throw new Error('pickLocation: no active locations in either tier');
    }
    // Note: caller may want to log this; consider returning a `usedFallback` flag.
    // For PR-A revision, we silently fall back. Add logging in PR-B if needed.
  }

  // 5. LRU within tier (cooldown = 1)
  const tierRecent = recentlyUsed.filter(p => p.tier === requiredTier);
  const blocked = new Set<string>();
  for (const p of tierRecent.slice(0, LOCATION_COOLDOWN_WITHIN_TIER)) {
    blocked.add(p.location_id);
  }
  let candidates = tierActive.filter(l => !blocked.has(l.location_id));
  if (candidates.length === 0) candidates = tierActive; // degenerate: only 1 active in tier

  // 6. Among candidates, pick the one whose most-recent usage is oldest
  const lastUsed = new Map<string, number>();
  for (const p of recentlyUsed) {
    const t = new Date(p.used_at).getTime();
    const prev = lastUsed.get(p.location_id);
    if (prev === undefined || t > prev) lastUsed.set(p.location_id, t);
  }

  return [...candidates]
    .sort((a, b) => {
      const ta = lastUsed.get(a.location_id) ?? -Infinity;
      const tb = lastUsed.get(b.location_id) ?? -Infinity;
      if (ta !== tb) return ta - tb;
      return a.location_id.localeCompare(b.location_id);
    })[0]
    .location_id;
}
```

### `pickers/pick-combination.ts`

```ts
import type { RachelLook, RachelLocation, RachelStill } from '../types.js';
import { pickLook } from './pick-look.js';
import { pickLocation } from './pick-location.js';

export interface PickCombinationInput {
  activeLooks: RachelLook[];
  activeLocations: RachelLocation[];
  activeStills: RachelStill[];
  recentLookPicks: { look_id: string; used_at: string }[];
  recentLocationPicks: { location_id: string; tier: 'primary' | 'secondary'; used_at: string }[];
}

export type PickCombinationResult =
  | { look_id: string; location_id: string; still_id: string; needs_generation: false }
  | { look_id: string; location_id: string; still_id: null; needs_generation: true };

export function pickCombination(input: PickCombinationInput): PickCombinationResult {
  const look_id = pickLook(
    input.activeLooks.map(l => l.look_id),
    input.recentLookPicks,
  );
  const location_id = pickLocation(input.activeLocations, input.recentLocationPicks);
  const still = input.activeStills.find(
    s => s.look_id === look_id && s.location_id === location_id,
  );
  if (still) {
    return { look_id, location_id, still_id: still.still_id, needs_generation: false };
  }
  return { look_id, location_id, still_id: null, needs_generation: true };
}
```

---

## Lifecycle guards (full impls)

### `guards/assert-can-retire-look.ts`

**Decided 2026-05-21:** floor = 4 (cooldown=3 + 1 candidate). Plus emit a warning at active count = 5 so pool thinning is visible before it hits the floor.

```ts
export const LOOK_POOL_FLOOR = 4;
export const LOOK_POOL_WARNING_THRESHOLD = 5;

export function assertCanRetireLook(currentActiveCount: number):
  | { ok: true; warning?: string }
  | { ok: false; reason: string } {
  if (currentActiveCount <= LOOK_POOL_FLOOR) {
    return {
      ok: false,
      reason: `only ${currentActiveCount} active looks remain; pool floor is ${LOOK_POOL_FLOOR} (cooldown=3 picker needs ≥4 active to keep ≥1 candidate after cooldown)`,
    };
  }
  if (currentActiveCount === LOOK_POOL_WARNING_THRESHOLD) {
    return {
      ok: true,
      warning: `look pool is thinning: only ${currentActiveCount} active looks remain after this retire. Bootstrap more canon looks before retiring further.`,
    };
  }
  return { ok: true };
}
```

The flow caller (`flows/retire-look.ts`) surfaces the warning via console.warn (or pipeline_runs log entry when called by the orchestrator).

### `guards/assert-can-retire-location.ts`

```ts
export function assertCanRetireLocation(
  currentActiveCount: number,
  currentActivePrimaryCount: number,
  retiringLocationTier: 'primary' | 'secondary',
): { ok: true } | { ok: false; reason: string } {
  if (currentActiveCount <= 2) {
    return {
      ok: false,
      reason: `only ${currentActiveCount} active locations remain; pool floor is 2`,
    };
  }
  if (retiringLocationTier === 'primary' && currentActivePrimaryCount <= 1) {
    return {
      ok: false,
      reason: `cannot retire the last active primary location; at least 1 primary must remain`,
    };
  }
  return { ok: true };
}
```

### `guards/assert-can-retire-still.ts`

**Decided 2026-05-21:** floor = 1 active still per combination, **applied only when retiring an active still and currentActiveCount === 1**. Retiring pending stills is always allowed. Uncached combos (zero active stills ever) are NOT floor violations — they're handled by on-demand `generateStill` at render time.

```ts
import type { RachelLookStatus } from '../types.js';

export function assertCanRetireStill(
  stillStatus: RachelLookStatus,
  currentActiveStillsForCombo: number,
): { ok: true } | { ok: false; reason: string } {
  // Retiring a pending or already-retired still is always OK.
  if (stillStatus !== 'active') return { ok: true };

  // Retiring an active still — refuse only if it's the last one for the combo.
  if (currentActiveStillsForCombo <= 1) {
    return {
      ok: false,
      reason:
        `cannot retire the last active still for this (look_id, location_id) combo. ` +
        `Run generateStill to mint a replacement first, then retire.`,
    };
  }
  return { ok: true };
}
```

With the partial unique index ensuring exactly 1 active per combo, the `<= 1` branch fires when count is 1 (i.e. the still being retired is the only active one for its combo). When generateStill auto-promotes a new one, that briefly creates a transient 0-active state (the old becomes retired before the new becomes active) — handle that in a transaction in `retire-still.ts`. Or simpler: `generateStill` ALWAYS auto-approves a candidate when called, so by the time `retireStill` is invoked on the old one, the new one is already active and count = 2 (transiently). The guard then allows the retire. Document the transactional ordering in the flow file.

---

## Bootstrap + generate flows

### `flows/bootstrap-canon-look.ts`

```ts
export interface BootstrapCanonLookResult {
  look_id: string;          // e.g. 'look_02'
  location_id: string;      // 'location_01' (neutral kitchen ref)
  candidate_still_ids: string[];
  candidates: Array<{ still_id: string; soul_still_id: string; soul_still_url: string }>;
}

export async function bootstrapCanonLook(
  look_number: number,
  generateImages: GenerateImagesFn,
): Promise<BootstrapCanonLookResult>
```

Behavior:
1. Validate `look_number` is 1-11; look up `CANON_LOOKS[look_NN]`; throw if `TODO_BRIEF` or undefined.
2. Compute `look_id = 'look_' + zero-padded(look_number, 2)`.
3. **Insert the look as `pending`** in `rachel_looks` (wardrobe, hair, accessories from canon brief, status pending, source 'canon_seed' if look_number ≤ 11 else 'skill_v1').
4. Find the neutral reference location: prefer `location_01` if active, else first active primary.
5. Assemble prompt via `assembleLookPrompt(canon_look_brief, neutral_location_brief)`.
6. Generate 6 candidates: 2 sequential `generate_image` calls (count=4 then count=2), polling each via `job_display`.
7. For each candidate: insert into `rachel_stills` as pending, with `(look_id, location_id, soul_still_id, soul_still_url, status='pending', created_by='skill_v1')`. Note: stills can be pending alongside the pending look — they're orphaned until the look is approved.
8. Return `{ look_id, location_id: neutral_location_id, candidate_still_ids, candidates }`.

When `approveStill(still_id)` is later called by Yaron:
- The function checks that the parent `rachel_looks.look_id` is pending; if so, promote both the look and the still to active in one transaction.
- The other 5 candidate stills for the same combo become pending-but-orphaned; the skill auto-retires them upon look approval.

Cost: 2 Higgsfield calls (count=4 + count=2) = ~$0.08 per canon look slot.

### `flows/bootstrap-canon-location.ts`

Same shape, but for the location axis. Uses `look_01` (cream sweater) as the neutral reference look. Generates 6 candidates as stills for (look_01, location_NN).

### `flows/generate-still.ts`

```ts
export interface GenerateStillResult {
  still_id: string;          // the auto-approved active still
  soul_still_id: string;
  soul_still_url: string;
  retired_still_ids: string[];  // the 2 candidates that lost
}

export async function generateStill(
  look_id: string,
  location_id: string,
  generateImages: GenerateImagesFn,
): Promise<GenerateStillResult>
```

Behavior:
1. Validate both look and location exist and are active.
2. Assemble prompt from their briefs.
3. Generate 3 candidates (count=3, one call).
4. Insert all 3 as `pending` in `rachel_stills`.
5. **Auto-approve the first** (by Higgsfield response order): `UPDATE ... SET status='active', approved_at=now()`.
6. Retire the other 2: `UPDATE ... SET status='retired', retired_at=now()`.
7. Return the active still's metadata.

Cost: 1 Higgsfield call (count=3) = ~$0.04 per render-time generation.

### `flows/approve-still.ts` (semantics distinct from approve-look/location)

When called on a still that's part of a bootstrap batch:
1. Verify still is pending; throw if not.
2. Look up parent look (or location, for location bootstrap) — if it's pending too, this is a bootstrap approval.
3. In one transaction:
   - Promote the still: `pending → active`, set `approved_at`.
   - Promote the parent look (or location): `pending → active`, set `approved_at`.
   - Auto-retire the OTHER pending stills for the same combo (the unselected candidates).

When called on a still that's NOT part of a bootstrap (e.g. a render-time `generateStill` already auto-approved one; user wants to swap to a different pending):
1. Verify still is pending.
2. Retire the current active for the same combo (if any).
3. Promote the new still.

Both paths share an "ensure only 1 active per combo" invariant, backed by the partial unique index.

---

## Skill (SKILL.md) — 7 flows

Full rewrite of `skills/avatar-full-wardrobe-rotation/SKILL.md`. Section structure:

1. **Frontmatter** — updated description listing trigger phrases for all 7 flows.
2. **Architecture overview** — two-axis model, looks ⊥ locations, stills as the per-combination cache.
3. **Sub-flow A — pickCombination** (the renderer entry point)
4. **Sub-flow B — bootstrapCanonLook(N)** (with explicit approval gate)
5. **Sub-flow C — bootstrapCanonLocation(N)** (with explicit approval gate)
6. **Sub-flow D — generateStill(look_id, location_id)** (auto-approve semantics, render-time)
7. **Sub-flow E — approveLook / approveLocation / approveStill**
8. **Sub-flow F — retireLook / retireLocation / retireStill** (with guard floors)
9. **Sub-flow G — getCanonStatus** (which slots filled, which empty, which combinations cached)
10. **Hard rules** — forbidden identity terms still applies, both axes independent, stills are per-combination
11. **Version** — v2.0, two-axis model

Frontmatter trigger phrases (consolidated):

```
description: Wardrobe management for Rachel (Face of SMT). Two-axis rotation: looks (wardrobe + hair + accessories) and locations (setting + lighting + framing) compose into per-combination Soul stills. Use at Avatar Full render init via pickCombination, when adding canon-locked looks or locations via bootstrap, when generating an on-demand still for a new combination, when approving/retiring looks/locations/stills, or when checking pool state. Triggers on phrases like "pick Rachel's combo", "next render setup", "what look and location for this render", "fill canon look slot N", "bootstrap location 3 from canon", "generate a new still for look_02 location_01", "approve look_03", "approve the pending location", "retire look_07", "what's the wardrobe state", "show me the pool", "which canon slots are missing".
```

---

## Tasks (bite-sized, TDD where applicable)

### Task 0 — Refresh Higgsfield cost preflight (research only)

Already done in this plan (see "Cost preflight" section). Confirmed: `count: 4` returns same `credits_exact: 0.12` as count: 3 → cost is per-call, not per-image. Smoke A+B+C+D budget: 5 credits (~$0.20). No commit.

### Task 1 — Migration: split into axes

**Files:** `supabase/migrations/<NEW_TIMESTAMP>_split_looks_into_axes.sql`

- [ ] **Step 1: Get current UTC timestamp** for the migration filename. Match the `yyyyMMddhhmmss` pattern of existing migrations.
- [ ] **Step 2: Write the migration SQL** (full body above, verbatim).
- [ ] **Step 3: Static check:** `grep -c "BEGIN\|COMMIT" <file>` → 1 each. `grep -c "CREATE TABLE\|CREATE INDEX\|CREATE UNIQUE INDEX\|INSERT INTO\|ALTER TABLE\|COMMENT ON" <file>` → expect 14 (3 CREATE TABLE + 4 CREATE INDEX + 1 CREATE UNIQUE INDEX + 3 INSERT + 2 ALTER + 1 COMMENT… actually let me recount: ALTER TABLE 1, ALTER INDEX 1, CREATE TABLE 3, CREATE INDEX 4, CREATE UNIQUE INDEX 1, INSERT 3, COMMENT 4 = 17. Use as a sanity check, not a hard gate).
- [ ] **Step 4: Commit** but DO NOT apply yet. Apply is gated on explicit Yaron consent (matches v1 PR-A pattern).
  ```bash
  git add supabase/migrations/<NEW_TIMESTAMP>_split_looks_into_axes.sql
  git commit -m "feat(wardrobe): split into look + location + still tables (YAR-136 revision)"
  ```

### Task 2 — Types

**Files:** modify `video/lib/wardrobe-rotation/types.ts`

- [ ] **Step 1:** Add `RachelLocation`, `RachelStill`, `CanonLookBrief`, `CanonLocationBrief`, `RecentLocationPick` types. Modify `RachelLook` to drop `soul_still_id`/`soul_still_url`/`setting` (those move to stills + locations) and add `wardrobe`, `hair`, `accessories: string | null`.
- [ ] **Step 2:** Re-run `tsc --noEmit --skipLibCheck` to confirm no consumers immediately break. Some downstream files (which we're about to delete/rewrite) will break — that's fine; we'll fix them as we go.
- [ ] **Step 3: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/types.ts
  git commit -m "feat(wardrobe): two-axis types (RachelLook + RachelLocation + RachelStill) (YAR-136 revision)"
  ```

### Task 3 — Canon hardcoded briefs

**Files:**
- Create: `video/lib/wardrobe-rotation/canon/canon-looks.ts`
- Create: `video/lib/wardrobe-rotation/canon/canon-locations.ts`

- [ ] **Step 1:** Write `canon-looks.ts` with `CANON_LOOKS` dict (looks 1-5 as defined above). Add a comment block noting that 6-11 are TODO (Yaron+Claude session).
- [ ] **Step 2:** Write `canon-locations.ts` with `CANON_LOCATIONS` dict (locations 1-2). Add comment noting 3-8 are TODO.
- [ ] **Step 3: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/canon/
  git commit -m "feat(wardrobe): canon look/location briefs from FACE_OF_SMT_V1 (YAR-136 revision)"
  ```

### Task 4 — Pickers (TDD, parallel-safe single subagent)

**Files:**
- Create: `video/lib/wardrobe-rotation/pickers/pick-look.ts`
- Create: `video/lib/wardrobe-rotation/pickers/pick-location.ts`
- Create: `video/lib/wardrobe-rotation/pickers/pick-combination.ts`
- Create: `video/lib/wardrobe-rotation/__tests__/pick-look.test.ts`
- Create: `video/lib/wardrobe-rotation/__tests__/pick-location.test.ts`
- Create: `video/lib/wardrobe-rotation/__tests__/pick-combination.test.ts`
- Delete: `video/lib/wardrobe-rotation/pick-next-look.ts`
- Delete: `video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts`

#### Task 4a — pick-look (TDD)

Same TDD shape as v1 pick-next-look. Tests carry over with cooldown=3 instead of 2.

Updated test cases (8 cases):
1. `LOOK_COOLDOWN is 3`
2. empty history + 11 active → look_01
3. 11 sequential picks cycle through all, no consecutive repeat, no repeat within 3-pick window
4. 22 sequential picks — each look appears exactly twice; 12th pick equals 1st (still holds with cooldown=3 since 11 > 3)
5. history `[look_01, look_02, look_03]` → next pick is never any of those three
6. deterministic — same input returns same output
7. only 3 active + cooldown=3 → fallback to oldest-used (all blocked, degenerate case)
8. tie-break: equal recency → ascending look_id

Impl carries over from v1, change constant + remove old file.

- [ ] **Step 1: Write failing tests** with cooldown=3 expectations.
- [ ] **Step 2: Run tests** — they FAIL (module not found).
- [ ] **Step 3: Implement** `pick-look.ts` (cooldown=3, rename function `pickNextLook` → `pickLook`, constant `WARDROBE_COOLDOWN` → `LOOK_COOLDOWN`).
- [ ] **Step 4: Run tests** — all 8 PASS.
- [ ] **Step 5: Delete v1 files** (pick-next-look.ts + its test).
- [ ] **Step 6: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/pickers/pick-look.ts video/lib/wardrobe-rotation/__tests__/pick-look.test.ts
  git rm video/lib/wardrobe-rotation/pick-next-look.ts video/lib/wardrobe-rotation/__tests__/pick-next-look.test.ts
  git commit -m "feat(wardrobe): pickLook LRU cooldown=3 (replaces pickNextLook) (YAR-136 revision)"
  ```

#### Task 4b — pick-location (TDD)

Tests (10 cases):
1. constants: `PRIMARY_LOCATION_RATIO === 5/7`, `LOCATION_COOLDOWN_WITHIN_TIER === 1`, `LOCATION_RATIO_WINDOW === 7`
2. empty history + location_01 (primary) + location_02 (primary) → returns first primary (`location_01`)
3. empty history + only secondary actives → returns secondary (fallback case, expect a console.warn or similar)
4. recent ratio 4/7 primary → next pick must be primary
5. recent ratio 5/7 primary → next pick must be secondary (boundary: 5/7 ≥ 5/7 means we're AT the threshold, so push to secondary)
6. recent ratio 6/7 primary → next pick must be secondary
7. within-tier cooldown: 2 active primaries + last pick was primary X → next primary pick must be the OTHER one
8. no active in required tier → fallback to other tier
9. deterministic determinism (same inputs → same output)
10. tie-break: equal recency within tier → ascending location_id

- [ ] **Step 1:** Write tests.
- [ ] **Step 2:** Confirm FAIL.
- [ ] **Step 3:** Implement `pick-location.ts` per pseudocode above.
- [ ] **Step 4:** Confirm PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/pickers/pick-location.ts video/lib/wardrobe-rotation/__tests__/pick-location.test.ts
  git commit -m "feat(wardrobe): tier-aware pickLocation 5/7 primary ratio (YAR-136 revision)"
  ```

#### Task 4c — pick-combination (TDD)

Tests (5 cases):
1. happy path: 11 active looks + 2 active locations + 1 still for (look_01, location_01) + empty history → returns `{ look_01, location_01, still_id, needs_generation: false }`
2. needs generation: 11 active looks + 2 active locations + NO still for the picked combo → returns `{ ..., still_id: null, needs_generation: true }`
3. determinism: same input → same output
4. integration: picks correctly interleave (verify look LRU and location tier ratio both fire)
5. zero active looks → throws (delegated from pickLook)

- [ ] **Step 1-4:** TDD
- [ ] **Step 5: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/pickers/pick-combination.ts video/lib/wardrobe-rotation/__tests__/pick-combination.test.ts
  git commit -m "feat(wardrobe): pickCombination orchestrator (YAR-136 revision)"
  ```

### Task 5 — Guards (TDD, parallel)

**Files:**
- Create: `video/lib/wardrobe-rotation/guards/assert-can-retire-look.ts`
- Create: `video/lib/wardrobe-rotation/guards/assert-can-retire-location.ts`
- Create: `video/lib/wardrobe-rotation/guards/assert-can-retire-still.ts` (only if Yaron keeps the floor-1 guard per Open Q §4)
- Create: tests for each

Tests for `assert-can-retire-look`:
- 0 → refuse, 3 → refuse, 4 → allow, 11 → allow (assuming Yaron confirms floor=4 per Open Q §3)

Tests for `assert-can-retire-location`:
- 0 actives → refuse
- 2 actives → refuse (floor)
- 3 actives, retiring primary, only 1 primary → refuse (primary-survival rule)
- 3 actives, retiring primary, 2 primaries → allow
- 3 actives, retiring secondary, 1 primary → allow

- [ ] **Step 1-5:** TDD for both/all 3 guards. Commit per guard or one commit for all.

### Task 6 — Prompt assembly (revised for two axes)

**Files:**
- Create: `video/lib/wardrobe-rotation/prompt/look-prompt.ts` (replaces `look-prompt.ts` from v1)
- Create: `video/lib/wardrobe-rotation/prompt/forbidden-identity-regex.ts` (extracted from v1's look-prompt.ts)
- Create: `video/lib/wardrobe-rotation/__tests__/look-prompt.test.ts`
- Delete: `video/lib/wardrobe-rotation/look-prompt.ts`
- Delete: `video/lib/wardrobe-rotation/__tests__/create-new-look.test.ts` (the prompt tests in there move to look-prompt.test.ts)

New `assembleLookPrompt` signature:

```ts
import type { CanonLookBrief, CanonLocationBrief } from '../types.js';
import { FORBIDDEN_RE } from './forbidden-identity-regex.js';

export const PROMPT_TAIL = 'vertical 9:16 portrait, no airbrushing, half-smile resting expression';

export function assembleLookPrompt(look: CanonLookBrief, location: CanonLocationBrief): string {
  const lookPart = [look.wardrobe, look.hair, look.accessories].filter(Boolean).join(', ');
  const locationPart = `${location.setting}, ${location.lighting}, ${location.framing}`;
  const combined = `${lookPart} | ${locationPart}`;

  const match = FORBIDDEN_RE.exec(combined);
  if (match) {
    throw new Error(
      `assembleLookPrompt: forbidden identity term "${match[0]}" detected in prompt. ` +
        'Soul carries identity via soul_id — never describe Rachel\'s skin, hair color, scars, etc.',
    );
  }

  return `${combined}, ${PROMPT_TAIL}`;
}
```

Tests cover:
- happy path: canon look_01 + canon location_01 → valid prompt
- forbidden term in wardrobe → throws
- forbidden term in setting → throws
- forbidden term in lighting → throws (regex applies to full combined string)
- accessories null vs string → both render correctly
- 5+ FORBIDDEN_RE assertions (preserved from v1)

- [ ] **Step 1-5: TDD + commit**

### Task 7 — DB layer rewrite

**Files:** modify `video/lib/wardrobe-rotation/db.ts`

Drop the v1 queries that target the old single-axis `rachel_looks` shape. Add new queries:

- `listActiveLooks()`, `listLooks(status?)`, `getLook(look_id)`, `insertLook(...)`, `updateLookStatus(look_id, status)` — same shapes as v1 but against new schema (no soul_still_id/url, but with hair/accessories).
- `listActiveLocations()`, `listLocations(status?)`, `getLocation(location_id)`, `insertLocation(...)`, `updateLocationStatus(location_id, status)` — analog for locations.
- `listActiveStills()`, `listStills(filters?: { look_id?, location_id?, status? })`, `getStill(still_id)`, `insertStill(...)`, `updateStillStatus(still_id, status)` — for stills.
- `getRecentLookPicks(limit)` — same as v1 (queries `content_queue.avatar_config->>'look_id'`).
- `getRecentLocationPicks(limit)` — new (queries `content_queue.avatar_config->>'location_id'` with the location's tier joined from `rachel_locations`).
- `getActiveStillsByCombo()` — convenience for `pickCombination` (returns the active stills the picker filters against).
- `generateNextLookId()`, `generateNextLocationId()` — sequential ID generators (use `generate-id.ts`).

Keep the lazy-init `getSupabase()` pattern from the v1 review fix.

- [ ] **Step 1:** Implement all queries.
- [ ] **Step 2:** Type-check pass.
- [ ] **Step 3:** No unit tests for db.ts directly (matches v1 convention). Smoke tests exercise.
- [ ] **Step 4: Commit**
  ```bash
  git add video/lib/wardrobe-rotation/db.ts
  git commit -m "feat(wardrobe): DB layer for two-axis schema + rachel_stills (YAR-136 revision)"
  ```

### Task 8 — Flow files (one commit per flow, or bundled)

**Files:**
- Create: `flows/bootstrap-canon-look.ts`, `bootstrap-canon-location.ts`, `generate-still.ts`
- Create: `flows/approve-look.ts`, `approve-location.ts`, `approve-still.ts`
- Create: `flows/retire-look.ts`, `retire-location.ts`, `retire-still.ts`
- Create: `flows/generate-id.ts`, `get-canon-status.ts`
- Delete: v1's `create-new-look.ts`, `approve-look.ts`, `retire-look.ts`, `generate-look-id.ts`

This is the largest task. Sub-split:

- **Task 8a** — generate-id.ts (generalized from generate-look-id.ts) + tests
- **Task 8b** — approve-* and retire-* (6 small files; one commit)
- **Task 8c** — bootstrap-canon-look + bootstrap-canon-location (use approve flows + ID generator + DB layer + prompt assembly)
- **Task 8d** — generate-still + get-canon-status

Each subtask gets its own implementer subagent.

### Task 9 — Public index + SKILL.md

**Files:** rewrite `video/lib/wardrobe-rotation/index.ts`, rewrite `skills/avatar-full-wardrobe-rotation/SKILL.md`.

Index re-exports the new public API. SKILL.md follows the 7-flow structure outlined above.

- [ ] **Step 1-2: write + commit.**

### Task 10 — claude.md description update

Single-line edit to the existing "Claude Code Skills" table entry for `avatar-full-wardrobe-rotation`:

Current: `LRU wardrobe rotation for Rachel (cooldown=2) + create/approve/retire flows for new Soul 2.0 looks`

New: `Two-axis rotation for Rachel: looks (cooldown=3) × locations (tier-aware 5/7 primary) → per-combination Soul stills, with bootstrap + approve/retire flows`

Plus, optionally, a short note above the table flagging the v2 model. Single commit.

### Task 11 — Apply migration (gated)

Same checkpoint as v1 — explicit Yaron consent before applying to prod. This commit doesn't change files; it's a manual action.

After apply, verify via SQL:
- `rachel_looks_legacy_v1` exists with 4 rows (look_01..look_04 from v1).
- `rachel_looks` exists with 1 row (look_01 canon seed).
- `rachel_locations` exists with 1 row (location_01).
- `rachel_stills` exists with 1 row ((look_01, location_01, f757b09c...)).

### Task 12 — Smoke A: bootstrapCanonLook(2)

Gated step. Costs ~$0.08.

- [ ] Call `bootstrapCanonLook(2)` (white casual tee, hair down). Expect 6 candidates featuring Rachel × kitchen location.
- [ ] Visual review: confirm Soul identity holds across all 6; confirm wardrobe matches "white casual tee, hair down".
- [ ] Paste 6 image URLs in the PR description.
- [ ] Pick one and call `approveStill(still_id)`. Verify look_02 + chosen still flip to active; other 5 stills auto-retire.

### Task 13 — Smoke B: bootstrapCanonLocation(2)

Gated step. Costs ~$0.08.

- [ ] Call `bootstrapCanonLocation(2)` (home office / studio). Expect 6 candidates of look_01 × studio.
- [ ] Visual review + paste URLs.
- [ ] Approve one. Verify location_02 + chosen still active.

### Task 14 — Smoke C: pickCombination + generateStill

- [ ] Confirm pool state: 2 active looks (look_01, look_02), 2 active locations (location_01, location_02), 3 active stills.
- [ ] Call `pickCombination()` with the current DB state. If it returns `needs_generation: true` for (look_02, location_02), proceed to step 2; else iterate until that combination is requested.
- [ ] Call `generateStill('look_02', 'location_02')`. Verify 3 candidates inserted; first auto-approved; other 2 auto-retired.

Cost: ~$0.04.

### Task 15 — Smoke D: forbidden term guard

- [ ] Call `bootstrapCanonLook(2)` with the CANON_LOOKS dict temporarily mutated to include "olive skin" in look_02's wardrobe field.
- [ ] Confirm the function throws BEFORE any MCP call.
- [ ] Confirm no Higgsfield credits charged.
- [ ] Restore the canon dict.

Cost: $0.

### Task 16 — Final code review

Dispatch superpowers:code-reviewer for the full diff. Address Important issues. Update PR description with Smoke A/B/C/D results + all generated image URLs.

---

## Decisions (resolved 2026-05-21)

1. **Branch strategy:** ✓ stay on `claude/hopeful-lehmann-92d945`, force-push to PR #35.
2. **Three spec corrections:** ✓ all approved — partial unique index, bootstrap-as-2-calls (count=4 + count=2), generateStill auto-approve-first-of-3.
3. **Look floor:** ✓ floor = 4 + warning at count = 5. Updated `assertCanRetireLook` above.
4. **Still floor:** ✓ floor = 1 active per combo, refuse retire of an active when count=1; pending retires always allowed; uncached combos (zero active) are handled by on-demand `generateStill`. Updated `assertCanRetireStill` above.
5. **Approval interaction in bootstrap:** ✓ `approveStill(chosen_still_id)` auto-promotes the parent pending look (or location) in the same transaction. One human decision per slot.
6. **Legacy table:** ✓ rename + preserve for 2 weeks; drop in follow-up cleanup migration. Out of PR-A revision scope.
7. **Cost math:** ✓ per-call billing confirmed. Bootstrap = 2 calls × 1 credit = 2 credits ≈ $0.08 per slot. Smoke A+B+C+D = 5 credits ≈ $0.20 total.

---

## Out of scope (per spec)

- Wardrobe briefs for looks 06–11 (canon doc currently has no briefs; separate session)
- Location briefs for locations 03–08 (six secondaries TBD)
- PR-B v5 renderer integration
- Pipeline UI surface
- Per-pillar combination mapping
- Render-time still review gate (auto-approve is the v1 of generateStill)

---

## Acceptance criteria (PR-A revision scope)

- [ ] Revision migration written + applied to `fvxaykkmzsbrggjgdfjj`. Legacy table preserved as `rachel_looks_legacy_v1`.
- [ ] `rachel_looks`, `rachel_locations`, `rachel_stills` tables exist with correct schema, indexes, and partial unique constraint on (look_id, location_id) for active stills.
- [ ] Seed: look_01 (cream knit) + location_01 (kitchen) + 1 still for (look_01, location_01) using the existing canon URL.
- [ ] All 7 skill flows operational. SKILL.md fully rewritten with frontmatter triggers.
- [ ] Pickers (pickLook, pickLocation, pickCombination) all pure, deterministic, fully tested.
- [ ] Look cooldown = 3, location tier ratio = 5/7 primary, lifecycle guards enforced per Open Q resolution.
- [ ] Smoke A, B, C, D all pass with cost reported within ±10% of $0.20.
- [ ] PR #35 description rewritten with revision spec + Smoke A/B/C/D image URLs for visual review.
- [ ] `claude.md` updated for two-axis model.
- [ ] Out of scope items filed as follow-up Linear tickets.
