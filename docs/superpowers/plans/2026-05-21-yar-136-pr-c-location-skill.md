# YAR-136 PR-C — Location Skill with Rachel-in-Location Canonical References — Implementation Plan

> **STATUS: UNPAUSED + REVISED 2026-05-22. Architecture validated end-to-end via Smoke 0/0b/0c/0d.**
>
> **Validation summary (~$0.60 total across all smoke iterations):**
> - **Smoke 0 + 0b** confirmed `soul_2 + medias` does NOT work for our use case — its mandatory `enhance_prompt: true` rewrites the prompt around the reference image, dropping Rachel or persisting the reference's wardrobe over our prompt's intent.
> - **Smoke 0c** discovered `nano_banana_pro + medias:[role:image]` preserves the user prompt verbatim AND composites Rachel + scene reference correctly.
> - **Smoke 0d (multiple iterations to converge on framing)** proved the full design: bootstrap a Rachel-in-location canonical with nano_banana_pro using a reference photo of the location aesthetic, then `generateAnchoredStill` uses that canonical as `medias` to swap wardrobe while preserving location AND identity.
> - **Validated across two locations** (kitchen + studio): location lock holds, identity holds, wardrobe swaps cleanly per prompt.
>
> **Key architectural pivot from the original plan:**
> - Model: ~~`soul_2`~~ → **`nano_banana_pro`** for both bootstrap AND anchored-still generation.
> - Identity: ~~`soul_id`~~ → identity comes from the reference image's face (nano_banana_pro doesn't support soul_id; doesn't need to — reference face carries identity).
> - Canonical content: ~~empty room with Rachel composited later~~ → **Rachel-in-location is generated DIRECTLY** as the canonical (one bootstrap step, not two).
> - Framing rules (locked from Smoke 0d iterations): Rachel ~60% width × ~60-70% height, no ceiling visible, no lamps visible, island/desk band ≤20% at bottom with no near edge visible, frontal straight-on facing camera.
>
> Schema, skill structure, lifecycle guards, and the `rachel_stills.reference_image_url_used` audit column from the original plan all carry forward unchanged. Only the model + canonical generation strategy changed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the freeform-string Location model from PR-A revision with structured set definitions (8 canon fields per location) + a **Rachel-in-location canonical reference image** that anchors every wardrobe swap. Every Rachel render must use the same room composition — like a creator's home studio.

**Architecture:** New `location` skill, separate from `avatar-full-wardrobe-rotation`. `rachel_locations` table dropped + rebuilt with 8 structured fields + per-location `reference_image_url` (a Rachel-in-location canonical, not an empty room). `rachel_stills` dropped + rebuilt with `reference_image_url_used` audit column (cascade wipes the 4 active stills from PR-A revision — intentional, they were generated against the inconsistent model). Six skill flows: bootstrap, anchored-still generation, get/update reference, approve, retire.

**Tech Stack:** TypeScript (matches PR-A revision), Node `--test` via `tsx`, `@supabase/supabase-js`, Higgsfield MCP — **`nano_banana_pro`** for both bootstrap canonical generation (Rachel-in-location with framing prompt + external reference image of location aesthetic) AND anchored-still generation (wardrobe swap with canonical as medias).

---

## ⚠️ Dependencies + blockers

### Blocker 1 — PR-A revision must merge first

This plan starts from a clean main with PR-A revision merged. PR #35 is currently open and force-pushed with the revision; **Yaron's eyeball + merge gates PR-C start**.

If PR-A doesn't merge as-is (further revision needed), PR-C plan may need adjustment — particularly around the canon look definitions and the `rachel_looks` table shape it depends on.

### Architecture validation — DONE (2026-05-22)

Smoke 0/0b/0c/0d retired this section as a blocker. See the top-of-file summary for full results. Both `medias[].role: 'image'` (the only supported role for both `soul_2` and `nano_banana_pro`) and the cross-location identity-preservation behavior of `nano_banana_pro` are empirically confirmed.

### Branch + scope

