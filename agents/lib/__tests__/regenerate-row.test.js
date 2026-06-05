/**
 * Tests for the pure regenerate helpers (YAR-142).
 *
 * buildSyntheticBriefing reconstructs a briefing-shaped object from a
 * content_queue row so the existing generateBatch/resolveSourceUrls
 * pipeline can run against ONE row. supersedeOriginalPatch and
 * regeneratedFromMetadata implement the metadata-versioned supersession
 * convention (no supersedes_id column — everything lives in metadata),
 * cribbed from scripts/regenerate-stale-drafts.js. Both MUST merge prior
 * metadata, never clobber it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSyntheticBriefing,
  supersedeOriginalPatch,
  regeneratedFromMetadata,
} from '../regenerate-row.js';

function sampleRow(overrides = {}) {
  return {
    id: 'row-1',
    briefing_id: 'briefing-9',
    content_pillar: 'ai_magic',
    age_range: 'toddler',
    hook: 'The secret mom hack',
    caption: 'A caption long enough to pass gates',
    source_urls: [
      { url: 'https://example.com/a', signal_id: 'sig-1', relation: 'primary_inspiration', source: 'reddit' },
    ],
    metadata: { foo: 'bar', image_axes: { shot_type: 'macro' } },
    ...overrides,
  };
}

test('buildSyntheticBriefing carries briefing id + single opportunity', () => {
  const briefing = buildSyntheticBriefing(sampleRow());
  assert.equal(briefing.id, 'briefing-9');
  assert.ok(Array.isArray(briefing.opportunities));
  assert.equal(briefing.opportunities.length, 1);
});

test('synthetic opportunity carries row pillar/age + source context', () => {
  const briefing = buildSyntheticBriefing(sampleRow());
  const opp = briefing.opportunities[0];
  // resolveSourceUrls reads signal_id + source_url + source on the opp.
  assert.equal(opp.signal_id, 'sig-1');
  assert.equal(opp.source_url, 'https://example.com/a');
  assert.equal(opp.source, 'reddit');
  // generateBatch JSON-stringifies opps into the prompt — carry pillar/age.
  assert.equal(opp.content_pillar, 'ai_magic');
  assert.equal(opp.age_range, 'toddler');
});

test('synthetic opportunity has a stable signal_id even when source_urls empty', () => {
  const briefing = buildSyntheticBriefing(sampleRow({ source_urls: [] }));
  const opp = briefing.opportunities[0];
  assert.ok(typeof opp.signal_id === 'string' && opp.signal_id.length > 0);
});

test('buildSyntheticBriefing override replaces the reconstructed opportunity', () => {
  const override = { signal_id: 'override-sig', source_url: 'https://x.com/y', source: 'twitter', title: 'Override' };
  const briefing = buildSyntheticBriefing(sampleRow(), override);
  assert.equal(briefing.id, 'briefing-9');
  assert.equal(briefing.opportunities.length, 1);
  assert.deepEqual(briefing.opportunities[0], override);
});

test('supersedeOriginalPatch merges prior metadata, sets status + superseded_by', () => {
  const patch = supersedeOriginalPatch({ foo: 'bar', keep: 1 }, 'new-id');
  assert.equal(patch.status, 'superseded');
  assert.equal(patch.metadata.superseded_by, 'new-id');
  // existing keys preserved
  assert.equal(patch.metadata.foo, 'bar');
  assert.equal(patch.metadata.keep, 1);
});

test('supersedeOriginalPatch tolerates null prior metadata', () => {
  const patch = supersedeOriginalPatch(null, 'new-id');
  assert.equal(patch.status, 'superseded');
  assert.equal(patch.metadata.superseded_by, 'new-id');
});

test('regeneratedFromMetadata merges prior metadata + regenerated_from', () => {
  const meta = regeneratedFromMetadata({ image_axes: { shot_type: 'macro' } }, 'orig-id');
  assert.equal(meta.regenerated_from, 'orig-id');
  assert.deepEqual(meta.image_axes, { shot_type: 'macro' });
});

test('regeneratedFromMetadata tolerates null prior metadata', () => {
  const meta = regeneratedFromMetadata(null, 'orig-id');
  assert.equal(meta.regenerated_from, 'orig-id');
});
