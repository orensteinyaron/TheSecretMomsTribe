---
name: location
description: Manages Rachel's locked location sets — kitchen, home studio, etc. Each location is a structured set definition (camera angle, position, background, lighting, props, wall + floor) plus a Rachel-in-location canonical reference image generated via nano_banana_pro. Every wardrobe-swap render uses that canonical as a medias reference so the same kitchen, same pose, same Rachel face appears identically across every wardrobe variant. Use when bootstrapping a new canon location (generates 3 Rachel-in-location candidates for review using an external aesthetic reference URL), generating an anchored still for an existing (look, location) combo (wardrobe swap against the locked canonical), querying or refreshing a location's canonical, or approving/retiring a location. Triggers on phrases like "bootstrap a new location", "generate the studio canonical", "fill location_03", "approve location_03 candidate 2", "regenerate the kitchen canonical", "generate Rachel in white tee in the kitchen", "what does the studio canonical look like", "retire the studio location".
---

# Location Skill

Rachel's appearance at render time has three independent axes: a **look** (clothing, hair, accessories), a **location** (structured set + Rachel-in-location canonical reference image), and a **still** (the cached wardrobe-swap image for one specific look × location pair). This skill owns the **location axis** end-to-end. The look axis + the picker orchestration stay in the `avatar-full-wardrobe-rotation` skill.

Every location is two things stitched together:

1. A **structured set definition** — camera angle, camera distance, Rachel's position, background composition, lighting setup, props list, wall color, floor material, tier. Lives in `CANON_LOCATIONS` (canon dict) and in the `rachel_locations` DB row.
2. A **Rachel-in-location canonical reference image** — a 2k 9:16 image of Rachel standing in THIS EXACT set, with the framing locked from Smoke 0d (~60% width, ~60-70% height, no ceiling, no pendant lamps, surface band ≤20% bottom). Generated once via `nano_banana_pro` against an external aesthetic reference URL, then stored as `reference_image_url` on the row.

Every wardrobe-swap render (`generateAnchoredStill`) re-uses the canonical as a `medias` anchor on `nano_banana_pro`. The short anchored-still prompt only names the wardrobe to swap to. The location, Rachel's identity, the pose, and the framing all carry from the canonical — so the same kitchen, same pose, same Rachel face appears identically across every wardrobe variant.

## Architecture overview

```
look axis              location axis                  still axis
─────────────          ─────────────────              ─────────────
rachel_looks           rachel_locations               rachel_stills
  look_01                location_01 + canonical        (look × location)
  look_02                  reference_image_url            still_001
  ...                    location_02 + canonical          still_002
                           reference_image_url            ...
                         ...
       \                       \                          /
        \                       \                        /
         └──── pickCombination ──┴────── anchored ──────┘
              (wardrobe-rotation        renders use the
               skill owns this)         canonical as
                                        medias anchor
```

- The location skill (this file) owns the **location axis** + **anchored still generation**.
- The `avatar-full-wardrobe-rotation` skill owns the **look axis**, the **pickers**, the **still lifecycle** (approve / retire), and the **guards**.
- `pickCombination` (in wardrobe-rotation) selects (look_id, location_id) for a render. When the still index has no entry for that combo, it triggers `generateAnchoredStill` from this skill.
- Canon dicts (`CANON_LOOKS` in wardrobe-rotation, `CANON_LOCATIONS` here) define the intended final set. Bootstrap flows close the gap between canon definition and DB presence.

## When to use

- **Bootstrap a brand-new canon location** (kitchen, studio, ...). → Sub-flow A.
- **Generate a wardrobe-swap still for an existing (look, location) combo.** Triggered by `pickCombination` when the still is missing, or manually by Yaron. → Sub-flow B.
- **Read the locked canonical URL for a location** (e.g. "what does the studio canonical look like"). → Sub-flow C.
- **Regenerate the canonical for an already-active location** (e.g. "redo the kitchen canonical, the lighting drifted"). → Sub-flow D.
- **Approve a pending location after reviewing the bootstrap candidates.** → Sub-flow E.
- **Retire a location** (no longer brand-fit). → Sub-flow F.

