---
name: avatar-full-wardrobe-rotation
description: Wardrobe management for Rachel (Face of SMT) — owns the LOOK axis (wardrobe + hair + accessories), the pickers, and the still lifecycle (approve / retire). Location lifecycle (bootstrap, approve, retire, canonical regeneration) and anchored-still generation moved to the `location` skill. Use at Avatar Full render init via pickCombination, when adding canon-locked looks via bootstrap, when approving/retiring looks or stills, or when checking pool state. Triggers on phrases like "pick Rachel's combo", "next render setup", "what look and location for this render", "fill canon look slot N", "approve look_03", "retire look_07", "what's the wardrobe state". For "bootstrap location 3", "approve location_03", "regenerate the kitchen canonical", or "generate a new still for look_02 location_01" — use the `location` skill instead.
---

# Avatar Full — Wardrobe Rotation Skill

Rachel's appearance at render time is determined by two independent axes: a **look** (clothing, hair, accessories) and a **location** (structured set + Rachel-in-location canonical reference image). Each look × location pair has a dedicated **still** stored in `rachel_stills`. At render time the orchestrator calls `pickCombination`, which selects the best look and best location independently, then looks up (or flags as missing) the still for that pair.

**Split ownership (YAR-136 PR-C):**

- This skill owns the **look axis**, the **pickers** (`pickLook`, `pickLocation`, `pickCombination`), the **look lifecycle** (`bootstrapCanonLook` → `approveLook` / `retireLook`), and the **still lifecycle** (`approveStill` / `retireStill`).
- The **`location` skill** owns the **location axis** (`bootstrapLocation`, `approveLocation`, `retireLocation`, `getLocationReference`, `updateLocationReference`) and the **still generation flow** (`generateAnchoredStill` — wardrobe-swap against the locked canonical).

Stills are therefore co-owned: the `location` skill *generates* them via `nano_banana_pro + medias` anchored on the location's canonical; this skill *picks* combinations and manages each still's lifecycle once it exists.

## Architecture overview

```
looks axis          locations axis              still axis
─────────────       ─────────────────           ─────────────
rachel_looks        rachel_locations            rachel_stills
  look_01             location_01 + canonical     (look × location)
  look_02             location_02 + canonical       still_001
  ...                 ...                           still_002
                                                    ...
       \                  \                        /
        \                  \                      /
         └── pickCombination ──┴── generateAnchoredStill
              (this skill)         (location skill)
```

- **Looks** and **locations** are independent — adding a location does not require regenerating existing looks, and vice versa.
- **Stills** are per-combination and are never reused across different look × location pairs.
- Pool state lives in three DB tables: `rachel_looks`, `rachel_locations`, `rachel_stills`.
- Canon dicts (`CANON_LOOKS` here, `CANON_LOCATIONS` in the location skill) define the intended final set. Bootstrap flows close the gap between canon definition and DB presence.

## When to use

- **Render init** — orchestrator needs a look + location + still to pass to Seedance. Use Sub-flow A (`pickCombination`).
- **Introduce a new canon look** — Yaron wants to add look slot N from `CANON_LOOKS`. Use Sub-flow B (`bootstrapCanonLook`).
- **Approve a pending look or still** — after visual review. Use Sub-flow C.
- **Retire a look or still** — no longer brand-fit. Use Sub-flow D.

For **location** lifecycle (bootstrap / approve / retire / regenerate canonical) or **anchored-still generation** (wardrobe-swap renders), use the `location` skill.

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
5. If `needs_generation: true`, trigger `generateAnchoredStill(look_id, location_id)` from the `location` skill before proceeding.

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

## Sub-flow C — approveLook / approveStill

**Promote a pending entity to active after visual review.**

**`approveLook(look_id)`**
- Transitions `pending` → `active`, sets `approved_at`.
- Throws if look is not `pending`.
- Standalone — does not affect stills.

**`approveStill(still_id)`**
- Transitions the chosen still `pending` → `active`.
- **Bootstrap-aware:** if the still's parent look is `pending`, auto-promotes the parent to `active`.
- **Sibling retirement:** all other `pending` stills bound to the same parent look (from a bootstrap batch) are auto-retired.
- This is the single required step after Sub-flow B.

For **`approveLocation`** (different signature — requires `reference_image_url` + `reference_image_id`), see the `location` skill.

**Code:** `flows/approve-look.ts`, `flows/approve-still.ts`.

## Sub-flow D — retireLook / retireStill

**Remove an active entity from rotation. Guards enforce pool floors.**

**`retireLook(look_id)`**
- Transitions `active` → `retired`.
- **Guard (`assertCanRetireLook`):** refuses if active look count would drop below `LOOK_POOL_FLOOR = 4`. Emits a warning (does not block) if count would drop to `LOOK_POOL_WARNING_THRESHOLD = 5`.
- Throws if look is not `active`.

**`retireStill(still_id)`**
- Transitions `active` → `retired`.
- **Guard (`assertCanRetireStill`):** refuses only if this is the last active still for its look × location combination (floor = 1 per combo). You cannot leave a combo with zero active stills.
- Throws if still is not `active`.

For **`retireLocation`** (floor=2 + ≥1 primary guard), see the `location` skill.

**Code:** `flows/retire-look.ts`, `flows/retire-still.ts`; guards in `guards/`.

## Hard rules (do not violate)

- **No identity features in Soul prompts.** Prompts must describe clothing, setting, and mood only — never skin tone, hair color, freckles, facial features, age, or body shape. `FORBIDDEN_RE` enforces this; if it throws, abort before any DB write.
- **Looks and locations are independent axes.** Do not bundle look + location choices into a single concept or a single DB record. They are separate tables, separate pickers, separate skills.
- **Stills are per-combination.** A still generated for `look_02 × location_01` must never be used for any other look or location pair. The `look_id` and `location_id` FK columns on `rachel_stills` enforce this at the DB level.
- **Pool floors are enforced by guards.** Do not call `updateLookStatus` / `updateStillStatus` directly to bypass guards. Always go through the retire flow functions.

## Cost reference

| Operation | Higgsfield calls | Approx. cost |
|---|---|---|
| `bootstrapCanonLook(N)` | 2 (3 images each = 6 total) | ~$0.08 |
| `pickCombination` (cached still exists) | 0 | $0 |

For `bootstrapLocation` and `generateAnchoredStill` costs, see the `location` skill.

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

`bootstrapCanonLook` accepts a `GenerateImagesFn` callback so the Higgsfield MCP call is injected by the executing Claude session rather than hardcoded in the library. Type:

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

v2.1 — 2026-05-22 — YAR-136 PR-C C9 split. Owns the LOOK axis + pickers + look/still lifecycle. Location-axis lifecycle and anchored-still generation moved to the `location` skill.

v2.0 — 2026-05-21 — Two-axis model (looks + locations + stills). Replaces v1 single-axis wardrobe-only model.
