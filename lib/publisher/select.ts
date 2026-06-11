/**
 * SELECTION (skill §2) — find the work that is due.
 *
 * A row is due when:
 *   content_queue.status = 'approved'          (the human-approval gate)
 *   AND content_queue.render_status = 'complete'
 *   AND scheduled_posts.status IN ('pending','scheduled')
 *   AND (scheduled_posts.scheduled_for IS NULL OR scheduled_for <= now)
 *
 * `groupDueRows` (pure, tested) folds the flat join into one DuePiece per
 * content_id. `selectDuePieces` runs the live query and groups it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel, ContentPillar, RenderProfileSlug } from '../lifecycle/types.js';
import type { DuePiece, DueRowRaw } from './types.js';

export function groupDueRows(rows: DueRowRaw[]): DuePiece[] {
  const byPiece = new Map<string, DuePiece>();
  for (const r of rows) {
    let piece = byPiece.get(r.content_id);
    if (!piece) {
      piece = {
        contentId: r.content_id,
        status: r.cq_status,
        renderStatus: r.render_status,
        renderProfileSlug: (r.render_profile_slug as RenderProfileSlug | null) ?? null,
        pillar: r.content_pillar as ContentPillar,
        finalAssetUrl: r.final_asset_url,
        thumbnailAssetUrl: r.thumbnail_asset_url,
        coverAssetUrl: r.cover_asset_url,
        caption: r.cq_caption,
        metadata: r.metadata ?? {},
        channels: [],
      };
      byPiece.set(r.content_id, piece);
    }
    piece.channels.push({
      channel: r.sp_channel,
      status: r.sp_status,
      caption: r.sp_caption,
      scheduledFor: r.sp_scheduled_for,
      externalPostId: r.sp_external_post_id,
    });
  }
  return [...byPiece.values()];
}

interface EmbeddedRow {
  content_id: string;
  status: DueRowRaw['sp_status'];
  caption: string | null;
  scheduled_for: string | null;
  channel: Channel;
  external_post_id: string | null;
  content_queue: {
    status: string;
    render_status: string;
    content_pillar: string;
    final_asset_url: string | null;
    thumbnail_asset_url: string | null;
    cover_asset_url: string | null;
    caption: string | null;
    metadata: Record<string, unknown> | null;
    render_profiles: { slug: string | null } | null;
  } | null;
}

function toRaw(row: EmbeddedRow): DueRowRaw {
  const cq = row.content_queue;
  return {
    content_id: row.content_id,
    cq_status: cq?.status ?? '',
    render_status: cq?.render_status ?? '',
    render_profile_slug: cq?.render_profiles?.slug ?? null,
    content_pillar: cq?.content_pillar ?? 'uncategorized',
    final_asset_url: cq?.final_asset_url ?? null,
    thumbnail_asset_url: cq?.thumbnail_asset_url ?? null,
    cover_asset_url: cq?.cover_asset_url ?? null,
    cq_caption: cq?.caption ?? null,
    metadata: cq?.metadata ?? null,
    sp_channel: row.channel,
    sp_status: row.status,
    sp_caption: row.caption,
    sp_scheduled_for: row.scheduled_for,
    sp_external_post_id: row.external_post_id,
  };
}

export async function selectDuePieces(sb: SupabaseClient, now: Date): Promise<DuePiece[]> {
  const nowIso = now.toISOString();
  const { data, error } = await sb
    .from('scheduled_posts')
    .select(
      'content_id, status, caption, scheduled_for, channel, external_post_id, ' +
        'content_queue!inner ( status, render_status, content_pillar, final_asset_url, thumbnail_asset_url, cover_asset_url, caption, metadata, ' +
        'render_profiles ( slug ) )',
    )
    .eq('content_queue.status', 'approved')
    .eq('content_queue.render_status', 'complete')
    .in('status', ['pending', 'scheduled'])
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`);
  if (error) throw new Error(`[publisher/select] ${error.message}`);
  return groupDueRows((data as unknown as EmbeddedRow[]).map(toRaw));
}