## Sub-flow A — `bootstrapLocation(input, generateNanoBananaPro)`

**Add a new canon-locked location to the active pool.** Two-step: this flow generates 1 candidate Rachel-in-location canonical (see "Known Higgsfield quirks" below — `count` is silently capped at 1); Yaron reviews; `approveLocation` (Sub-flow E) completes the bootstrap by writing the chosen URL + flipping status to `active`.

**Inputs:**

```ts
interface BootstrapLocationInput {
  location_number: number;          // 1, 2, ... — must be in CANON_LOCATION_NUMBERS_DEFINED
  aesthetic_reference_url: string;  // Public HTTPS URL to the desired location aesthetic
}
```

**Behavior (fail-fast, no partial DB writes):**

1. Validate `location_number ∈ CANON_LOCATION_NUMBERS_DEFINED`.
2. Resolve `location_id = location_NN` and look up canon brief in `CANON_LOCATIONS`.
3. Validate `aesthetic_reference_url` is non-empty + HTTPS.
4. DB idempotency check:
   - Active row with reference set → refuse (use `updateLocationReference` instead).
   - Pending row (pre-seeded by migration) → proceed.
   - Missing row → insert as `pending` so the flow stays idempotent.
5. Assemble the canonical-bootstrap prompt via `assembleCanonicalBootstrapPrompt(brief)` — applies `FORBIDDEN_RE` to the dynamic fields. Throws before any MCP call on forbidden identity terms.
6. ONE `nano_banana_pro` call with `count=LOCATION_BOOTSTRAP_CANDIDATES` (currently 1), `aspect_ratio='9:16'`, `resolution='2k'`, and `medias: [{ value: aesthetic_reference_url, role: 'image' }]`.
7. Return `{ location_id, candidate_canonicals: [{ job_id, url }, ...] }` — **transient**, no DB persistence of candidates. Array shape kept for forward compatibility.

**Cost:** ~$0.015 (1 nano_banana_pro call, count=1).

**CRITICAL — approval gate:**

> **Generating a candidate does NOT add the canonical to the location.** The location row remains `pending` and has no `reference_image_url` set until Yaron reviews the candidate and calls `approveLocation(location_id, chosen_url, chosen_job_id)`. That call writes the URL atomically with the status flip. An "active location without a canonical" is forbidden by the schema.

**Code:** `video/lib/location/flows/bootstrap-location.ts`.

## Sub-flow B — `generateAnchoredStill(look_id, location_id, generateNanoBananaPro)`

**Generate a wardrobe-swap still for an existing (look, location) combination, anchored on the location's locked canonical.**

This is the render-time on-demand flow. Use when `pickCombination` returns `needs_generation: true`, or when Yaron explicitly asks to fill a missing combo.

**Inputs:** `look_id` and `location_id` (both must be `active`), `generateNanoBananaPro` (DI transport).

**Behavior:**

1. Fetch look + location rows. Both must be `status='active'`.
2. Validate `location.reference_image_url` is set (bootstrap complete). If null → throw with a hint to run `bootstrapLocation` first.
3. Defensive: refuse if an active still already exists for this `(look_id, location_id)` combo (retire it first if you want to regenerate).
4. Assemble the short anchored-still prompt via `assembleAnchoredStillPrompt(look)` — applies `FORBIDDEN_RE` to the dynamic look fields.
5. ONE `nano_banana_pro` call with `count=ANCHORED_STILL_CANDIDATES` (currently 1, see Known Higgsfield quirks), `aspect_ratio='9:16'`, `resolution='2k'`, and `medias: [{ value: location.reference_image_url, role: 'image' }]`.
6. Insert each candidate into `rachel_stills` as `status='pending'`, with `reference_image_url_used = location.reference_image_url` snapshotted onto each row. That snapshot is the audit trail for `updateLocationReference` rotations.
7. Auto-approve the first (arrival-order) candidate via `updateStillStatus(first, 'active')`. Retire any siblings (no-op with count=1).
8. Return `{ still_id, soul_still_id, soul_still_url, reference_image_url_used, retired_still_ids }`.

