// Surgical UPDATE of content_queue.<id>.avatar_config from a JSON file.
// Does NOT touch render_profile_id, status, hook, caption, or any other column.
// Used by Phase 9 pre-flight to force a row through v5 Avatar Full without
// flipping the row's canonical render_profile_id (that flip happens only
// after human approval of the final video).
//
// Usage:
//   npx tsx scripts/write-avatar-config.ts <content_id> <payload.json>

import { config } from "dotenv";
import fs from "node:fs";

for (const rel of ["../../.env", "../../../.env", "../../../../.env", "../../../../../.env"]) {
  const p = new URL(rel, import.meta.url).pathname;
  if (fs.existsSync(p)) { config({ path: p, override: false }); if (process.env.SUPABASE_URL) break; }
}

import { createClient } from "@supabase/supabase-js";

const [contentId, payloadPath] = process.argv.slice(2);
if (!contentId || !payloadPath) {
  console.error("usage: write-avatar-config.ts <content_id> <payload.json>");
  process.exit(2);
}
if (!fs.existsSync(payloadPath)) {
  console.error(`payload not found: ${payloadPath}`);
  process.exit(2);
}
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// 1. Read BEFORE so we can show the diff.
const before = await supabase
  .from("content_queue")
  .select("id, status, render_profile_id, avatar_config, updated_at")
  .eq("id", contentId)
  .single();
if (before.error) { console.error("[before-read]", before.error.message); process.exit(1); }

console.log("=== BEFORE ===");
console.log(`status: ${before.data.status}`);
console.log(`render_profile_id: ${before.data.render_profile_id}`);
console.log(`avatar_config: ${before.data.avatar_config === null ? "null" : JSON.stringify(before.data.avatar_config).slice(0, 80) + "…"}`);
console.log(`updated_at: ${before.data.updated_at}`);

// 2. UPDATE only avatar_config.
const updated = await supabase
  .from("content_queue")
  .update({ avatar_config: payload })
  .eq("id", contentId)
  .select("id, status, render_profile_id, avatar_config, updated_at")
  .single();
if (updated.error) { console.error("[update]", updated.error.message); process.exit(1); }

console.log("\n=== AFTER ===");
console.log(`status: ${updated.data.status}`);
console.log(`render_profile_id: ${updated.data.render_profile_id}`);
console.log(`avatar_config clips: ${updated.data.avatar_config.clips?.length ?? "(none)"} entries`);
console.log(`avatar_config format: ${updated.data.avatar_config.format}`);
console.log(`avatar_config register: ${updated.data.avatar_config.register}`);
console.log(`updated_at: ${updated.data.updated_at}`);

// 3. Sanity checks: status + render_profile_id MUST be unchanged.
if (before.data.status !== updated.data.status) {
  console.error(`\n[FAIL] status changed (${before.data.status} → ${updated.data.status}) — this should never happen`);
  process.exit(3);
}
if (before.data.render_profile_id !== updated.data.render_profile_id) {
  console.error(`\n[FAIL] render_profile_id changed (${before.data.render_profile_id} → ${updated.data.render_profile_id}) — this should never happen`);
  process.exit(3);
}
console.log("\n[OK] only avatar_config touched. status + render_profile_id unchanged.");
