-- V2 §4.4: render_complete_minimum_contract CHECK + zombie cleanup.
--
-- Closes the loophole that hid the data-flow gap behind the audit for weeks:
-- nothing prevented an out-of-band UPDATE setting render_status='complete' on
-- a row with neither a final_asset_url nor a render_completed_at. The piece-
-- page UI showed "complete" but had no asset to render and no Duration cell
-- to compute, leaving Yaron staring at a broken-image icon for legacy rows
-- that had never gone through any renderer.
--
-- Constraint shape rationale: minimum semantic contract for "complete" is a
-- final asset exists and we know when. Both writers (legacy orchestrator path
-- via setComplete, new content-lifecycle persist mode) populate these two.
-- The other render_* fields (render_started_at, render_profile_id,
-- render_cost_usd) are populated separately by V2 §4.2's content-lifecycle.ts
-- patch — they're metadata that should be set, not gating conditions for the
-- completeness contract.
--
-- Zombie cleanup: three pieces were caught with render_status='complete' but
-- zero content_assets, no render_profile_id, no timestamps:
--   0c48679f-062f-4c87-adf4-afb3dd7b03c7 ("The sunscreen pediatricians actually
--      recommend? It's $8 at Target.") — unique hook, zombie status only;
--      reset to pending.
--   52955325-80fa-464a-867a-1ce2ac608d9b ("If your friend has it all together,
--      she is the one you need to check on first.") — duplicate-hook pair half.
--      Already status=rejected; add rejection_reason and reset render_status.
--   d84c27e9-5a79-44d0-9b36-8ebd034bb492 ("If your friend has it all together,
--      she's the one you need to check on first.") — duplicate-hook pair other
--      half (only the contraction differs). Flip approved→rejected with the
--      same reason and reset render_status.
--
-- 3bcafc78 (the audit reference piece) DOES satisfy the constraint after this
-- migration: content-lifecycle persist set both final_asset_url (Drive
-- webViewLink) and render_completed_at on 2026-05-09 12:33:06.
--
-- Spec: docs/specs/PIECE_PAGE_DATA_FLOW_AUDIT_V2.md §4.4

-- 1. Add constraint as NOT VALID so the existing zombie rows don't block creation.
ALTER TABLE content_queue
  ADD CONSTRAINT render_complete_minimum_contract
  CHECK (
    render_status != 'complete'
    OR (final_asset_url IS NOT NULL AND render_completed_at IS NOT NULL)
  ) NOT VALID;

-- 2. Cleanup: 0c48679f (unique zombie, reset to pending) + 52955325 + d84c27e9
--    (duplicate-hook pair, both rejected with rejection_reason).
UPDATE content_queue
SET render_status = 'pending',
    render_completed_at = NULL
WHERE id = '0c48679f-062f-4c87-adf4-afb3dd7b03c7';

UPDATE content_queue
SET status = 'rejected',
    rejection_reason = 'duplicate_hook',
    render_status = 'pending',
    render_completed_at = NULL
WHERE id IN (
  '52955325-80fa-464a-867a-1ce2ac608d9b',
  'd84c27e9-5a79-44d0-9b36-8ebd034bb492'
);

-- 3. Validate the constraint now that all rows satisfy it.
ALTER TABLE content_queue VALIDATE CONSTRAINT render_complete_minimum_contract;