**Auto-approve rationale:** render-time generation is blocking, so the orchestrator can't wait for human review. Yaron can swap stills afterward via the wardrobe-rotation still-lifecycle flows.

**Caveat:** the inserts + status flips are NOT a single DB transaction. A crash mid-flow may leave partial rows — same risk model as PR-A `generateStill`.

**Cost:** ~$0.015 (1 nano_banana_pro call, count=1).

**Code:** `video/lib/location/flows/generate-anchored-still.ts`.

## Sub-flow C — `getLocationReference(location_id)`

**Cheap read.** Returns the locked `reference_image_url` for a location, or `null` if the location has not yet been bootstrapped. Use to answer questions like "what does the studio canonical look like" or to check whether bootstrap is complete before triggering an anchored-still flow.

**Cost:** $0 (DB read only).

**Code:** `video/lib/location/flows/get-location-reference.ts`.

## Sub-flow D — `updateLocationReference(input, generateNanoBananaPro)` + `confirmReferenceUpdate(location_id, url, image_id)`

**Regenerate the canonical for an already-active location.** Two-step, same shape as Sub-flow A.

**`updateLocationReference`** behaves exactly like `bootstrapLocation` (generates `LOCATION_BOOTSTRAP_CANDIDATES` candidates — currently 1 — against the same canon brief + a fresh `aesthetic_reference_url`), but operates on an already-active row instead of a pending one. The location's current `reference_image_url` is **not** touched yet; the candidates are transient.

**`confirmReferenceUpdate`** writes the chosen `reference_image_url` + `reference_image_id` atomically. Status stays `active`. The old URL is **overwritten** on the location row.

**Historical preservation:** the `reference_image_url_used` snapshot column on `rachel_stills` is untouched — every existing anchored still retains the URL it was rendered against. Retiring stills generated against the old canonical (if you want a clean cut-over) is a separate operation, out of scope for this flow.

**Cost:** ~$0.015 (1 nano_banana_pro call, count=1).

**Code:** `video/lib/location/flows/update-location-reference.ts`.

## Sub-flow E — `approveLocation(location_id, reference_image_url, reference_image_id)`

**Bootstrap completion: pending → active.**

Atomically writes the chosen canonical's URL + image_id alongside the status flip. The reference write happens **before** the status flip, so any reader who sees `status='active'` is guaranteed to see `reference_image_url` set.

**Preconditions:**

- `reference_image_url` must be a non-empty HTTPS URL.
- `reference_image_id` must be non-empty.
- Location row must exist with `status='pending'`.

**Caveat:** the two writes (reference + status) are sequential, not a single DB transaction. A crash between them leaves the row in `(pending, reference_image_url set)` — recoverable by re-running `approveLocation` with the same arguments (idempotent on the reference column, then flips status).

**Code:** `video/lib/location/flows/approve-location.ts`.

## Sub-flow F — `retireLocation(location_id)`

**Active → retired.** Pool floors are enforced before the write:

- **`LOCATION_POOL_FLOOR = 2`** — at least 2 active locations must remain after retirement.
- **`PRIMARY_LOCATION_MIN = 1`** — at least 1 active primary-tier location must remain.

Both floors are checked via the pure `assertCanRetireLocation` guard (lives in `wardrobe-rotation/guards/`, imported here verbatim — no duplication). Throws on guard failure before any DB write.

**Code:** `video/lib/location/flows/retire-location.ts`.

## Hard rules (do not violate)

