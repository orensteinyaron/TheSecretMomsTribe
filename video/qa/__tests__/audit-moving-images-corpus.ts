// One-off audit: run the per-profile QA agent on every Moving Images V2
// render that exists in production. Aggregates dim PASS/FAIL counts so we
// can quantify whether the watermark + caption defects surfaced in PR 2
// calibration are isolated to one asset or systemic.
//
// Gated on RUN_QA_AUDIT=1 (real API calls).

import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { assertFfmpegAvailable } from "../../lib/qa-helpers.js";

const FIXTURES = [
  { id: "d93e2bcd-5665-469f-9b53-e839a1f06b13", hook: "That tiny note took you 10 seconds...", date: "2026-05-09" },
  { id: "a877d2c5-31c5-42d1-a318-b37c03a5d6a2", hook: "(unknown — Apr 7 render)", date: "2026-04-07" },
  { id: "6c9eea3e-366c-4bb2-a38c-9e0c4057852c", hook: "(unknown — Apr 7 render)", date: "2026-04-07" },
  { id: "a78f78ca-50f0-4f2d-b927-5af7ff9a2098", hook: "(unknown — Apr 5 render)", date: "2026-04-05" },
];

const URL_BASE = "https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/post-images/videos";

function urlFor(id: string): string {
  return `${URL_BASE}/${id}-v2.mp4`;
}

type AuditResult = {
  asset_id: string;
  verdict: string;
  cost: number;
  dim_status: Record<string, string>;
  dim_details: Record<string, string>;
};

