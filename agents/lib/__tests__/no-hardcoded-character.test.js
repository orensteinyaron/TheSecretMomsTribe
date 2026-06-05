/**
 * Guard: agents/content.js must not contain a hard-coded character identity
 * that conflicts with the canon file (FACE_OF_SMT_V1.md).
 *
 * Canon source of truth: FACE_OF_SMT_V1.md
 *   - Name: Rachel
 *   - Ages: 5, 11, and 15
 *
 * YAR-143: "Marry" + false kids ages (14, 9, 4) were hard-coded at
 * content.js:243 inside OUTPUT_SCHEMA_INSTRUCTIONS, fighting the canon
 * file inside the same assembled prompt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this test file location (agents/lib/__tests__/)
const CONTENT_JS = join(__dirname, '../../content.js');
const FACE_OF_SMT = join(__dirname, '../../../FACE_OF_SMT_V1.md');

const contentSrc = readFileSync(CONTENT_JS, 'utf8');
const faceOfSmt = readFileSync(FACE_OF_SMT, 'utf8');

test('content.js: does not mention "Marry" (wrong character name)', () => {
  assert.doesNotMatch(
    contentSrc,
    /\bmarry\b/i,
    'content.js contains "Marry" — this hard-codes the wrong character identity; canon is Rachel (FACE_OF_SMT_V1.md)',
  );
});

test('content.js: does not contain the false kids-age tuple (14, 9, 4)', () => {
  assert.doesNotMatch(
    contentSrc,
    /\(14,\s*9,\s*4\)/,
    'content.js hard-codes the wrong kids ages (14, 9, 4); canon ages are 5, 11, 15',
  );
});

test('FACE_OF_SMT_V1.md: canonical name is Rachel', () => {
  assert.match(
    faceOfSmt,
    /Rachel/,
    'FACE_OF_SMT_V1.md should define Rachel as the canon character',
  );
});

test('FACE_OF_SMT_V1.md: canonical ages are 5, 11, and 15', () => {
  assert.match(
    faceOfSmt,
    /5,\s*11,\s*and\s*15/,
    'FACE_OF_SMT_V1.md should document the canon ages: 5, 11, and 15',
  );
});
