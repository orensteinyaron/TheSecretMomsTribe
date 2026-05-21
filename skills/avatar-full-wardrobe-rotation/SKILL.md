---
name: avatar-full-wardrobe-rotation
description: Wardrobe management for Rachel (Face of SMT). Two-axis rotation: looks (wardrobe + hair + accessories) and locations (setting + lighting + framing) compose into per-combination Soul stills. Use at Avatar Full render init via pickCombination, when adding canon-locked looks or locations via bootstrap, when generating an on-demand still for a new combination, when approving/retiring looks/locations/stills, or when checking pool state. Triggers on phrases like "pick Rachel's combo", "next render setup", "what look and location for this render", "fill canon look slot N", "bootstrap location 3 from canon", "generate a new still for look_02 location_01", "approve look_03", "approve the pending location", "retire look_07", "what's the wardrobe state", "show me the pool", "which canon slots are missing".
---

# Avatar Full — Wardrobe Rotation Skill

Rachel's appearance at render time is determined by two independent axes: a **look** (clothing, hair, accessories) and a **location** (setting, lighting, framing). Each look × location pair has a dedicated **still** — a Soul 2.0 image generated via Higgsfield — stored in the `rachel_stills` table. At render time the orchestrator calls `pickCombination`, which selects the best look and best location independently, then looks up (or flags as missing) the still for that pair.

New looks and locations are introduced through a **bootstrap + approval flow**: candidates are generated as `pending`, reviewed by Yaron, and a single `approveStill` call promotes the parent look/location and retires the unchosen candidates atomically. Existing looks and locations can be retired when they no longer fit the brand, subject to pool-floor guards.

## Architecture overview

```
looks axis          locations axis
─────────────       ─────────────────
rachel_looks        rachel_locations
  look_01             location_01
  look_02             location_02
  ...                 ...
       ↘                 ↙
         rachel_stills
           look_01 × location_01 → still_001
           look_01 × location_02 → still_002
           look_02 × location_01 → still_003
           ...
```

- **Looks** and **locations** are independent — adding a location does not require regenerating existing looks, and vice versa.
- **Stills** are per-combination and are never reused across different look × location pairs.
- Pool state lives in three DB tables: `rachel_looks`, `rachel_locations`, `rachel_stills`.
- Canon dicts (`CANON_LOOKS`, `CANON_LOCATIONS`) define the intended final set of looks/locations. Bootstrap flows close the gap between canon definition and DB presence.

## When to use

- **Render init** — orchestrator needs a look + location + still to pass to Seedance. Use Sub-flow A (`pickCombination`).
- **Introduce a new canon look** — Yaron wants to add look slot N from `CANON_LOOKS`. Use Sub-flow B (`bootstrapCanonLook`).
- **Introduce a new canon location** — Yaron wants to add location slot N from `CANON_LOCATIONS`. Use Sub-flow C (`bootstrapCanonLocation`).
- **Generate a still for an existing combo** — look and location are both active but no still exists for their pair. Use Sub-flow D (`generateStill`).
- **Approve a pending look, location, or still** — after visual review. Use Sub-flow E.
- **Retire a look, location, or still** — no longer brand-fit. Use Sub-flow F.
- **Check pool state** — "what canon slots are missing", "how many active looks". Use Sub-flow G (`getCanonStatus`).

## Sub-flow A — pickCombination

**Entry point for every Avatar Full render.**

**Inputs:** all active looks, recent look picks, all active locations, recent location picks, active stills index (all from DB).

**Behavior:**
1. Call `listActiveLooks()`, `getRecentLookPicks(LOOK_COOLDOWN)`.
2. Call `listActiveLocations()`, `getRecentLocationPicks(LOCATION_COOLDOWN_WITHIN_TIER)`.
3. Call `listActiveStills()` — build lookup index of `look_id × location_id → still_id`.
4. Call `pickCombination(input)` — pure function:
   - `pickLook` selects look via LRU with cooldown=3 (the same look is excluded for 3 renders after use).
   - `pickLocation` selects location respecting tier ratio (primary locations used ~5/7 renders) and per-tier cooldown=1.
   - Checks stills index: if still exists → `needs_generation: false`; if missing → `needs_generation: true`.
5. If `needs_generation: true`, trigger Sub-flow D before proceeding.

**Returns:** `{ look_id, location_id, still_id | null, needs_generation }`.

**Code:** `video/lib/wardrobe-rotation/pickers/pick-combination.ts` (pure), `db.ts` (I/O).

## Sub-flow B — bootstrapCanonLook(N)

**Add a new canon-locked look slot to the active pool.**