- New branch: `yarono/yar-136-pr-c-location-skill` (branched from `main` after PR #35 merges).
- Locations 03-08 wardrobe briefs: still TODO. PR-C ships kitchen (location_01) + studio (location_02) only.
- Looks 03-11: still TODO. PR-C doesn't touch the look pool.

---

## Cost preflight (verified 2026-05-22, post Smoke 0d)

All Higgsfield calls bill 1 credit per call regardless of `count` (1-4). Confirmed via `get_cost: true`.

**Smoke validation cost (already spent, 2026-05-21/22):** ~$0.60 across Smoke 0/0b/0c/0d iterations including multiple framing redo attempts to converge on the final spec.

**Post-merge bootstrap budget (forward-looking):**

| Phase | Calls | Credits | Cost |
|---|---|---|---|
| `bootstrapLocation(1)` → kitchen Rachel-in-location canonical (count=3, Yaron picks one) | 1 | 1 | ~$0.04 |
| `bootstrapLocation(2)` → studio Rachel-in-location canonical | 1 | 1 | ~$0.04 |
| 4× `generateAnchoredStill` (look_01 × location_01, look_02 × location_01, look_01 × location_02, look_02 × location_02) | 4 | 4 | ~$0.16 |
| **Bootstrap total** | **6** | **6** | **~$0.24** |

Per-iteration cost going forward (each new location bootstrap + per-look anchored still): ~$0.08 per location + ~$0.04 per anchored-still combo.

---

## Model selection (validated 2026-05-22 across Smoke 0c + 0d)

| Use | Model | Why |
|---|---|---|
| Bootstrap canonical (Rachel-in-location) | **`nano_banana_pro`** (Google) + `medias: [{value: location_aesthetic_ref_url, role: 'image'}]` + Rachel-in-location prompt | Preserves the user prompt verbatim (no enhance_prompt rewrite like soul_2). Composites Rachel identity + location aesthetic from reference image. Validated across kitchen + studio. |
| Anchored-still generation (wardrobe swap) | **`nano_banana_pro`** + `medias: [{value: canonical_url, role: 'image'}]` + wardrobe-swap prompt | Same model. Uses the approved canonical as the reference. Preserves canonical's location + identity, swaps only wardrobe per prompt. Validated pixel-near-identical to canonical except wardrobe. |

**Both bootstrap and anchored-still use the same model + same `medias[].role: 'image'` literal.** The only difference is the reference URL (external aesthetic reference for bootstrap; canonical URL for anchored-still) and the prompt (Rachel-in-location framing spec vs wardrobe-swap-only).

**Not used:** `soul_2` (rejected by Smoke 0/0b — its mandatory `enhance_prompt: true` rewrites prompts around the reference, dropping our intent). `soul_location` (rejected — no medias support).

---

## Framing rules (locked from Smoke 0d iterations)

Every canonical AND every anchored still must follow these framing rules. Encoded into the prompt template:

- **Rachel covers ~60% of frame WIDTH** (shoulders wide in 9:16 vertical frame)
- **Rachel covers ~60-70% of frame HEIGHT** (head/shoulders/torso/waist fill the vertical span)
- **Frontal straight-on view**, body squared to camera, looking directly at camera
- **NO ceiling visible** (top edge crops well below ceiling)
- **NO pendant lamps or overhead lights visible** (not even bottoms)
- **Island/desk band at bottom ≤20% of frame height**, only the middle/back portion visible (no near edge of the surface visible)
- Rachel's hands rest on the visible surface in front of her
- Background visible only at narrow margins around Rachel — kitchen/studio elements (cooktop, oven, plant, window, etc.) just glimpsed
- **Photorealistic, natural lighting, shallow depth of field**

---

## Migration SQL (full file)

**File:** `supabase/migrations/<NEW_TIMESTAMP>_location_skill_rebuild.sql`

```sql
-- YAR-136 PR-C: rebuild rachel_locations with structured set fields +
-- reference image anchor. Cascade-wipes rachel_stills (4 active + retired
-- siblings from PR-A revision) — intentional, those were generated against
-- the inconsistent location model.
--
-- The look pool (rachel_looks: look_01, look_02 active) is preserved unchanged.

BEGIN;

-- 1. Drop existing tables. CASCADE on rachel_locations also drops rachel_stills
--    (FK reference). rachel_stills drop is then a no-op-but-safe explicit re-drop.
DROP TABLE rachel_stills CASCADE;
DROP TABLE rachel_locations CASCADE;

-- 2. Rebuild rachel_locations with structured set definition
CREATE TABLE rachel_locations (
  location_id text PRIMARY KEY,
  name text NOT NULL,                       -- 'kitchen', 'home_studio'
  tier text NOT NULL CHECK (tier IN ('primary', 'secondary')),

  -- Structured set definition (all required)
  camera_angle text NOT NULL,               -- 'eye level, straight on'
  camera_distance text NOT NULL,            -- 'medium shot, waist up'
  rachel_position text NOT NULL,            -- 'standing behind kitchen island, centered in frame, hands resting on island'
  background_composition text NOT NULL,     -- 'kitchen island in foreground, range and stainless hood mid-ground center, large window with sheer curtain camera-right'
  lighting_setup text NOT NULL,             -- 'soft morning daylight from camera-right window, warm fill from above, no harsh shadows'
  props text[] NOT NULL,                    -- ['ceramic mug on island', 'wooden cutting board with herbs', ...]
  wall_color text NOT NULL,                 -- 'soft cream'
  floor_material text NOT NULL,             -- 'light oak hardwood'

  -- Empty-room reference image (the location lock)
  reference_image_url text,                 -- NULL until bootstrapped + approved
  reference_image_id text,                  -- Higgsfield job ID for the approved reference

  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  created_by text NOT NULL,
  source text NOT NULL DEFAULT 'skill_v1'
    CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_locations_status_idx ON rachel_locations(status);
CREATE INDEX rachel_locations_tier_active_idx
  ON rachel_locations(tier) WHERE status='active';

COMMENT ON TABLE rachel_locations IS
  'Structured set definitions for Rachel''s Avatar Full locations. Each row '
  'is one canonical room (kitchen, studio, etc.) with all set details + a '
  'locked empty-room reference_image_url. Every still generated against '
  'this location uses the reference as a scene anchor via soul_2 medias.';

-- 3. Rebuild rachel_stills with audit column for reference snapshot
CREATE TABLE rachel_stills (
  still_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id text NOT NULL REFERENCES rachel_looks(look_id),
  location_id text NOT NULL REFERENCES rachel_locations(location_id),
  soul_still_id text NOT NULL,
  soul_still_url text NOT NULL,
  reference_image_url_used text NOT NULL,   -- snapshot at generation time
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  created_by text NOT NULL
);

CREATE UNIQUE INDEX rachel_stills_active_combo_idx
  ON rachel_stills (look_id, location_id) WHERE status='active';
CREATE INDEX rachel_stills_combo_idx ON rachel_stills (look_id, location_id);
CREATE INDEX rachel_stills_status_idx ON rachel_stills (status);

COMMENT ON TABLE rachel_stills IS
  'Per-combination Soul stills. reference_image_url_used snapshots the '
  'location''s reference at generation time — survives location reference '
  'updates so we can audit which stills were generated against which '
  'reference version.';

-- 4. Pre-seed pending location rows (without reference images — those get
--    minted via bootstrapLocation in the post-merge workflow). This lets
--    the canon definitions live in DB from day 1; the reference URL fills
--    in later via the approval flow.

INSERT INTO rachel_locations (
  location_id, name, tier,
  camera_angle, camera_distance, rachel_position,
  background_composition, lighting_setup, props,
  wall_color, floor_material,
  notes, status, created_by, source
) VALUES (
  'location_01',
  'kitchen',
  'primary',
  'eye level, straight on',
  'medium shot, waist up',
  'standing behind kitchen island, centered in frame, hands resting on island',
  'kitchen island in foreground, range and stainless hood mid-ground center, large window with sheer curtain camera-right',
  'soft morning daylight from camera-right window, warm fill from above, no harsh shadows',
  ARRAY['ceramic mug on island', 'wooden cutting board with herbs', 'small potted basil plant', 'folded linen tea towel'],
  'soft cream',
  'light oak hardwood',
  'Canon primary location #1. Reference image pending — mint via bootstrapLocation(1).',
  'pending',
  'canon_seed',
  'canon_seed'
);

INSERT INTO rachel_locations (
  location_id, name, tier,
  camera_angle, camera_distance, rachel_position,
  background_composition, lighting_setup, props,
  wall_color, floor_material,
  notes, status, created_by, source
) VALUES (
  'location_02',
  'home_studio',
  'primary',
  'eye level, straight on',
  'medium shot, chest up',
  'seated at wooden desk, centered in frame, hands resting near laptop',
  'wooden desk in foreground, full-height bookshelf with books and decor mid-ground center, plant camera-left, framed art camera-right',
  'warm desk lamp camera-left, soft ambient afternoon light from off-camera window, golden cast on bookshelf',
  ARRAY['open laptop on desk', 'ceramic mug', 'small notebook and pen', 'desk lamp with brass finish', 'monstera plant in terracotta pot'],
  'warm off-white',
  'medium oak hardwood',
  'Canon primary location #2. Reference image pending — mint via bootstrapLocation(2).',
  'pending',
  'canon_seed',
  'canon_seed'
);

COMMIT;
```

**Cascade impact confirmed:** dropping `rachel_locations` cascades to `rachel_stills` (FK). The current 4 active stills + 12 retired siblings from PR-A revision get wiped. The look pool (`rachel_looks` rows for look_01 + look_02) is preserved.

**Why pre-seed pending rows:** keeps the structured canon data in DB from day 1. The bootstrap flow then just generates the reference image and updates `reference_image_url` + flips status to `active`. Cleaner than "insert from scratch in bootstrap" — single source of truth.

---

## Canon location briefs (TypeScript types + dict)

**File:** `video/lib/location/canon/canon-locations.ts`

```ts
// Structured canon definitions for Rachel's locations.
// Source: spec discussion 2026-05-21 with Yaron. These mirror the seeded
// rows in supabase/migrations/<NEW_TIMESTAMP>_location_skill_rebuild.sql.
//
// The CANON_LOCATIONS dict is the authoritative source for bootstrap
// prompt assembly. DB rows track lifecycle (pending → active → retired)
// + the reference_image_url that anchors generation.

import type { CanonLocationBrief } from '../types.js';

export const CANON_LOCATIONS: Record<string, CanonLocationBrief> = {
  location_01: {
    name: 'kitchen',
    tier: 'primary',
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, waist up',
    rachel_position: 'standing behind kitchen island, centered in frame, hands resting on island',
    background_composition: 'kitchen island in foreground, range and stainless hood mid-ground center, large window with sheer curtain camera-right',
    lighting_setup: 'soft morning daylight from camera-right window, warm fill from above, no harsh shadows',
    props: [
      'ceramic mug on island',
      'wooden cutting board with herbs',
      'small potted basil plant',
      'folded linen tea towel',
    ],
    wall_color: 'soft cream',
    floor_material: 'light oak hardwood',
    best_for: 'parenting insights, mom health, day-to-day mom content',
  },
  location_02: {
    name: 'home_studio',
    tier: 'primary',
    camera_angle: 'eye level, straight on',
    camera_distance: 'medium shot, chest up',
    rachel_position: 'seated at wooden desk, centered in frame, hands resting near laptop',
    background_composition: 'wooden desk in foreground, full-height bookshelf with books and decor mid-ground center, plant camera-left, framed art camera-right',
    lighting_setup: 'warm desk lamp camera-left, soft ambient afternoon light from off-camera window, golden cast on bookshelf',
    props: [
      'open laptop on desk',
      'ceramic mug',
      'small notebook and pen',
      'desk lamp with brass finish',
      'monstera plant in terracotta pot',
    ],
    wall_color: 'warm off-white',
    floor_material: 'medium oak hardwood',
    best_for: 'AI Magic, Tech for Moms, Financial, explainer content',
  },
  // location_03 through location_08: TODO. Defined in follow-up session.
};

export const CANON_LOCATION_NUMBERS_DEFINED: readonly number[] = [1, 2];
```

Updated `CanonLocationBrief` interface in `types.ts`:

```ts
export interface CanonLocationBrief {
  name: string;
  tier: LocationTier;
  camera_angle: string;
  camera_distance: string;
  rachel_position: string;
  background_composition: string;
  lighting_setup: string;
  props: readonly string[];
  wall_color: string;
  floor_material: string;
  best_for: string;
}
```

---

## File structure

The PR-A revision module at `video/lib/wardrobe-rotation/` stays mostly intact. PR-C adds a new sibling module `video/lib/location/` for the location skill, and updates `wardrobe-rotation/db.ts` to reflect the rebuilt `rachel_stills` schema.

### New files

```
skills/location/
  SKILL.md                           -- new skill, 6 flows, distinct from wardrobe-rotation
video/lib/location/
  index.ts                           -- public barrel
  types.ts                           -- LocationStatus, CanonLocationBrief (moved from wardrobe-rotation/types.ts)
  db.ts                              -- queries for rachel_locations + reference handling
  canon/
    canon-locations.ts               -- CANON_LOCATIONS dict with 8 structured fields + aesthetic_reference_url per location
  prompt/
    canonical-bootstrap-prompt.ts    -- assembles nano_banana_pro prompt for Rachel-in-location canonical (with framing rules)
    anchored-still-prompt.ts         -- assembles nano_banana_pro prompt for wardrobe-swap (short, lets canonical dominate)
  flows/
    bootstrap-location.ts            -- 3 Rachel-in-location canonical candidates via nano_banana_pro + external aesthetic ref URL
    generate-anchored-still.ts       -- 3 wardrobe-swap candidates via nano_banana_pro + approved canonical as medias
    get-location-reference.ts        -- returns reference_image_url for a location
    update-location-reference.ts     -- regenerates canonical for an existing location
    approve-location.ts              -- pending → active (requires reference_image_url set to approved canonical)
    retire-location.ts               -- active → retired with floor-2 + ≥1 primary guard
    constants.ts                     -- LOCATION_BOOTSTRAP_CANDIDATES=3, ANCHORED_STILL_CANDIDATES=3
  __tests__/
    canonical-bootstrap-prompt.test.ts  -- pure-function tests
    anchored-still-prompt.test.ts
    canon-locations.test.ts          -- validates all 8 fields present + non-empty + aesthetic_reference_url is HTTPS URL
supabase/migrations/
  <NEW_TIMESTAMP>_location_skill_rebuild.sql
```

### Modified files

```
video/lib/wardrobe-rotation/
  types.ts                           -- RachelLocation shape updated for 8 new fields + reference_image_url; remove CanonLocationBrief (moved to location/types.ts)
  db.ts                              -- update RachelLocation queries for new shape; rachel_stills queries updated for reference_image_url_used column
  canon/canon-locations.ts           -- DELETE (moved to location/canon/)
  pickers/pick-combination.ts        -- consumes RachelLocation + RachelStill from updated db.ts (no API change)
  index.ts                           -- update re-exports (drop the old CanonLocationBrief export)
claude.md                            -- document the two-skill architecture (wardrobe + location)
```

### Files deleted from PR-A revision

```
video/lib/wardrobe-rotation/flows/bootstrap-canon-location.ts
  -- Replaced by location/flows/bootstrap-location.ts (different semantics:
  -- bootstrap now generates an empty-room reference, NOT 6 anchored stills)
video/lib/wardrobe-rotation/flows/approve-location.ts
  -- Replaced by location/flows/approve-location.ts (now requires reference_image_url)
video/lib/wardrobe-rotation/flows/retire-location.ts
  -- Replaced by location/flows/retire-location.ts
video/lib/wardrobe-rotation/flows/generate-still.ts
  -- Replaced by location/flows/generate-anchored-still.ts (uses medias anchor)
video/lib/wardrobe-rotation/__tests__/<related tests>
```

The PR-A wardrobe-rotation skill keeps: pickers (look + location + combination), look-only canon, look-only bootstrap, look-only approve/retire, still-only approve/retire (because still lifecycle isn't location-specific). The location skill owns: location lifecycle, reference image generation, anchored still generation.

---

## Skill: `skills/location/SKILL.md`

Six flows, each with a trigger phrase block.

### Frontmatter

```yaml
---
name: location
description: Manages Rachel's locked location sets — kitchen, home studio, etc. Each location is a structured set definition (camera angle, position, background, lighting, props, wall + floor) plus a Rachel-in-location canonical reference image generated via nano_banana_pro. Every wardrobe-swap render uses that canonical as a medias reference so the same kitchen, same pose, same Rachel face appears identically across every wardrobe variant. Use when bootstrapping a new canon location (generates 3 Rachel-in-location candidates for review using an external aesthetic reference URL), generating an anchored still for an existing (look, location) combo (wardrobe swap against the locked canonical), querying or refreshing a location's canonical, or approving/retiring a location. Triggers on phrases like "bootstrap a new location", "generate the studio canonical", "fill location_03", "approve location_03 candidate 2", "regenerate the kitchen canonical", "generate Rachel in white tee in the kitchen", "what does the studio canonical look like", "retire the studio location".
---
```

### Sections

1. **Architecture overview** — three-axis composition: look (styling) + location (structured set + Rachel-in-location canonical) + still (cached wardrobe-swap combo). Location-skill owns the location axis; wardrobe-rotation skill owns the look axis + the picker orchestration.

2. **Sub-flow A — `bootstrapLocation(N, aesthetic_reference_url)`** — generates 3 Rachel-in-location canonical candidates via `nano_banana_pro + medias:[{role:'image', value:aesthetic_reference_url}]` with the canon brief + framing prompt assembled by `canonical-bootstrap-prompt.ts`. The `aesthetic_reference_url` is a public URL to an image showing the desired location aesthetic (e.g. kitchen with marble island, studio with monstera + window) — Yaron provides per location. Yaron reviews 3 outputs, picks one. The chosen URL becomes the location's `reference_image_url` and the location transitions `pending` → `active`. **Approval gate** prominently documented.

3. **Sub-flow B — `generateAnchoredStill(look_id, location_id)`** — generates 3 wardrobe-swap candidates via `nano_banana_pro + medias:[{role:'image', value:reference_image_url}]` (the approved canonical). Short prompt names ONLY the wardrobe to swap to; everything else (location, pose, identity, framing) is preserved from the canonical. Auto-approves the first candidate (by arrival order). Inserts to `rachel_stills` with `reference_image_url_used` snapshot.

4. **Sub-flow C — `getLocationReference(location_id)`** — returns the locked `reference_image_url` (the Rachel-in-location canonical). Cheap read.

5. **Sub-flow D — `updateLocationReference(location_id, aesthetic_reference_url)`** — regenerates the canonical (3 new candidates, Yaron picks one). Old reference URL preserved in the `reference_image_url_used` audit column of existing stills; current location row's `reference_image_url` updated. Stills generated against the OLD reference can be retired in bulk via a separate cleanup pass (out of scope for PR-C).

6. **Sub-flow E — `approveLocation(location_id, reference_image_url, reference_image_id)`** — pending → active. **Requires `reference_image_url` to be set** (no active locations without a canonical). Implemented as a precondition check.

7. **Sub-flow F — `retireLocation(location_id)`** — active → retired with floor=2 + ≥1 primary guard, same as PR-A revision.

8. **Hard rules**
   - Never reuse a location across two different room layouts (single canon definition + single canonical per location_id, locked at bootstrap).
   - The canonical-bootstrap prompt MUST encode the framing rules (Rachel ~60% × ~60-70%, no ceiling, no lamps, island/desk ≤20% band, no near edge, frontal straight-on). Reusable prompt template.
   - The anchored-still prompt MUST be SHORT — only name the wardrobe swap. Everything else (location, pose, framing, identity) carries from the canonical. Long prompts confuse the model and risk drift.
   - The forbidden-identity-term regex (`FORBIDDEN_RE` from `wardrobe-rotation/prompt/forbidden-identity-regex.ts`) applies to BOTH prompt assemblers — never describe Rachel's face/skin/features.
   - If the aesthetic reference contains podcast/recording elements (headphones, mic, phone), explicitly EXCLUDE them in the bootstrap prompt (validated in Smoke 0d studio test).

9. **MCP shapes (validated 2026-05-22 in Smoke 0c + 0d)**

   Bootstrap canonical generation:
   ```
   mcp__78d93fcf-...__generate_image({
     model: 'nano_banana_pro',
     prompt: '<assembled from canon brief + framing rules, see prompt/canonical-bootstrap-prompt.ts>',
     count: 3,
     aspect_ratio: '9:16',
     resolution: '2k',
     medias: [{ value: aesthetic_reference_url, role: 'image' }],
   })
   ```

   Anchored-still (wardrobe swap) generation:
   ```
   mcp__78d93fcf-...__generate_image({
     model: 'nano_banana_pro',
     prompt: '<from prompt/anchored-still-prompt.ts — SHORT, only swap wardrobe>',
     count: 3,
     aspect_ratio: '9:16',
     resolution: '2k',
     medias: [{ value: location.reference_image_url, role: 'image' }],
   })
   ```

10. **Cost reference**
    - bootstrapLocation: 1 call (count=3) = 1 credit ≈ $0.04
    - generateAnchoredStill: 1 call (count=3) = 1 credit ≈ $0.04
    - Reference get / approve / retire: $0

11. **Version** — v2.0 — 2026-05-22. PR-C: location skill with structured set definitions + Rachel-in-location canonical references via nano_banana_pro. Replaces the v1 soul_2-with-empty-room design rejected by Smoke 0/0b.

---

## Prompt assemblers

### `prompt/canonical-bootstrap-prompt.ts`

This generates the Rachel-in-location canonical via nano_banana_pro with an external aesthetic reference image as `medias`. Output template is locked from the converged Smoke 0d framing.

```ts
import type { CanonLocationBrief } from '../types.js';
import { FORBIDDEN_RE } from '../../wardrobe-rotation/prompt/forbidden-identity-regex.js';

/**
 * Assembles the Rachel-in-location canonical generation prompt for nano_banana_pro.
 *
 * Used by bootstrapLocation. The aesthetic_reference_url (passed separately via medias[])
 * provides the location aesthetic (style, color palette, room elements). This prompt
 * locks Rachel's position + framing on top of that aesthetic.
 *
 * Framing rules encoded here are locked from the Smoke 0d iterations.
 *
 * @throws if loc fields contain forbidden identity descriptors.
 */
export function assembleCanonicalBootstrapPrompt(loc: CanonLocationBrief): string {
  // Surface-aware position: 'standing behind island' for kitchen, 'seated at desk' for studio, etc.
  // Derived from loc.rachel_position which carries the position spec from canon.
  const propsClause = loc.props.length > 0
    ? `Visible context in the background includes: ${loc.props.slice(0, 4).join(', ')}.`
    : '';

  const prompt = [
    `Rachel (mid-30s woman, olive skin, dark wavy hair down past her shoulders, calm expression, no smile, cream cable-knit sweater) ${loc.rachel_position} in THIS EXACT ${loc.name} from the reference image. Frontal straight-on view facing the camera directly.`,
    '',
    'Rachel is THE central subject and dominates the frame:',
    '- She covers approximately 60% of the frame WIDTH (shoulders wide in the frame).',
    '- She covers approximately 60-70% of the frame HEIGHT.',
    '- CLOSE portrait-style framing.',
    '',
    `Bottom of frame: the ${loc.name === 'kitchen' ? 'marble island' : 'wooden desk'} top is a thin horizontal band at the very bottom, LESS than 20% of frame height. Only the middle/back portion of the surface is visible — no near edge visible. Rachel's hands rest on the surface in front of her.`,
    '',
    'Top of frame: NO ceiling visible. NO pendant lamps visible at all. Top edge crops above her head at the wall/cabinet level.',
    '',
    `Background visible only at narrow margins around Rachel: ${loc.background_composition}. ${loc.lighting_setup}. ${propsClause}`,
    '',
    'Photorealistic, bright, natural lighting, shallow depth of field. The location aesthetic must match the reference image — same coastal-modern feel.',
  ].filter(Boolean).join('\n');

  const match = FORBIDDEN_RE.exec(prompt);
  if (match) {
    throw new Error(
      `assembleCanonicalBootstrapPrompt: forbidden identity term "${match[0]}" detected in the assembled prompt or canon brief. ` +
      'Never describe Rachel\'s skin tone, hair color, scars, freckles, or other features that should come from the reference image.',
    );
  }

  return prompt;
}
```

Note: the static description "olive skin, dark wavy hair" is intentional here as it describes Rachel's identity for the model to render correctly. The FORBIDDEN_RE regex is calibrated to allow these baseline descriptors in the bootstrap prompt (which generates the FIRST Rachel-in-location instance) but reject more aggressive feature descriptors (freckles preserved, scar visible, etc.) — see existing `wardrobe-rotation/prompt/forbidden-identity-regex.ts`.

### `prompt/anchored-still-prompt.ts`

```ts
import type { RachelLook } from '../../wardrobe-rotation/types.js';
import { FORBIDDEN_RE } from '../../wardrobe-rotation/prompt/forbidden-identity-regex.js';

