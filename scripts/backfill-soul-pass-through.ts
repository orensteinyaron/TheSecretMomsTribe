/**
 * One-shot Soul-pass-through backfill for rachel_stills.
 *
 * Context (PR-B, YAR-136): the rachel_stills.soul_still_url column was misnamed
 * — it stored raw nano_banana_pro outputs (composition anchors only, no Soul
 * identity lock). PR-B repurposes the column in place to mean Soul-2.0
 * identity-locked outputs. All active rows created before the PR-B merge need
 * Soul-pass-through applied once, then their soul_still_id + soul_still_url
 * columns updated to the Soul outputs.
 *
 * Two-phase execution because the v5 Node runtime cannot safely invoke
 * Higgsfield MCP (session-scoped):
 *
 *   Phase 1 — plan:
 *     npx tsx scripts/backfill-soul-pass-through.ts --plan
 *   Prints the list of rows + the exact Soul-2.0 generate_image MCP call to
 *   run from the Claude Code session for each row.
 *
 *   Phase 2 — apply:
 *     npx tsx scripts/backfill-soul-pass-through.ts --apply <path-to-results.json>
 *   Reads results.json with the shape:
 *     [{ "still_id": "<uuid>", "soul_job_id": "<uuid>", "soul_url": "<https-url>" }, ...]
 *   UPDATEs each row's soul_still_id + soul_still_url, then re-SELECTs to verify.
 *
 * Cost: ~$0.002 per row (Soul-2.0 image generation). Expected ~$0.008 for the
 * 4 stills that existed at PR-B merge time.
 */

import { config } from "dotenv";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const rel of ["../.env", "../../.env", "../../../.env", "../../../../.env"]) {
  const p = new URL(rel, import.meta.url).pathname;
  if (fs.existsSync(p)) {
    config({ path: p, override: false });
    if (process.env.SUPABASE_URL) break;
  }
}

import { RACHEL_SOUL_ID } from "../video/lib/avatar-constants.js";

interface BackfillResult {
  still_id: string;
  soul_job_id: string;
  soul_url: string;
}

function supa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key);
}

async function planPhase(): Promise<void> {
  const { data, error } = await supa()
    .from("rachel_stills")
    .select("still_id, look_id, location_id, soul_still_url")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`SELECT failed: ${error.message}`);
  if (!data || data.length === 0) {
    console.log("No active stills found. Nothing to backfill.");
    return;
  }

  console.log(`Found ${data.length} active still(s) to backfill.\n`);
  console.log("For each row below, run from the Claude Code session:\n");
  for (const row of data) {
    console.log(`  # still_id=${row.still_id} (look=${row.look_id}, location=${row.location_id})`);
    console.log(`  Higgsfield:generate_image with:`);
    console.log(`    model: 'soul_2'`);
    console.log(`    soul_id: '${RACHEL_SOUL_ID}'`);
    console.log(`    aspect_ratio: '9:16'`);
    console.log(`    count: 1`);
    console.log(`    medias: [{ value: '${row.soul_still_url}', role: 'image' }]`);
    console.log(`    prompt: <wardrobe+location prompt — see assembleSoulPassThroughPrompt>`);
    console.log("");
  }
  console.log("Then collect the results into a JSON file shaped as:");
  console.log(`  [{ "still_id": "...", "soul_job_id": "...", "soul_url": "https://..." }, ...]`);
  console.log("\nRe-run with: --apply <path-to-results.json>");
}

async function applyPhase(resultsPath: string): Promise<void> {
  const raw = fs.readFileSync(resultsPath, "utf-8");
  const results: BackfillResult[] = JSON.parse(raw);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`expected non-empty array of results in ${resultsPath}`);
  }

  for (const r of results) {
    if (!r.still_id || !r.soul_job_id || !r.soul_url) {
      throw new Error(`malformed result row: ${JSON.stringify(r)}`);
    }
  }

  console.log(`Applying ${results.length} Soul-pass-through update(s)...\n`);

  for (const r of results) {
    const { error: updErr } = await supa()
      .from("rachel_stills")
      .update({ soul_still_id: r.soul_job_id, soul_still_url: r.soul_url })
      .eq("still_id", r.still_id);
    if (updErr) throw new Error(`UPDATE failed for ${r.still_id}: ${updErr.message}`);

    // Post-write verify (May 2026 principle).
    const { data: after, error: selErr } = await supa()
      .from("rachel_stills")
      .select("soul_still_id, soul_still_url")
      .eq("still_id", r.still_id)
      .single();
    if (selErr || !after) throw new Error(`verify-SELECT failed for ${r.still_id}: ${selErr?.message ?? "no row"}`);
    if (after.soul_still_id !== r.soul_job_id || after.soul_still_url !== r.soul_url) {
      throw new Error(
        `post-write verify failed for ${r.still_id}: wrote ${r.soul_job_id}/${r.soul_url}, ` +
          `read back ${after.soul_still_id}/${after.soul_still_url}`,
      );
    }
    console.log(`  ✓ ${r.still_id} → soul_job=${r.soul_job_id}`);
  }

  console.log(`\nAll ${results.length} row(s) updated and verified.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--plan")) {
    await planPhase();
    return;
  }
  const applyIdx = argv.indexOf("--apply");
  if (applyIdx >= 0 && argv[applyIdx + 1]) {
    await applyPhase(argv[applyIdx + 1]!);
    return;
  }
  console.error("Usage: backfill-soul-pass-through.ts (--plan | --apply <results.json>)");
  process.exit(2);
}

main().catch((e) => {
  console.error(`[fatal] ${e.stack ?? e.message}`);
  process.exit(1);
});
