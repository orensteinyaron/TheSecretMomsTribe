/**
 * Tests for the content.js CLI arg parser (YAR-142).
 *
 * The no-flag invocation MUST parse to batch defaults (every field
 * falsy) so the daily cron path stays byte-identical. Each flag is
 * parsed individually, and both `--k=v` and bare `--dry-run` forms work.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseContentArgs } from '../cli-args.js';

test('empty argv → batch defaults (no regenerate)', () => {
  assert.deepEqual(parseContentArgs([]), {
    contentId: null,
    briefingJson: null,
    forceProfile: null,
    dryRun: false,
  });
});

test('unknown argv → batch defaults (ignored, not thrown)', () => {
  assert.deepEqual(parseContentArgs(['--mode=daily', 'garbage', '-x']), {
    contentId: null,
    briefingJson: null,
    forceProfile: null,
    dryRun: false,
  });
});

test('--content-id=<uuid> parsed', () => {
  const args = parseContentArgs(['--content-id=abc-123']);
  assert.equal(args.contentId, 'abc-123');
  assert.equal(args.briefingJson, null);
  assert.equal(args.forceProfile, null);
  assert.equal(args.dryRun, false);
});

test('--briefing-json=<path> parsed', () => {
  const args = parseContentArgs(['--briefing-json=/tmp/brief.json']);
  assert.equal(args.briefingJson, '/tmp/brief.json');
});

test('--force-profile=<slug> parsed', () => {
  const args = parseContentArgs(['--force-profile=avatar-v1']);
  assert.equal(args.forceProfile, 'avatar-v1');
});

test('bare --dry-run sets dryRun true', () => {
  const args = parseContentArgs(['--dry-run']);
  assert.equal(args.dryRun, true);
});

test('all flags together', () => {
  const args = parseContentArgs([
    '--content-id=uuid-1',
    '--briefing-json=/tmp/b.json',
    '--force-profile=static-image',
    '--dry-run',
  ]);
  assert.deepEqual(args, {
    contentId: 'uuid-1',
    briefingJson: '/tmp/b.json',
    forceProfile: 'static-image',
    dryRun: true,
  });
});
