/**
 * Dependent-write post-checks.
 *
 * Every persistent write the pipeline depends on must have a post-check
 * stage. Schema-shaped gates (Skills contracts, NOT NULL constraints) are
 * NOT sufficient — they verify input shape, not whether the database
 * accepted the row.
 *
 * See `docs/architecture.md` → "Dependent-write post-checks" for the
 * general pattern. This module hosts the table-specific validators that
 * the orchestrator calls between stages.
 */

/**
 * Assert that every `content_queue` row produced during the run window
 * has matching `scheduled_posts` rows for every channel in `channels`.
 *
 * Run #667 (2026-05-17) demonstrated the failure mode this guards
 * against: contentgen reported success and `contentgen_post_check`
 * passed, but a legacy unique index swallowed every `scheduled_posts`
 * insert. The orchestrator marked the run `completed`; reality was zero
 * shippable pieces. This validator is the symmetric check that closes
 * the gap.
 *
 * Pure: no escalation, no throwing on violations. Returns a structured
 * verdict and lets the caller decide. (Query errors DO throw — not
 * verified is not the same as passed.)
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase
 * @param {string} args.runStartIso  ISO timestamp marking the run-window start
 * @param {readonly string[]} args.channels  Channels every piece is expected to target
 * @returns {Promise<{
 *   status: 'completed' | 'failed' | 'skipped',
 *   contentRows: number,
 *   scheduledRows: number,
 *   expectedScheduledRows: number,
 *   violations: Array<{ content_id: string, expected_channels: string[], actual_channels: string[], missing: string[] }>,
 *   reason?: string,
 * }>}
 */
export async function validateScheduledPostsCoverage({ supabase, runStartIso, channels }) {
  const expected = [...channels];

  const { data: contentRows, error: contentErr } = await supabase
    .from('content_queue')
    .select('id')
    .gte('created_at', runStartIso);

  if (contentErr) {
    throw new Error(`scheduled_posts_post_check: failed to query content_queue: ${contentErr.message}`);
  }

  const contentList = contentRows || [];
  if (contentList.length === 0) {
    return {
      status: 'skipped',
      contentRows: 0,
      scheduledRows: 0,
      expectedScheduledRows: 0,
      violations: [],
      reason: 'no_content_created_this_run',
    };
  }

  const ids = contentList.map((r) => r.id);
  const { data: scheduledRows, error: schedErr } = await supabase
    .from('scheduled_posts')
    .select('content_id, channel')
    .in('content_id', ids);

  if (schedErr) {
    throw new Error(`scheduled_posts_post_check: failed to query scheduled_posts: ${schedErr.message}`);
  }

  const scheduledList = scheduledRows || [];
  const channelsByContent = new Map();
  for (const row of scheduledList) {
    if (!channelsByContent.has(row.content_id)) {
      channelsByContent.set(row.content_id, new Set());
    }
    channelsByContent.get(row.content_id).add(row.channel);
  }

  const violations = [];
  for (const c of contentList) {
    const actual = channelsByContent.get(c.id) || new Set();
    const missing = expected.filter((ch) => !actual.has(ch));
    if (missing.length > 0) {
      violations.push({
        content_id: c.id,
        expected_channels: expected,
        actual_channels: [...actual],
        missing,
      });
    }
  }

  return {
    status: violations.length === 0 ? 'completed' : 'failed',
    contentRows: contentList.length,
    scheduledRows: scheduledList.length,
    expectedScheduledRows: contentList.length * expected.length,
    violations,
  };
}
