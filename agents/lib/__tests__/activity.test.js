/**
 * Tests for activity.js logging — ensures insert failures never throw.
 * Uses an in-memory mock client via module interception isn't feasible in
 * node:test without extra deps, so we exercise the shape via direct import
 * and observe it doesn't throw when the client is misconfigured.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Stub env so the supabase import doesn't process.exit.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { logActivity } = await import('../activity.js');

test('logActivity never throws even if Supabase is unreachable', async () => {
  // Hitting localhost with a bogus URL should fail silently thanks to the
  // try/catch in logActivity. The test passes as long as this resolves.
  await assert.doesNotReject(() =>
    logActivity({
      category: 'system',
      actor_type: 'system',
      actor_name: 'test-harness',
      action: 'unit_test',
      description: 'never-thrown',
    }),
  );
});
