-- YAR-145 L1 backfill: rows whose final video lived only in metadata.video_url
-- (legacy pipeline) but never got render_status/final_asset_url set, so audits
-- read them as "never rendered". Mirror the URL into final_asset_url and close
-- the lifecycle. Guarded so the render_complete_minimum_contract CHECK holds
-- (final_asset_url + render_completed_at both non-null whenever status='complete').
UPDATE content_queue
SET final_asset_url    = metadata->>'video_url',
    render_completed_at = COALESCE(render_completed_at, updated_at),
    render_status       = 'complete'
WHERE metadata->>'video_url' IS NOT NULL
  AND final_asset_url IS NULL;
