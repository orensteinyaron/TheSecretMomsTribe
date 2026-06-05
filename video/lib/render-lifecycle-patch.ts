/**
 * Render-lifecycle DB patch written by the v5 renderer's upload phase (YAR-145 L1).
 * Contains EXACTLY the three render-lifecycle columns — never render_profile_id,
 * metadata.video_url, or status (those flip only on human approval; DB-flip-on-approval).
 * render_status uses the 'complete' enum value; render_completed_at satisfies the
 * render_complete_minimum_contract CHECK (final_asset_url + render_completed_at both set).
 */
export type RenderLifecyclePatch = {
  render_status: "complete";
  final_asset_url: string;
  render_completed_at: string;
};

export function buildRenderLifecyclePatch(
  finalAssetUrl: string,
  completedAtIso: string,
): RenderLifecyclePatch {
  return {
    render_status: "complete",
    final_asset_url: finalAssetUrl,
    render_completed_at: completedAtIso,
  };
}
