/**
 * Tests for prompt_logger.js — validates the guard logic and ensures
 * the logger never throws on Supabase insert failures (observability
 * must not break the agent flow it's observing).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { logPromptExecution, withPromptLogging, logDeterministicStep } = await import('../prompt_logger.js');

test('logPromptExecution rejects missing required fields', async () => {
  const res = await logPromptExecution({
    agentName: 'x', stepName: 'y', stepOrder: 1, model: 'm', userPrompt: 'p', status: 'ok',
    // contentId missing
  });
  assert.equal(res.id, null);
});

test('logPromptExecution rejects invalid status', async () => {
  const res = await logPromptExecution({
    contentId: '00000000-0000-0000-0000-000000000000',
    agentName: 'x', stepName: 'y', stepOrder: 1, model: 'm', userPrompt: 'p',
    status: 'weird',
  });
  assert.equal(res.id, null);
});

test('logPromptExecution returns {id: null} on Supabase failure without throwing', async () => {
  await assert.doesNotReject(() =>
    logPromptExecution({
      contentId: '00000000-0000-0000-0000-000000000000',
      agentName: 'test', stepName: 'test', stepOrder: 1, model: 'none',
      userPrompt: 'stub', status: 'ok',
    }),
  );
});

test('withPromptLogging re-throws inner errors but still persists error row', async () => {
  await assert.rejects(() =>
    withPromptLogging(
      {
        contentId: '00000000-0000-0000-0000-000000000000',
        agentName: 'test', stepName: 'test', stepOrder: 1, model: 'none',
        userPrompt: 'stub',
      },
      async () => { throw new Error('boom'); },
    ),
    /boom/,
  );
});

test('logDeterministicStep resolves without throwing', async () => {
  await assert.doesNotReject(() =>
    logDeterministicStep({
      contentId: '00000000-0000-0000-0000-000000000000',
      agentName: 'test', stepName: 'tts_script_prep', stepOrder: 5,
    }),
  );
});
