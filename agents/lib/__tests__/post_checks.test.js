/**
 * Tests for validateScheduledPostsCoverage — the symmetric post-check
 * that asserts every content_queue row produced during a pipeline run
 * has matching scheduled_posts rows for every channel in DEFAULT_CHANNELS.
 *
 * YAR-128. Run #667 looked clean but produced zero shippable pieces
 * because scheduled_posts inserts silently failed; this check closes that
 * gap symmetrically with contentgen_post_check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { validateScheduledPostsCoverage } = await import('../post_checks.js');

const RUN_START = '2026-05-17T00:00:00.000Z';

/**
 * Build a fake supabase client wired for two sequential reads:
 *   1. content_queue.select('id').gte('created_at', runStartIso)
 *   2. scheduled_posts.select('content_id, channel').in('content_id', [...])
 *
 * Each table response can be `{ data }` or `{ error }`. The fake records
 * the `.in` value so tests can assert the validator scoped its lookup
 * to the right content IDs.
 */
function fakeSupabase({ contentResponse, scheduledResponse }) {
  const calls = { tables: [], inValue: null };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      const builder = {
        select() { return builder; },
        gte() { return builder; },
        in(_col, val) { calls.inValue = val; return builder; },
        then(resolve) {
          if (table === 'content_queue') return resolve(contentResponse);
          if (table === 'scheduled_posts') return resolve(scheduledResponse);
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

test('happy path: 5 content rows, 2 scheduled per row → status=completed, 0 violations', async () => {
  const contentRows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}` }));
  const scheduledRows = contentRows.flatMap((c) => [
    { content_id: c.id, channel: 'tiktok' },
    { content_id: c.id, channel: 'instagram' },
  ]);
  const supabase = fakeSupabase({
    contentResponse: { data: contentRows, error: null },
    scheduledResponse: { data: scheduledRows, error: null },
  });

  const result = await validateScheduledPostsCoverage({
    supabase,
    runStartIso: RUN_START,
    channels: ['tiktok', 'instagram'],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.contentRows, 5);
  assert.equal(result.scheduledRows, 10);
  assert.equal(result.expectedScheduledRows, 10);
  assert.deepEqual(result.violations, []);
  // Validator scoped the scheduled_posts query to exactly the content IDs from the window.
  assert.deepEqual([...supabase.calls.inValue].sort(), ['c1', 'c2', 'c3', 'c4', 'c5']);
});

test('single missing channel: 5 content rows, one missing instagram → status=failed, 1 violation', async () => {
  const contentRows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}` }));
  const scheduledRows = contentRows.flatMap((c) => {
    if (c.id === 'c3') return [{ content_id: c.id, channel: 'tiktok' }];
    return [
      { content_id: c.id, channel: 'tiktok' },
      { content_id: c.id, channel: 'instagram' },
    ];
  });
  const supabase = fakeSupabase({
    contentResponse: { data: contentRows, error: null },
    scheduledResponse: { data: scheduledRows, error: null },
  });

  const result = await validateScheduledPostsCoverage({
    supabase,
    runStartIso: RUN_START,
    channels: ['tiktok', 'instagram'],
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.contentRows, 5);
  assert.equal(result.scheduledRows, 9);
  assert.equal(result.expectedScheduledRows, 10);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].content_id, 'c3');
  assert.deepEqual(result.violations[0].expected_channels, ['tiktok', 'instagram']);
  assert.deepEqual(result.violations[0].actual_channels, ['tiktok']);
  assert.deepEqual(result.violations[0].missing, ['instagram']);
});

test('Run #667 scenario: 5 content rows, 0 scheduled_posts → status=failed, 5 violations', async () => {
  const contentRows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}` }));
  const supabase = fakeSupabase({
    contentResponse: { data: contentRows, error: null },
    scheduledResponse: { data: [], error: null },
  });

  const result = await validateScheduledPostsCoverage({
    supabase,
    runStartIso: RUN_START,
    channels: ['tiktok', 'instagram'],
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.contentRows, 5);
  assert.equal(result.scheduledRows, 0);
  assert.equal(result.expectedScheduledRows, 10);
  assert.equal(result.violations.length, 5);
  for (const v of result.violations) {
    assert.deepEqual(v.actual_channels, []);
    assert.deepEqual(v.missing.sort(), ['instagram', 'tiktok']);
  }
});

test('no content created this run: 0 content rows → status=skipped, no scheduled_posts query', async () => {
  const supabase = fakeSupabase({
    contentResponse: { data: [], error: null },
    scheduledResponse: { data: [], error: null },
  });

  const result = await validateScheduledPostsCoverage({
    supabase,
    runStartIso: RUN_START,
    channels: ['tiktok', 'instagram'],
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.contentRows, 0);
  assert.equal(result.reason, 'no_content_created_this_run');
  assert.deepEqual(result.violations, []);
  // No need to hit scheduled_posts if there's nothing to check against.
  assert.deepEqual(supabase.calls.tables, ['content_queue']);
});

test('query failure on content_queue: validator throws (not verified ≠ passed)', async () => {
  const supabase = fakeSupabase({
    contentResponse: { data: null, error: { message: 'connection refused' } },
    scheduledResponse: { data: [], error: null },
  });

  await assert.rejects(
    () => validateScheduledPostsCoverage({
      supabase,
      runStartIso: RUN_START,
      channels: ['tiktok', 'instagram'],
    }),
    /content_queue.*connection refused/,
  );
});

test('query failure on scheduled_posts: validator throws', async () => {
  const contentRows = [{ id: 'c1' }];
  const supabase = fakeSupabase({
    contentResponse: { data: contentRows, error: null },
    scheduledResponse: { data: null, error: { message: 'timeout' } },
  });

  await assert.rejects(
    () => validateScheduledPostsCoverage({
      supabase,
      runStartIso: RUN_START,
      channels: ['tiktok', 'instagram'],
    }),
    /scheduled_posts.*timeout/,
  );
});
