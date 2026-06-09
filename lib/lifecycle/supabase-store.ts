/**
 * Supabase-backed LifecycleStore (the real DB path).
 *
 * Matches the house pattern (video/lib/.../db.ts): a lazily-initialized
 * service-role client so importing this module never calls process.exit and
 * env vars are validated on first use (thrown, recoverable). All errors surface
 * as thrown exceptions — no error-tuple returns.
 *
 * Atomicity of enqueue is delegated to the Postgres function
 * `lifecycle_enqueue_piece` (a single transaction) — see
 * supabase/migrations for its definition. The conditional close methods
 * (tryMarkPosted / trySetStatus) are single guarded UPDATEs, atomic per
 * statement, so idempotency holds even under concurrent writers.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LifecycleStore } from './store.js';
import type {
  Channel,
  NormalizedEnqueueInput,
  ScheduledPostRow,
  ScheduledPostStatus,
} from './types.js';

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[lifecycle/supabase-store] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

const SCHEDULED_POST_COLUMNS =
  'id, content_id, channel, status, caption, scheduled_for, published_at, ' +
  'post_url, external_post_id, failure_reason, created_at, updated_at';

export class SupabaseLifecycleStore implements LifecycleStore {
  private readonly sb: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.sb = client ?? getSupabase();
  }

  async enqueue(input: NormalizedEnqueueInput): Promise<string> {
    const { data, error } = await this.sb.rpc('lifecycle_enqueue_piece', {
      p_render_profile_slug: input.renderProfileSlug,
      p_pillar: input.pillar,
      p_hook: input.hook,
      p_caption: input.baseCaption,
      p_final_asset_url: input.finalAssetUrl,
      p_render_completed_at: input.renderCompletedAt,
      p_status: input.status,
      p_metadata: input.metadata,
      p_channels: input.channels.map((c) => ({
        channel: c.channel,
        caption: c.caption,
        scheduled_for: c.scheduledFor,
      })),
    });
    if (error) throw new Error(`[lifecycle/supabase.enqueue] ${error.message}`);
    if (typeof data !== 'string') {
      throw new Error('[lifecycle/supabase.enqueue] RPC did not return a content_id');
    }
    return data;
  }

  async listScheduledPosts(contentId: string): Promise<ScheduledPostRow[]> {
    const { data, error } = await this.sb
      .from('scheduled_posts')
      .select(SCHEDULED_POST_COLUMNS)
      .eq('content_id', contentId)
      .order('channel', { ascending: true });
    if (error) throw new Error(`[lifecycle/supabase.listScheduledPosts] ${error.message}`);
    return (data ?? []) as ScheduledPostRow[];
  }

  async getScheduledPost(
    contentId: string,
    channel: Channel,
  ): Promise<ScheduledPostRow | null> {
    const { data, error } = await this.sb
      .from('scheduled_posts')
      .select(SCHEDULED_POST_COLUMNS)
      .eq('content_id', contentId)
      .eq('channel', channel)
      .maybeSingle();
    if (error) throw new Error(`[lifecycle/supabase.getScheduledPost] ${error.message}`);
    return (data as ScheduledPostRow | null) ?? null;
  }

  async tryMarkPosted(
    contentId: string,
    channel: Channel,
    postUrl: string,
    externalPostId: string,
  ): Promise<ScheduledPostRow | null> {
    const { data, error } = await this.sb
      .from('scheduled_posts')
      .update({
        status: 'posted',
        post_url: postUrl,
        external_post_id: externalPostId,
        published_at: new Date().toISOString(),
      })
      .eq('content_id', contentId)
      .eq('channel', channel)
      .is('external_post_id', null) // guard: only the first writer wins
      .select(SCHEDULED_POST_COLUMNS);
    if (error) throw new Error(`[lifecycle/supabase.tryMarkPosted] ${error.message}`);
    const rows = (data ?? []) as ScheduledPostRow[];
    return rows.length === 1 ? rows[0] : null;
  }

  async trySetStatus(
    contentId: string,
    channel: Channel,
    status: ScheduledPostStatus,
    failureReason: string,
  ): Promise<ScheduledPostRow | null> {
    const { data, error } = await this.sb
      .from('scheduled_posts')
      .update({ status, failure_reason: failureReason })
      .eq('content_id', contentId)
      .eq('channel', channel)
      .neq('status', 'posted') // guard: posted is terminal
      .select(SCHEDULED_POST_COLUMNS);
    if (error) throw new Error(`[lifecycle/supabase.trySetStatus] ${error.message}`);
    const rows = (data ?? []) as ScheduledPostRow[];
    return rows.length === 1 ? rows[0] : null;
  }
}