**Inputs:** `lookNumber` (integer matching a key in `CANON_LOOKS`), `generateImages: GenerateImagesFn` (DI — see Transport note).

**Behavior:**
1. Look up the canon brief for slot N from `CANON_LOOKS`.
2. Call `assembleLookPrompt(look.wardrobe, look.setting)` — validates against `FORBIDDEN_RE`. Throws before any write if identity features are detected.
3. Call `insertLook(...)` — parent record inserted as `status='pending'`.
4. Call `generateImages` twice (count=3 each) for a total of 6 candidate stills. Neutral location `location_01` is used as the reference setting.
5. Call `insertStill(...)` × 6 — all inserted as `status='pending'`, bound to parent look.
6. Return `BootstrapResult` with all 6 candidate still URLs for Yaron's review.

**Cost:** ~$0.08 (2 Higgsfield calls × 3 images each).

**CRITICAL — approval gate:**

> **Generating candidates does NOT add them to rotation.** The parent look is inserted as `status='pending'` along with 6 candidate stills (also `pending`). Yaron must review the 6 stills and call `approveStill(chosen_still_id)`. This auto-promotes the parent look + the chosen still to `active`, and auto-retires the other 5 sibling stills.

**Code:** `video/lib/wardrobe-rotation/flows/bootstrap-canon-look.ts`.

## Sub-flow C — bootstrapCanonLocation(N)

**Add a new canon-locked location slot to the active pool.**

Mirror of Sub-flow B, but for the location axis. Neutral look `look_01` (cream knit sweater) is used as the reference look.

**Inputs:** `locationNumber` (integer matching a key in `CANON_LOCATIONS`), `generateImages: GenerateImagesFn`.

**Behavior:** same ordering invariant as Sub-flow B:
1. Look up canon brief from `CANON_LOCATIONS`.
2. `assembleLookPrompt` — FORBIDDEN_RE check.
3. `insertLocation(...)` — inserted as `status='pending'`.
4. `generateImages` × 2 (3 images each = 6 candidates), using neutral look_01.
5. `insertStill(...)` × 6 — all `status='pending'`, bound to parent location.
6. Return `BootstrapResult`.

**Cost:** ~$0.08 (same as look bootstrap).

**CRITICAL — approval gate:**

> **Generating candidates does NOT add them to rotation.** The parent location is inserted as `status='pending'` along with 6 candidate stills (also `pending`). Yaron must review the 6 stills and call `approveStill(chosen_still_id)`. This auto-promotes the parent location + the chosen still to `active`, and auto-retires the other 5 sibling stills.

**Code:** `video/lib/wardrobe-rotation/flows/bootstrap-canon-location.ts`.

## Sub-flow D — generateStill(look_id, location_id)

**Generate an on-demand still for an existing look × location combination.**

Use when `pickCombination` returns `needs_generation: true`, or when Yaron explicitly asks to fill a missing combo.

**Inputs:** `look_id`, `location_id` (both must be `active`), `generateImages: GenerateImagesFn`.

**Behavior:**
1. Fetch look + location records. Both must have `status='active'`.
2. Call `assembleLookPrompt` — FORBIDDEN_RE check.
3. Call `generateImages` once with `count=ON_DEMAND_STILL_CANDIDATES` (3).
4. Insert all 3 as `status='pending'`, bound to the look × location combo.
5. Auto-approve the first still (index 0): call `approveStill(first_still_id)`. This promotes the first still to `active` and retires the other 2.

**Returns:** `GenerateStillResult` — the approved still plus the 2 retired candidates.

**Cost:** ~$0.04 (1 Higgsfield call × 3 images).

**Note:** unlike bootstrap flows, `generateStill` does not require a separate approval step — the first candidate is auto-approved. This is intentional: render-time generation is blocking, so auto-approval unblocks the render immediately. Yaron can review and swap stills afterward if needed.

**Code:** `video/lib/wardrobe-rotation/flows/generate-still.ts`.

## Sub-flow E — approveLook / approveLocation / approveStill

**Promote a pending entity to active after visual review.**

**`approveLook(look_id)`**
- Transitions `pending` → `active`, sets `approved_at`.
- Throws if look is not `pending`.
- Standalone — does not affect stills or locations.

**`approveLocation(location_id)`**
- Transitions `pending` → `active`, sets `approved_at`.
- Throws if location is not `pending`.
- Standalone — does not affect stills or looks.

**`approveStill(still_id)`**
- Transitions the chosen still `pending` → `active`.
- **Bootstrap-aware:** if the still's parent look or location is `pending`, auto-promotes the parent to `active`.
- **Sibling retirement:** all other `pending` stills bound to the same parent (look or location, from a bootstrap batch) are auto-retired.
- This is the single required step after Sub-flow B or C.