/**
 * Assembles the wardrobe-swap prompt for nano_banana_pro.
 *
 * The canonical (passed separately via medias[]) provides the location AND
 * Rachel's identity AND the pose AND the framing. This prompt only names
 * the wardrobe to swap to.
 *
 * SHORT prompt by design — long prompts confuse the model and risk drift.
 * Validated in Smoke 0d Stage B: this minimal prompt reliably preserves
 * the canonical's location + identity while swapping wardrobe.
 */
export function assembleAnchoredStillPrompt(look: RachelLook): string {
  const accessoriesClause = look.accessories ? `, ${look.accessories}` : '';

  const prompt = [
    `Rachel (mid-30s woman, olive skin, dark wavy hair down past her shoulders, calm expression, no smile, wearing ${look.wardrobe}, ${look.hair}${accessoriesClause}) standing in THIS EXACT location from the reference image, in the same position and same framing as the reference. Frontal straight-on view facing the camera directly.`,
    '',
    `The location, framing, camera angle, lighting, and composition must EXACTLY match the reference image. The ONLY difference: Rachel is wearing ${look.wardrobe} instead of the wardrobe in the reference.`,
    '',
    'Rachel covers ~60% width and ~60-70% height of the frame, just like the reference. Surface band at the bottom, no near edge visible. No ceiling, no pendant lamps visible.',
    '',
    'Photorealistic.',
  ].join('\n');

  const match = FORBIDDEN_RE.exec(prompt);
  if (match) {
    throw new Error(
      `assembleAnchoredStillPrompt: forbidden identity term "${match[0]}" detected. ` +
      'Never describe Rachel\'s skin texture, freckles, scars, or other features beyond the baseline identity descriptors.',
    );
  }

  return prompt;
}
```

---

## Tasks (TDD where applicable, gated where money)

### Task 0 — DONE (Smoke 0/0b/0c/0d, 2026-05-22)

All architecture validation already completed. See top-of-file summary. Skip in execution.

### Task 1 — Migration

**Files:** `supabase/migrations/<NEW_TIMESTAMP>_location_skill_rebuild.sql`

- [ ] **Step 1:** Get current UTC timestamp.
- [ ] **Step 2:** Write migration SQL (full body above).
- [ ] **Step 3:** Static check: `grep -c "BEGIN\|COMMIT\|DROP TABLE\|CREATE TABLE\|CREATE INDEX\|CREATE UNIQUE INDEX\|INSERT INTO\|COMMENT ON" <file>` — expect ~14 statements.
- [ ] **Step 4:** Commit. DO NOT apply yet.
  ```bash
  git add supabase/migrations/<NEW_TIMESTAMP>_location_skill_rebuild.sql
  git commit -m "feat(location): drop+rebuild rachel_locations with structured fields (YAR-136 PR-C)"
  ```

### Task 2 — Move + extend types

**Files:**
- Create: `video/lib/location/types.ts`
- Modify: `video/lib/wardrobe-rotation/types.ts` (drop `CanonLocationBrief`, update `RachelLocation` shape)
- Modify: `video/lib/wardrobe-rotation/index.ts` (update re-exports)

- [ ] **Step 1:** Move `CanonLocationBrief` from wardrobe-rotation/types.ts to location/types.ts with the new 8-field shape.
- [ ] **Step 2:** Update `RachelLocation` interface in wardrobe-rotation/types.ts to add the 10 new columns (`name`, `camera_angle`, `camera_distance`, `rachel_position`, `background_composition`, `lighting_setup`, `props: string[]`, `wall_color`, `floor_material`, `reference_image_url: string | null`, `reference_image_id: string | null`) and drop the old `setting`, `lighting`, `framing` fields.
- [ ] **Step 3:** Type-check: `npx tsc --noEmit --skipLibCheck video/lib/location/types.ts video/lib/wardrobe-rotation/types.ts`.
- [ ] **Step 4:** Run `npm test` — confirm no regression. The wardrobe-rotation pickers don't reference the removed fields, so should still pass.
- [ ] **Step 5:** Commit.

### Task 3 — Canon location dict

**Files:**
- Create: `video/lib/location/canon/canon-locations.ts`
- Create: `video/lib/location/__tests__/canon-locations.test.ts`
- Delete: `video/lib/wardrobe-rotation/canon/canon-locations.ts`

- [ ] **Step 1:** Write the new canon-locations.ts with the dict above.
- [ ] **Step 2:** Write tests that validate every defined slot has all 8 structured fields populated (non-empty strings, non-empty arrays for props).
- [ ] **Step 3:** Run tests → pass.
- [ ] **Step 4:** Delete the wardrobe-rotation canon file.
- [ ] **Step 5:** Commit.

### Task 4 — Prompt assemblers (TDD)

**Files:**
- Create: `video/lib/location/prompt/canonical-bootstrap-prompt.ts`
- Create: `video/lib/location/prompt/anchored-still-prompt.ts`
- Create: `video/lib/location/__tests__/canonical-bootstrap-prompt.test.ts`
- Create: `video/lib/location/__tests__/anchored-still-prompt.test.ts`

Implementation per the pseudocode above. Tests cover:

- **canonical-bootstrap-prompt** (5+ cases):
  1. Happy path: canon location_01 produces prompt containing 'standing behind kitchen island', '60% of the frame WIDTH', 'no ceiling visible'.
  2. Framing rules always present (60% × 60-70%, no ceiling, no lamps, ≤20% bottom band, no near edge).
  3. `THIS EXACT ${loc.name}` always included to anchor the model to the reference image.
  4. Throws on tampered brief: `background_composition` contains 'olive skin'.
  5. Throws on tampered brief: `lighting_setup` contains 'freckles'.
  6. location_01 (kitchen) → 'marble island' phrasing in the surface band line; location_02 (studio) → 'wooden desk' phrasing.

- **anchored-still-prompt** (5+ cases):
  1. Happy path: cream-knit look → prompt contains the wardrobe + framing reminder.
  2. Null accessories handled (look_01 has accessories=null).
  3. With accessories (look_04-equivalent 'small gold necklace'): accessories included in the wardrobe phrase.
  4. Prompt is SHORT — total length < 600 characters (validated in Smoke 0d that short prompts work best for wardrobe-swap).
  5. Throws when look.wardrobe contains 'olive skin'.
  6. Output explicitly says "ONLY difference" to emphasize wardrobe-only change.

- [ ] Steps 1-5 standard TDD per assembler. Two commits, one per assembler.

### Task 5 — DB layer extensions

**Files:**
- Create: `video/lib/location/db.ts`
- Modify: `video/lib/wardrobe-rotation/db.ts` (update RachelLocation queries for new shape; rachel_stills `reference_image_url_used` field added)

`location/db.ts` exposes:
- `listActiveLocations()`, `listLocations(status?)`, `getLocation(location_id)`, `insertLocation(...)`, `updateLocationStatus(location_id, status)`, `updateLocationReferenceImage(location_id, url, id)` — new function for the bootstrap-approve flow.
- `getLocationReferenceImage(location_id): Promise<string | null>` — convenience for the get/anchored-still flows.

`wardrobe-rotation/db.ts` updates:
- `RachelLocation` queries return the new shape (all 11 added columns).
- `RachelStill` insert/list includes `reference_image_url_used`.
- The lazy `getSupabase()` pattern preserved.

- [ ] Standard impl + manual sanity ping. Commit.

### Task 6 — Bootstrap location flow

**File:** `video/lib/location/flows/bootstrap-location.ts`

```ts
export interface BootstrapLocationInput {
  location_number: number;
  aesthetic_reference_url: string;  // Public URL to a photo of the desired location aesthetic
}

