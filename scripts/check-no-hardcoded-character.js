#!/usr/bin/env node
/**
 * CI guard: no hard-coded character identity in agents/ source files.
 *
 * Exits 1 (with offending file + match) if any file under agents/ matches:
 *   - /\bmarry\b/i  — wrong character name
 *   - /mom of three \(\d+, \d+, \d+\)/ — hard-coded age tuple that may
 *     conflict with the canon ages in FACE_OF_SMT_V1.md (5, 11, 15)
 *
 * Skips: node_modules, __tests__ directories.
 *
 * YAR-143
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENTS_DIR = join(__dirname, '..', 'agents');

const FORBIDDEN_PATTERNS = [
  { pattern: /\bmarry\b/gi, label: 'wrong character name "Marry"' },
  { pattern: /mom of three \(\d+,\s*\d+,\s*\d+\)/gi, label: 'hard-coded age tuple (mom of three (N, N, N))' },
];

const SKIP_DIRS = new Set(['node_modules', '__tests__']);

/**
 * Recursively collect all files under a directory, skipping SKIP_DIRS.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const files = collectFiles(AGENTS_DIR);
let violations = 0;

for (const filePath of files) {
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    // Binary or unreadable — skip
    continue;
  }

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    const match = pattern.exec(src);
    if (match) {
      const rel = relative(join(__dirname, '..'), filePath);
      console.error(`[check-no-hardcoded-character] FAIL: ${rel}`);
      console.error(`  Rule: ${label}`);
      console.error(`  Match: "${match[0]}"`);
      violations++;
    }
  }
}

if (violations === 0) {
  console.log('[check-no-hardcoded-character] OK — no hard-coded character identity found in agents/');
  process.exit(0);
} else {
  console.error(`[check-no-hardcoded-character] ${violations} violation(s). Canon: FACE_OF_SMT_V1.md (Rachel, ages 5/11/15).`);
  process.exit(1);
}