**Code:** `flows/approve-look.ts`, `flows/approve-location.ts`, `flows/approve-still.ts`.

## Sub-flow F — retireLook / retireLocation / retireStill

**Remove an active entity from rotation. Guards enforce pool floors.**

**`retireLook(look_id)`**
- Transitions `active` → `retired`.
- **Guard (`assertCanRetireLook`):** refuses if active look count would drop below `LOOK_POOL_FLOOR = 4`. Emits a warning (does not block) if count would drop to `LOOK_POOL_WARNING_THRESHOLD = 5`.
- Throws if look is not `active`.

**`retireLocation(location_id)`**
- Transitions `active` → `retired`.
- **Guard (`assertCanRetireLocation`):** refuses if total active location count would drop below `LOCATION_POOL_FLOOR = 2`, OR if retiring this location would leave fewer than `PRIMARY_LOCATION_MIN = 1` primary-tier locations.
- Throws if location is not `active`.

**`retireStill(still_id)`**
- Transitions `active` → `retired`.
- **Guard (`assertCanRetireStill`):** refuses only if this is the last active still for its look × location combination (floor = 1 per combo). You cannot leave a combo with zero active stills.
- Throws if still is not `active`.

**Code:** `flows/retire-look.ts`, `flows/retire-location.ts`, `flows/retire-still.ts`; guards in `guards/`.

## Sub-flow G — getCanonStatus

**Surface pool state for diagnostic or operational queries.**

**Returns:** `CanonStatus` — includes:
- `looks`: for each slot in `CANON_LOOKS`, whether it exists in DB, its current status, and whether it's missing from the active pool.
- `locations`: same for each slot in `CANON_LOCATIONS`.
- Summary counts: active looks, active locations, total active stills, combos with missing stills.

Use when Yaron asks "what's the wardrobe state", "which canon slots are missing", or "how many active looks do we have".

**Code:** `video/lib/wardrobe-rotation/flows/get-canon-status.ts`.

## Hard rules (do not violate)

- **No identity features in Soul prompts.** Prompts must describe clothing, setting, and mood only — never skin tone, hair color, freckles, facial features, age, or body shape. `FORBIDDEN_RE` enforces this; if it throws, abort before any DB write.
- **Looks and locations are independent axes.** Do not bundle look + location choices into a single concept or a single DB record. They are separate tables, separate pickers, separate bootstrap flows.
- **Stills are per-combination.** A still generated for `look_02 × location_01` must never be used for any other look or location pair. The `look_id` and `location_id` FK columns on `rachel_stills` enforce this at the DB level.
- **Pool floors are enforced by guards.** Do not call `updateLookStatus` / `updateLocationStatus` / `updateStillStatus` directly to bypass guards. Always go through the retire flow functions.

## Cost reference

| Operation | Higgsfield calls | Approx. cost |
|---|---|---|
| `bootstrapCanonLook(N)` | 2 (3 images each = 6 total) | ~$0.08 |
| `bootstrapCanonLocation(N)` | 2 (3 images each = 6 total) | ~$0.08 |
| `generateStill(look_id, location_id)` | 1 (3 images) | ~$0.04 |
| `pickCombination` (cached still exists) | 0 | $0 |

## MCP calling shape (validated)

```ts
mcp__78d93fcf-...__generate_image({
  model: 'soul_2',
  soul_id: '34a349a6-d6d9-423f-8c80-e4b4c8d6e770',  // Rachel
  prompt: '<assembled via assembleLookPrompt>',
  count: 1-4,
  aspect_ratio: '9:16',
  quality: '2k',
})
// Returns { job_id }. Poll until complete:
mcp__78d93fcf-...__job_display({ job_id })
```

## Transport note (DI)

Bootstrap and `generateStill` flows accept a `GenerateImagesFn` callback so the MCP call is injected by the executing Claude session rather than hardcoded in the library. Type:

```ts
type GenerateImagesFn = (input: GenerateImagesInput) => Promise<GeneratedImage[]>;
```

Wire it in the calling session:

```ts
const generateImages: GenerateImagesFn = async (input) => {
  const { job_id } = await callMcp('mcp__78d93fcf-...__generate_image', input);
  const result = await pollMcpJob(job_id);
  return result.images.map(img => ({ soul_still_id: img.id, soul_still_url: img.url }));
};
await bootstrapCanonLook(3, generateImages);
```

Full type definition in `video/lib/wardrobe-rotation/flows/bootstrap-canon-look.ts`.

## Version

v2.0 — 2026-05-21. Two-axis model (looks + locations + stills). 7 sub-flows. Replaces v1 single-axis wardrobe-only model.
