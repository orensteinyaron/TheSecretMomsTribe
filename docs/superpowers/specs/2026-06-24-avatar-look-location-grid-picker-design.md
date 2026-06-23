# Avatar look + location grid picker — design

- **Date:** 2026-06-24
- **Status:** Proposed (awaiting human review)
- **Scope:** `skills/create-from-url/SKILL.md` §4 Gate B (human-in-the-loop avatar path). Cross-references `avatar-full-wardrobe-rotation` and `location` skills.

## Problem

`create-from-url` §4 Gate B currently requires the agent to present the look × location combo "in plain words" for approval. In practice the combo is opaque to the user (an ID like `look_04` means nothing without seeing it), and there is no first-class way to **pick visually** or to **add a new** look/location inline. The agent ends up auto-picking and the human rubber-stamps text. We want the human to *see and choose*.

## Goals

- The user selects the **look** from an inline visual grid of thumbnails, each labeled with its ID; or creates a brand-new look that persists for future use.
- After the look, the user selects the **location** from an inline grid of all locations, each labeled with its ID; or creates a new location that persists.
- Any picked look × location combo is renderable, even one never rendered before.

## Non-goals

- Changing the autonomous orchestrator pipeline. It has no human to show a grid to and keeps its existing `pickCombination` (cooldown-aware LRU).
- Changing Gate A (the verbatim-script approval) or any render/QA/enqueue stage.
- Replacing the underlying look/location data model or the bootstrap flows — we reuse them.

## Current state (data model)

- `rachel_looks` — `look_id`, wardrobe, hair, status. 4 active (look_01–04). No image column; a representative thumbnail = the most recent `rachel_stills.soul_still_url` for that look.
- `rachel_locations` — `location_id`, name, tier, `reference_image_url` (the canonical Rachel-in-location image). 2 active (kitchen, home_studio).
- `rachel_stills` — one row per **(look, location)** combo that has been materialized; `soul_still_url` is the Soul-locked start image the renderer pins. **Coverage is sparse** — e.g. look_04 × kitchen has no still today.
- Bootstrap flows already exist and persist: new look → `avatar-full-wardrobe-rotation` bootstrap; new location → `location` skill `bootstrapLocation`; missing combo still → `location` skill `generateAnchoredStill` (nano_banana_pro + Soul pass-through).

## Design

Gate B becomes a **two-step visual picker**, look first then location, each step a clickable grid.

### Step 1 — Look picker

1. Query active `rachel_looks` + a representative thumbnail per look (latest `rachel_stills.soul_still_url`).
2. Render an inline grid via `show_widget` (mcp__visualize). Each **card**:
   - thumbnail image,
   - the **ID** (`look_01`) shown as a visible label,
   - the wardrobe + hair description,
   - a recency hint if the look was used within the rotation cooldown window (the wardrobe-rotation `cooldown=3` last-pieces window, so the hint matches the autonomous picker).
   - clickable: `onclick → sendPrompt("pick look_03")`.
3. A trailing **"➕ New look"** card → `sendPrompt("create a new look")` → hands off to the `avatar-full-wardrobe-rotation` bootstrap (generates candidates → human approves → saved as a new `look_NN`, then re-enter Step 1 with it pre-selected).
4. The user clicks a card or types an ID. Result: a chosen `look_id`.

### Step 2 — Location picker

Identical pattern, shown **after** the look is chosen:

1. Query active `rachel_locations` (all of them; independent of the chosen look).
2. Grid of cards: `reference_image_url` thumbnail + **ID** (`location_01`) + name + clickable `sendPrompt("pick location_01")`. Note: these thumbnails are the generic Rachel-in-location canonicals (not re-rendered for the chosen look) — the look-specific composite is only produced at Step 3.
3. Trailing **"➕ New location"** card → `sendPrompt("create a new location")` → `location` skill `bootstrapLocation` → saved as new `location_NN`, then re-enter Step 2 with it pre-selected.
4. Result: a chosen `location_id`.

### Step 3 — Combo resolution

After both are chosen:

- If a `rachel_stills` row exists for (look, location) with a `soul_still_url` → pin its `still_id`. Done.
- If **not** → auto-run `generateAnchoredStill(look_id, location_id)` (nano_banana_pro composition anchored to the location canonical, then Soul-2.0 pass-through for identity-lock). Insert the result into `rachel_stills` so the combo is reusable. Surface the generated still inline. Then pin the new `still_id`.
- The resolved `still_id` (+ `look_id`, `location_id`) is exactly what §5 pins into `avatar_config`; §5 still must NOT re-pick.

### The grid widget (documented template)

A single `show_widget` HTML template, baked into the skill so every run looks the same:

- responsive CSS grid of cards (≈3 across), each a thumbnail with an ID badge overlay and a one-line label;
- a visually distinct trailing "➕ New …" card;
- each card `onclick="sendPrompt('pick <id>')"` (and the new card `sendPrompt('create a new <look|location>')`);
- brand styling pulled from canon (purple accent), never asked.

The widget is **selection-only** — it never writes to the DB. All DB effects happen in the agent turn that handles the resulting `sendPrompt`.

## Flow

```
Gate A (script, all scenes) approved
        │
        ▼
Step 1: render LOOK grid ──click/type──▶ look_id
        │  └─ "New look" ─▶ wardrobe bootstrap ─▶ look_NN (re-enter Step 1)
        ▼
Step 2: render LOCATION grid ──click/type──▶ location_id
        │  └─ "New location" ─▶ bootstrapLocation ─▶ location_NN (re-enter Step 2)
        ▼
Step 3: still exists? ── yes ─▶ pin still_id
        └─ no ─▶ generateAnchoredStill ─▶ insert rachel_stills ─▶ pin still_id
        ▼
§5 RENDER (avatar_config pins the resolved look/location/still; no re-pick)
```

## Error handling

- **User picks nothing / closes the widget:** no DB effect; agent re-prompts. Nothing downstream runs (Gate B not satisfied).
- **Bootstrap (new look/location) aborted by human:** stay in the picker; no partial rows beyond what the bootstrap flow itself commits on approval.
- **`generateAnchoredStill` fails:** surface the error; do not fall back to a different combo silently (that would violate the user's explicit pick). Offer retry or a different pick.
- **Higgsfield/Gemini unavailable:** same surface-and-stop; the picker is read-only so the selection state is preserved.

## Files touched

- `skills/create-from-url/SKILL.md` — rewrite §4 Gate B as the two-step picker; add the grid-widget template subsection; tighten §3 (look/location resolved for display, not via renderer) and §5 (pin the picked combo, generate the still if missing). Cross-reference the two bootstrap skills.
- No code changes required to the renderer: `generateAnchoredStill`, `bootstrapLocation`, and the wardrobe bootstrap already exist as session flows.

## Verification

- GREEN subagent test (as used for the §4 two-gate edit): give a fresh agent the updated skill + a create-from-url scenario; confirm it (a) renders a look grid and waits, (b) renders a location grid after the look, (c) offers "new" on both, (d) generates a still when the combo is missing, all **before** any `--phase=init` / credit-spending call.

## Open questions

None blocking. Card column count and exact badge styling are cosmetic and will be finalized in the widget template.
