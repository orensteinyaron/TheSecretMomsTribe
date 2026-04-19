/**
 * DNA docs must not contain numeric word-count anchors.
 *
 * The brand-voice + content-dna files are embedded verbatim into the
 * content agent's system prompt as "THE LAW". If they carry a
 * numeric caption length (e.g. "100-180 words"), that guidance
 * competes with the char caps in the user prompt — the LLM splits
 * the difference and overshoots. This happened in early-April runs
 * and again today (5/5 batch over cap).
 *
 * Voice/structure guidance stays in the DNA docs. Only the numeric
 * anchor is forbidden. Regression guard: if someone reintroduces a
 * word-count range, this test fires.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const WORD_COUNT_ANCHOR = /\d{2,3}\s*-\s*\d{2,3}\s+words/i;

function read(rel) {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf-8');
}

test('brand-voice.md: no numeric word-count range anchoring captions', () => {
  const content = read('prompts/brand-voice.md');
  const match = content.match(WORD_COUNT_ANCHOR);
  assert.equal(
    match,
    null,
    `Found word-count anchor "${match?.[0]}" in brand-voice.md — these compete with the ` +
    `per-format char caps and pull the LLM toward overshoot. Drop the numeric range, keep ` +
    `the structural/voice guidance. See PR #13 commit message for rationale.`,
  );
});

test('content-dna.md: no numeric word-count range anchoring captions', () => {
  const content = read('prompts/content-dna.md');
  const match = content.match(WORD_COUNT_ANCHOR);
  assert.equal(
    match,
    null,
    `Found word-count anchor "${match?.[0]}" in content-dna.md — these compete with the ` +
    `per-format char caps and pull the LLM toward overshoot. Drop the numeric range, keep ` +
    `the structural/voice guidance. See PR #13 commit message for rationale.`,
  );
});

test('DNA docs still reference the per-format cap table (structure preserved)', () => {
  // Voice intent stays intact — just the anchor is gone. The
  // replacement language should point at the user prompt's cap table.
  const brandVoice = read('prompts/brand-voice.md');
  const contentDNA = read('prompts/content-dna.md');
  const pointsAtCaps = /caption length caps|char cap|per-format (char )?cap/i;
  assert.ok(
    pointsAtCaps.test(brandVoice) || pointsAtCaps.test(contentDNA),
    'At least one DNA doc should redirect the LLM to the user prompt cap table.',
  );
});