- **No reuse across layouts.** A location is a single canon definition + a single canonical, locked at bootstrap. Never repurpose `location_01` for a different room layout — retire it and bootstrap a new slot.
- **Canonical-bootstrap prompt MUST encode the framing.** Rachel ~60% width × ~60-70% height; no ceiling visible; no pendant lamps visible; surface band ≤20% bottom of frame with no near edge visible; frontal straight-on view. This is encoded in `assembleCanonicalBootstrapPrompt` — do not bypass.
- **Anchored-still prompt MUST be SHORT.** Only name the wardrobe to swap to. Location, pose, identity, and framing all carry from the canonical via the `medias` anchor. Long prompts confuse the model and risk drift (validated in Smoke 0d Stage B).
- **`FORBIDDEN_RE` applies to BOTH prompt assemblers.** Never describe Rachel's skin tone, hair color, scars, freckles, or other features that should come from the reference image. The static baseline descriptor ("olive skin, dark wavy hair") in the templates is whitelisted by being outside the dynamic input — tampered briefs are still rejected.
- **Podcast / recording elements MUST be excluded if present in the aesthetic reference** (headphones, mics, recording arms, phones on stands, ring lights). Validated in the Smoke 0d studio test. The canon brief's `props` list controls what makes it into the prompt — keep it clean.

## MCP shapes (validated 2026-05-22 in Smoke 0c + 0d)

**Bootstrap — Rachel-in-location canonical generation:**

```ts
mcp__78d93fcf-...__generate_image({
  model: 'nano_banana_pro',
  prompt: '<from assembleCanonicalBootstrapPrompt(brief)>',
  count: 1,                                    // see Known Higgsfield quirks
  aspect_ratio: '9:16',
  resolution: '2k',
  medias: [{ value: aesthetic_reference_url, role: 'image' }],
})
```

**Anchored-still — wardrobe swap against the locked canonical:**

```ts
mcp__78d93fcf-...__generate_image({
  model: 'nano_banana_pro',
  prompt: '<from assembleAnchoredStillPrompt(look)>',  // SHORT, only swap wardrobe
  count: 1,                                            // see Known Higgsfield quirks
  aspect_ratio: '9:16',
  resolution: '2k',
  medias: [{ value: location.reference_image_url, role: 'image' }],
})
```

Both flows accept the `nano_banana_pro` transport as a DI callable (`NanoBananaProFn`) so the MCP call is injected by the executing Claude session rather than hardcoded in the library. See `video/lib/location/flows/constants.ts` for the canonical comment block describing the Higgsfield quirks that govern `count` and `model` here.

## Known Higgsfield quirks (as of 2026-05-23)

1. **`count` is silently capped at 1.** Higgsfield's `generate_image` MCP delivers `batch_size: 1` regardless of the value passed. `LOCATION_BOOTSTRAP_CANDIDATES` and `ANCHORED_STILL_CANDIDATES` (in `constants.ts`) are set to 1 to match this reality. Do not raise them without confirming with a fresh Higgsfield support ticket — raising the constant without a transport fix would cause the `generateAnchoredStill` count-mismatch assertion to throw at runtime.
2. **`show_generations` history view displays `nano_banana_2`** for requests submitted with `model: 'nano_banana_pro'`. Unclear whether this is a display-only quirk or a silent downgrade at submission time. Do NOT rename the model name string — both PR-A revision and PR-C used this exact submission shape and produced acceptable quality. Pending Higgsfield support ticket.

## Cost reference

| Operation | nano_banana_pro calls | Approx. cost |
|---|---|---|
| `bootstrapLocation(input, ...)` | 1 (count=1) | ~$0.015 |
| `generateAnchoredStill(look, loc, ...)` | 1 (count=1) | ~$0.015 |
| `updateLocationReference(input, ...)` | 1 (count=1) | ~$0.015 |
| `getLocationReference(loc_id)` | 0 | $0 |
| `approveLocation(...)` | 0 | $0 |
| `retireLocation(loc_id)` | 0 | $0 |
| `confirmReferenceUpdate(...)` | 0 | $0 |

## Version

v2.0 — 2026-05-22 — PR-C: structured set definitions + Rachel-in-location canonical references via nano_banana_pro. Replaces the v1 soul_2-with-empty-room design rejected by Smoke 0/0b.
