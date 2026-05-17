/**
 * Tests for rejectLegacyFormatFields — the v2.0.0 / CHANNEL_MODEL_V1
 * fail-closed gate that catches any LLM regression to the v1.0.0 output
 * shape (post_format enum, inline scheduled_at_*, channel_override, etc.).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { rejectLegacyFormatFields, GATE_VALIDATOR_CONSTANTS } = await import('../gate_validators.js');

test('rejectLegacyFormatFields: clean v2.0.0 row passes', () => {
  const row = {
    signal_id: 'abc',
    content_pillar: 'parenting',
    render_profile_slug: 'avatar-v1',
    channels: ['tiktok', 'instagram'],
    hook: 'Hook',
    caption: 'Caption',
    hashtags: ['#x'],
  };
  const v = rejectLegacyFormatFields(row);
  assert.equal(v.ok, true);
});

test('rejectLegacyFormatFields: row with post_format is rejected', () => {
  const v = rejectLegacyFormatFields({
    render_profile_slug: 'static-image',
    post_format: 'ig_static', // legacy
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /legacy_format_fields_present/);
  assert.deepEqual(v.fields, ['post_format']);
});

test('rejectLegacyFormatFields: row with all 8 legacy fields lists them all', () => {
  const v = rejectLegacyFormatFields({
    post_format: 'ig_static',
    scheduled_at_ig: '2026-01-01T00:00:00Z',
    scheduled_at_tt: '2026-01-01T00:00:00Z',
    published_at_ig: null,
    published_at_tt: null,
    published_url_ig: null,
    published_url_tt: null,
    channel_override: 'ig_only',
  });
  assert.equal(v.ok, false);
  assert.deepEqual(
    [...v.fields].sort(),
    [
      'channel_override',
      'post_format',
      'published_at_ig',
      'published_at_tt',
      'published_url_ig',
      'published_url_tt',
      'scheduled_at_ig',
      'scheduled_at_tt',
    ],
  );
});

test('rejectLegacyFormatFields: even null-valued legacy fields are caught', () => {
  // The point is the SHAPE, not the value. A row that mentions post_format=null
  // is still a v1.0.0-shape row and indicates LLM regression.
  const v = rejectLegacyFormatFields({ post_format: null });
  assert.equal(v.ok, false);
  assert.deepEqual(v.fields, ['post_format']);
});

test('rejectLegacyFormatFields: null/undefined/non-object inputs pass', () => {
  assert.equal(rejectLegacyFormatFields(null).ok, true);
  assert.equal(rejectLegacyFormatFields(undefined).ok, true);
  assert.equal(rejectLegacyFormatFields('not an object').ok, true);
});

test('GATE_VALIDATOR_CONSTANTS exposes LEGACY_FORMAT_FIELDS', () => {
  assert.ok(Array.isArray(GATE_VALIDATOR_CONSTANTS.LEGACY_FORMAT_FIELDS));
  assert.equal(GATE_VALIDATOR_CONSTANTS.LEGACY_FORMAT_FIELDS.length, 8);
  assert.ok(GATE_VALIDATOR_CONSTANTS.LEGACY_FORMAT_FIELDS.includes('post_format'));
  assert.ok(GATE_VALIDATOR_CONSTANTS.LEGACY_FORMAT_FIELDS.includes('channel_override'));
});
