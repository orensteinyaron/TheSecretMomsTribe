// YAR-144 — Rachel voice_id canon collapse (repo-wide deny-list guard).
//
// The deprecated id 9JqF6OmJtGjHTDODKG2c was aspirational; the renderer
// constant (RACHEL_ELEVENLABS_VOICE_ID) and 3 shipped pieces use tRhabd, so
// tRhabd is canonical (code wins, docs catch up). This test scans the ENTIRE
// repo for the deprecated id and fails on any hit outside a small allow-list
// of known-legitimate files — so a regression in a NEW file is caught too.
//
// Allow-listed (legitimate) occurrences:
//   - Two IMMUTABLE historical records — they document what a shipped piece
//     actually used; rewriting them falsifies history.
//   - The data-fix migration — its WHERE clause must reference the deprecated
//     id to match the rows it collapses.
//   - The e2e-unblock plan doc — describes this very task.
//   - This test file — it embeds the deprecated id as the guarded constant.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPRECATED = "9JqF6OmJtGjHTDODKG2c";
const CANONICAL = "tRhabdS7JjlQ0lVEImuM";

// repo root = three levels up from agents/lib/__tests__/
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// Directories never worth scanning.
const SKIP_DIRS = new Set(["node_modules", ".git"]);

// Files where the deprecated id is legitimate (repo-relative paths, posix).
const ALLOWLIST = new Set([
  "docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md",
  "supabase/migrations/20260509190000_backfill_3bcafc78_showcase.sql",
  "supabase/migrations/20260605120000_voice_id_canon_collapse.sql",
  "docs/superpowers/plans/2026-06-05-avatar-full-v5-e2e-unblock.md",
  "agents/lib/__tests__/voice-id-canon.test.js",
]);

function relPosix(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

/** Recursively collect every file under dir, skipping SKIP_DIRS. */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Find every line containing the needle. Skips binary/unreadable files. */
function findHits(absPath, needle) {
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return []; // unreadable — skip gracefully
  }
  if (buf.includes(0)) return []; // NUL byte → binary, skip
  const src = buf.toString("utf8");
  if (!src.includes(needle)) return [];
  const hits = [];
  src.split("\n").forEach((line, i) => {
    if (line.includes(needle)) hits.push(`${relPosix(absPath)}:${i + 1}`);
  });
  return hits;
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

test("no file outside the allow-list contains the deprecated voice id", () => {
  const offenders = [];
  for (const absPath of collectFiles(repoRoot)) {
    if (ALLOWLIST.has(relPosix(absPath))) continue;
    offenders.push(...findHits(absPath, DEPRECATED));
  }
  assert.equal(
    offenders.length,
    0,
    `Deprecated voice id ${DEPRECATED} found outside the allow-list:\n  ${offenders.join("\n  ")}`,
  );
});

test("agents/content.js carries the canonical voice id", () => {
  assert.ok(read("agents/content.js").includes(CANONICAL));
});

test("FACE_OF_SMT_V1.md carries the canonical voice id", () => {
  assert.ok(read("FACE_OF_SMT_V1.md").includes(CANONICAL));
});
