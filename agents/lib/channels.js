/**
 * Channel resolution and per-channel state helpers.
 *
 * Per CHANNEL_MODEL_V1: a piece targets multiple channels (TikTok +
 * Instagram by default). Per-channel state (captions, schedule, status,
 * external post id) lives in the `scheduled_posts` table — never in
 * `content_queue`.
 *
 * The legacy `scheduled_at_ig`, `scheduled_at_tt`, `published_at_ig`,
 * `published_at_tt`, `published_url_ig`, `published_url_tt`, and
 * `channel_override` columns on `content_queue` are being dropped (see
 * `supabase/migrations/20260517170000_drop_legacy_columns.sql`). Do not
 * read or write any of them.
 */

export const CHANNEL = Object.freeze({
  TIKTOK:    'tiktok',
  INSTAGRAM: 'instagram',
});

export const ALL_CHANNELS = Object.freeze(Object.values(CHANNEL));

export const DEFAULT_CHANNELS = Object.freeze([CHANNEL.TIKTOK, CHANNEL.INSTAGRAM]);

export const SCHEDULED_POST_STATUS = Object.freeze({
  PENDING:   'pending',
  SCHEDULED: 'scheduled',
  POSTED:    'posted',
  FAILED:    'failed',
  SKIPPED:   'skipped',
});

const VALID_STATUSES = new Set(Object.values(SCHEDULED_POST_STATUS));

/**
 * Per-channel writing guidance used by the caption-per-channel LLM step.
 * Surfaced as a constant so the SKILL prompt template can reference it.
 */
export const CHANNEL_STYLE = Object.freeze({
  tiktok: Object.freeze({
    tone: 'short, hook-first, hashtag-dense; on-screen text is the real payload',
    target_chars: 100,
    max_chars: 150,
  }),
  instagram: Object.freeze({
    tone: 'longer prose, storytelling, hashtags buried at end or in first comment',
    target_chars: 400,
    max_chars: 2200,
  }),
});

export function isValidChannel(channel) {
  return typeof channel === 'string' && ALL_CHANNELS.includes(channel);
}

export function isValidScheduledPostStatus(status) {
  return typeof status === 'string' && VALID_STATUSES.has(status);
}

/**
 * Decide which channels a piece should target.
 * Default per CHANNEL_MODEL_V1 §1.3: every piece → tiktok + instagram.
 *
 * Per-render-profile or per-pillar overrides can be wired in here later;
 * the parameters are accepted (and ignored) today so callers don't need
 * to change when overrides land.
 *
 * @returns {readonly string[]}
 */
export function resolveTargetChannels(_renderProfile, _contentPillar) {
  return DEFAULT_CHANNELS;
}

/**
 * Build INSERT rows for `scheduled_posts`. One row per channel,
 * initially in `pending` status.
 *
 * @param {string} contentId
 * @param {string[]} channels
 * @param {Record<string,string>} captionsByChannel  Output of generateChannelCaptions
 */
export function buildScheduledPostsRows(contentId, channels, captionsByChannel = {}) {
  if (!contentId) {
    throw new Error('buildScheduledPostsRows: contentId required');
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('buildScheduledPostsRows: channels must be a non-empty array');
  }
  return channels.map((channel) => {
    if (!isValidChannel(channel)) {
      throw new Error(`buildScheduledPostsRows: invalid channel "${channel}"`);
    }
    return {
      content_id: contentId,
      channel,
      caption: typeof captionsByChannel[channel] === 'string' ? captionsByChannel[channel] : null,
      status: SCHEDULED_POST_STATUS.PENDING,
    };
  });
}

/**
 * Fetch all `scheduled_posts` rows for a content piece.
 */
export async function getScheduledPostsForContent(supabase, contentId) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(
      'id, content_id, channel, status, caption, scheduled_for, published_at, post_url, external_post_id, failure_reason, created_at, updated_at',
    )
    .eq('content_id', contentId);
  if (error) throw new Error(`getScheduledPostsForContent: ${error.message}`);
  return data || [];
}

/**
 * Update a (content_id, channel) `scheduled_posts` row. Extras can carry
 * any subset of `post_url`, `external_post_id`, `failure_reason`,
 * `scheduled_for`, `published_at`, `caption`.
 */
export async function updateScheduledPostStatus(supabase, contentId, channel, status, extras = {}) {
  if (!isValidChannel(channel)) {
    throw new Error(`updateScheduledPostStatus: invalid channel "${channel}"`);
  }
  if (!isValidScheduledPostStatus(status)) {
    throw new Error(`updateScheduledPostStatus: invalid status "${status}"`);
  }
  const { data, error } = await supabase
    .from('scheduled_posts')
    .update({ status, ...extras })
    .eq('content_id', contentId)
    .eq('channel', channel)
    .select()
    .maybeSingle();
  if (error) throw new Error(`updateScheduledPostStatus: ${error.message}`);
  return data;
}

/**
 * Caption-per-channel: produce one caption per channel by calling
 * `generateOne(content, channel)` once per channel. The model client is
 * injected so this module stays free of Anthropic SDK coupling.
 *
 * Per CHANNEL_MODEL_V1 Q5: 2 Haiku calls per piece by default.
 *
 * @param {{ hook: string, caption_base?: string, hashtags?: string[], render_profile_slug?: string, content_pillar?: string }} content
 * @param {string[]} channels
 * @param {(content: object, channel: string) => Promise<string>} generateOne
 * @returns {Promise<Record<string,string>>}
 */
export async function generateChannelCaptions(content, channels, generateOne) {
  if (typeof generateOne !== 'function') {
    throw new Error('generateChannelCaptions: generateOne function required');
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('generateChannelCaptions: channels must be a non-empty array');
  }
  const out = {};
  for (const channel of channels) {
    if (!isValidChannel(channel)) {
      throw new Error(`generateChannelCaptions: invalid channel "${channel}"`);
    }
    const caption = await generateOne(content, channel);
    if (typeof caption !== 'string' || caption.trim().length === 0) {
      throw new Error(`generateChannelCaptions: generateOne returned empty caption for channel "${channel}"`);
    }
    out[channel] = caption;
  }
  return out;
}