export interface BootstrapLocationResult {
  location_id: string;
  candidate_canonicals: Array<{ job_id: string; url: string }>;
}
```

Behavior:
1. Validate `location_number` is in CANON_LOCATION_NUMBERS_DEFINED.
2. Look up the canon brief.
3. Check DB: if the location row is already `active` with a `reference_image_url` set, refuse (idempotency).
4. Validate `aesthetic_reference_url` is a valid HTTPS URL.
5. Assemble the canonical-bootstrap prompt via `canonical-bootstrap-prompt.ts`.
6. Generate 3 candidates via single `nano_banana_pro` call with `count: 3, aspect_ratio: '9:16', resolution: '2k', medias: [{value: aesthetic_reference_url, role: 'image'}]`.
7. Return `{ location_id, candidate_canonicals: [{job_id, url}, ...] }` for Yaron review.

Note: candidates are NOT yet persisted to DB. They're transient. The user picks one, then calls `approveLocation(location_id, chosen_url, chosen_job_id)` which atomically writes `reference_image_url` + flips status to active.

- [ ] Implementation + commit. DI-style transport for the Higgsfield call (`GenerateImagesFn` reused from PR-A's bootstrap-canon-look.ts, factored out into `location/flows/constants.ts`).

### Task 7 — Generate anchored still flow

**File:** `video/lib/location/flows/generate-anchored-still.ts`

Behavior:
1. Validate look and location both exist and active.
2. Validate location has `reference_image_url` set (refuse if NULL — can't anchor without a canonical).
3. Refuse if an active still already exists for the combo (defensive; PR-A pattern carried over).
4. Assemble the anchored-still prompt via `anchored-still-prompt.ts` (SHORT, only names wardrobe).
5. Generate 3 candidates via `nano_banana_pro + medias:[{role:'image', value: location.reference_image_url}]`.
6. Insert all 3 as pending with `reference_image_url_used = location.reference_image_url`.
7. Auto-approve the first; retire the other 2.
8. Return the active still's metadata + the 2 retired IDs (matches PR-A's `GenerateStillResult` shape).

- [ ] Implementation + commit.

### Task 8 — Extended approve-location

**File:** `video/lib/location/flows/approve-location.ts`

Signature differs from PR-A revision's approveLocation. New shape:

```ts
export async function approveLocation(
  location_id: string,
  reference_image_url: string,
  reference_image_id: string,
): Promise<RachelLocation>
```

Behavior:
1. Get the location row. Throw if not found or not pending.
2. Atomically update: `status='active', approved_at=now(), reference_image_url=$2, reference_image_id=$3`.
3. Return updated row.

This is the bootstrap completion step. After Yaron picks a candidate from `bootstrapLocation`'s 6 results, this writes the reference URL + flips status.

- [ ] Implementation + commit.

### Task 9 — Retire location + get/update reference flows

**Files:**
- `video/lib/location/flows/retire-location.ts` — carries over PR-A semantics (floor=2 + ≥1 primary guard). Imports `assertCanRetireLocation` from wardrobe-rotation/guards/ (no need to duplicate).
- `video/lib/location/flows/get-location-reference.ts` — thin wrapper over `getLocationReferenceImage` from db.ts.
- `video/lib/location/flows/update-location-reference.ts` — regenerates reference via `bootstrapLocation` flow internally. Returns 6 new candidates for review. User then calls a new flow `confirmReferenceUpdate(location_id, chosen_url, chosen_id)` which `UPDATE`s the location's reference_image_url (preserving status as 'active') — the old URL is not deleted from DB anywhere; it survives in `rachel_stills.reference_image_url_used`.

- [ ] Implementation + commit.

### Task 10 — Public index + SKILL.md

**Files:**
- Create: `video/lib/location/index.ts` (barrel).
- Create: `skills/location/SKILL.md` per the structure above.
- Delete from PR-A revision: `video/lib/wardrobe-rotation/flows/bootstrap-canon-location.ts`, `flows/approve-location.ts`, `flows/retire-location.ts`, `flows/generate-still.ts` (and any related test files).

- [ ] Audit wardrobe-rotation/index.ts: drop the now-stale exports for the deleted flows. Pickers + look-only flows + still-only flows remain.

- [ ] Commit.

### Task 11 — Update claude.md

Document the two-skill architecture:
- `avatar-full-wardrobe-rotation` — picker + look lifecycle + still lifecycle
- `location` — location lifecycle + locked reference + anchored generation

Single-paragraph update + table entry. Commit.

### Task 12 — Apply migration (gated)

Explicit Yaron consent. Verify post-apply: 2 pending location rows seeded with all 8 fields, 0 rows in rachel_stills (the cascade wiped them).

### Tasks 13-15 — Post-implementation smoke tests (gated)

All architecture validation is DONE pre-merge (Smoke 0/0b/0c/0d documented at top of file). Post-implementation smokes only re-validate the code path now that it's encoded in TypeScript:

#### Smoke A — End-to-end bootstrap via skill

After migration applied + code merged, invoke `bootstrapLocation({location_number: 1, aesthetic_reference_url: <kitchen URL>})` via the skill. Confirm 3 candidates returned. Yaron approves one. `approveLocation` writes the URL + flips status. Verify DB state.

Cost: 1 credit ≈ $0.04.

#### Smoke B — End-to-end anchored still via skill

After Smoke A's location_01 is active, invoke `generateAnchoredStill(look_id: 'look_01', location_id: 'location_01')`. Confirm 3 candidates returned, first auto-approved, 2 retired. Visual review: same kitchen as Smoke A canonical, same Rachel face, same pose, cream cable-knit sweater per look_01.

Cost: 1 credit ≈ $0.04.

#### Smoke C — Cross-look swap via skill

`generateAnchoredStill(look_id: 'look_02', location_id: 'location_01')`. Confirm white tee (look_02) appears in the SAME kitchen as Smoke B's cream-knit (look_01) output. Visual side-by-side: only wardrobe should differ.

Cost: 1 credit ≈ $0.04.

#### Smoke D — Forbidden term guard

Tamper a canon location field with `'olive skin'`. Confirm `assembleCanonicalBootstrapPrompt` throws before Higgsfield call. Zero credits.

Total post-impl smoke: ~$0.12. The PR's source of confidence is the pre-merge Smoke 0d validation (which already produced the canonical URLs we can use as Smoke A's reference).

### Task 16 — Final code review + PR

Dispatch superpowers:code-reviewer for the full PR-C diff. Address Important issues. Push branch. Open new PR; PR description includes:
- All Smoke A/B/C/D candidate URLs from the post-impl validation.
- Reference to the pre-merge Smoke 0d validation (Stage A22 canonical, Stage B v3 wardrobe swap, studio2 canonical, studio Stage B wardrobe swap) as architectural proof.
- Bootstrap workflow next steps (the 4-anchored-still bootstrap is post-merge per spec).

---

## Open questions / assumptions needing Yaron's confirmation

1. **PR-A merge sequencing.** PR-C starts only after PR #35 merges. (Already confirmed earlier.)

2. **Per-location aesthetic reference URLs.** PR-C requires Yaron to provide a public URL per location for bootstrap (kitchen URL + studio URL already used in Smoke 0d — those work). For locations 03-08 in future tickets, Yaron will provide URLs at bootstrap time. Confirmed.

3. **Refresh policy on `updateLocationReference`.** When the canonical changes, existing stills generated against the OLD canonical stay in DB (audit via `reference_image_url_used`). Plan keeps them as historical. Recommend: no auto-retire (preserves history, manual cleanup). Confirm.

4. **The wardrobe-rotation skill's `flows/generate-still.ts`** is deleted. All render-time still generation now goes through `location/flows/generate-anchored-still.ts`. The wardrobe-rotation skill loses its "on-demand still" surface. Confirm OK — this is the cleanest split (looks own styling, locations own scene + anchoring).

5. **Looks 03-11 + locations 03-08 briefs** still TODO. Out of scope for PR-C. Confirm those land as separate tickets.

6. **Identity stress test post-merge.** PR-C's Smoke 0d validated identity across 1 wardrobe swap per location (cream → white tee). At scale (10+ wardrobes against same canonical), identity may drift slightly with each generation if nano_banana_pro pulls features from each new generation's small artifacts. Recommend a post-merge stress test (~$0.20) to characterize drift before relying on the system for production volume. Confirm.

---

## Out of scope

- Locations 03-08 canon briefs (separate session with Yaron).
- Looks 03-11 canon briefs (separate session — same status as after PR-A).
- PR-B v5 renderer integration (builds on PR-A + PR-C).
- Pipeline UI surface for locations + references.
- Auto-detect when a location reference needs refreshing.
- Multi-angle stills per (look, location) combo — for now, one canonical angle per location.
- Quality scoring for anchored-still auto-approve (arrival order; same as PR-A).

---

## Acceptance criteria

- [ ] Smoke 0 outcome documented (architectural risk de-risked or escalated).
- [ ] Migration drops + rebuilds `rachel_locations` and `rachel_stills` with the new 8-field shape + reference_image_url + reference_image_url_used.
- [ ] Canon definitions for location_01 (kitchen) and location_02 (studio) with all 8 structured fields populated.
- [ ] New `location` skill with 6 flows, SKILL.md documents each trigger.
- [ ] `bootstrapLocation`, `generateAnchoredStill`, `getLocationReference`, `updateLocationReference`, `approveLocation`, `retireLocation` all operational.
- [ ] Higgsfield `soul_2` `medias[].role: 'image'` literal confirmed via models_explore and documented in `anchored-still-prompt.ts` JSDoc.
- [ ] Smoke A, B, C, D pass with all sample images posted in PR for Yaron review.
- [ ] PR description includes side-by-side comparison: same kitchen in look_01 vs look_02 to prove location lock.
- [ ] Total smoke cost reported within ±10% of $0.40 (or $0.44 if Smoke 0 runs).
- [ ] `claude.md` updated to document the two-skill architecture (wardrobe rotation + location anchoring).
- [ ] Post-merge bootstrap workflow documented as next-steps in PR description (mint kitchen + studio references + 4 anchored stills).