function runAgentOnFixture(id: string, workdir: string, outDir: string): AuditResult | null {
  const url = urlFor(id);
  const local = path.join(workdir, `${id}.mp4`);
  process.stderr.write(`[audit] ${id}: downloading...\n`);
  const dl = spawnSync("curl", ["-fsSL", "-o", local, url], { stdio: ["ignore", "pipe", "pipe"] });
  if (dl.status !== 0) {
    process.stderr.write(`[audit] curl failed: ${dl.stderr?.toString().slice(0, 200)}\n`);
    return null;
  }
  if (!fs.existsSync(local) || fs.statSync(local).size < 10000) {
    process.stderr.write(`[audit] ${id} did not download (file missing or too small)\n`);
    return null;
  }

  const metaPath = path.join(workdir, `${id}-meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify({ asset_id: id }), "utf-8");

  process.stderr.write(`[audit] ${id}: running agent...\n`);
  const res = spawnSync(path.resolve(process.cwd(), "node_modules/.bin/tsx"), [
    "qa/run.ts",
    "--asset", local,
    "--profile", "moving-images",
    "--metadata", metaPath,
    "--output-dir", outDir,
  ], { cwd: path.resolve(process.cwd()), stdio: ["ignore", "pipe", "inherit"], env: process.env });
  if (res.status !== 0) {
    process.stderr.write(`[audit] agent failed for ${id} (code ${res.status})\n`);
    return null;
  }

  // Find the newest JSON in outDir whose name starts with the asset id.
  const candidates = fs.readdirSync(outDir)
    .filter(f => f.startsWith(id) && f.endsWith(".json"))
    .map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (candidates.length === 0) return null;

  const r = JSON.parse(fs.readFileSync(path.join(outDir, candidates[0].f), "utf-8"));
  const dimStatus: Record<string, string> = {};
  const dimDetails: Record<string, string> = {};
  for (const d of r.dimensions) {
    dimStatus[d.name] = d.status;
    dimDetails[d.name] = d.details.slice(0, 200);
  }
  return {
    asset_id: id,
    verdict: r.overall_verdict,
    cost: r.cost_summary?.total_usd ?? 0,
    dim_status: dimStatus,
    dim_details: dimDetails,
  };
}

async function main() {
  if (process.env.RUN_QA_AUDIT !== "1") {
    process.stderr.write(`[audit] RUN_QA_AUDIT not set — skipping. To run:

  RUN_QA_AUDIT=1 npx tsx video/qa/__tests__/audit-moving-images-corpus.ts

This audits all ${FIXTURES.length} Moving Images V2 renders in production storage.
Cost: ~$${(FIXTURES.length * 0.028).toFixed(2)}.
`);
    process.exit(0);
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[fatal] required env vars missing");
    process.exit(1);
  }
  assertFfmpegAvailable();

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-audit-"));
  const outDir = path.resolve(process.cwd(), "qa-audit-reports");
  fs.mkdirSync(outDir, { recursive: true });

  const results: AuditResult[] = [];
  for (const fix of FIXTURES) {
    const r = runAgentOnFixture(fix.id, workdir, outDir);
    if (r) results.push(r);
  }

  // Aggregate.
  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const dims = Array.from(new Set(results.flatMap(r => Object.keys(r.dim_status))));
  const dimAgg: Record<string, { PASS: number; FAIL: number; UNMEASURED: number }> = {};
  for (const d of dims) {
    dimAgg[d] = { PASS: 0, FAIL: 0, UNMEASURED: 0 };
    for (const r of results) {
      const s = r.dim_status[d];
      if (s === "PASS" || s === "FAIL" || s === "UNMEASURED") dimAgg[d][s] += 1;
    }
  }

  const verdictAgg = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});

  // Identify per-asset failing dims.
  const perAsset = results.map(r => {
    const failed = Object.entries(r.dim_status).filter(([_, s]) => s === "FAIL").map(([n]) => n);
    return { id: r.asset_id, verdict: r.verdict, failed: failed.join(", ") || "(none)", cost: r.cost };
  });

  const md = `# Moving Images V2 production audit — ${new Date().toISOString()}

Audited the **entire production corpus** of Moving Images V2 renders (${FIXTURES.length} assets).

## Aggregate results

- Total runs: ${results.length} / ${FIXTURES.length}
- Total cost: $${totalCost.toFixed(4)}
- Verdicts: ${Object.entries(verdictAgg).map(([v, c]) => `${v}=${c}`).join(", ")}

## Per-dimension pass rate

| Dimension | PASS | FAIL | UNMEASURED |
|---|---|---|---|
${dims.map(d => `| \`${d}\` | ${dimAgg[d].PASS} | ${dimAgg[d].FAIL} | ${dimAgg[d].UNMEASURED} |`).join("\n")}

## Per-asset

| Asset | Verdict | Failing dims | Cost |
|---|---|---|---|
${perAsset.map(p => `| \`${p.id}\` | ${p.verdict} | ${p.failed} | $${p.cost.toFixed(4)} |`).join("\n")}

## Patterns to flag

${(() => {
  const lines: string[] = [];
  const wm = dimAgg["watermark_compliance"];
  if (wm && wm.FAIL >= results.length) lines.push(`- **\`watermark_compliance\` fails on ALL ${wm.FAIL}/${results.length} renders.** This is systemic — YAR-131 watermark stamping is broken for the entire V2 production corpus.`);
  else if (wm && wm.FAIL > 0) lines.push(`- \`watermark_compliance\` fails ${wm.FAIL}/${results.length}.`);
  const cap = dimAgg["caption_legibility"];
  if (cap && cap.FAIL >= results.length) lines.push(`- **\`caption_legibility\` fails on ALL ${cap.FAIL}/${results.length} renders.** YAR-132 is systemic too.`);
  else if (cap && cap.FAIL > 0) lines.push(`- \`caption_legibility\` fails ${cap.FAIL}/${results.length}.`);
  const corpusSize = FIXTURES.length;
  if (corpusSize < 10) lines.push(`- **Corpus size is ${corpusSize}, smaller than the originally-assumed 10-20.** Moving Images V2 has produced fewer renders than expected. Worth checking whether the pipeline is running at the cadence the strategy doc assumes.`);
  return lines.length > 0 ? lines.join("\n") : "(no obvious patterns)";
})()}
`;

  const summaryPath = path.join(outDir, "moving-images-audit-summary.md");
  fs.writeFileSync(summaryPath, md, "utf-8");
  process.stderr.write(`\n[audit] summary written: ${summaryPath}\n`);
  process.stdout.write(md);

  fs.rmSync(workdir, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => {
  console.error("[audit] crashed:", e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
