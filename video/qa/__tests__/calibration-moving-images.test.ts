// Moving Images calibration against a known-good production asset.
//
// Fixture: content_queue.d93e2bcd-5665-469f-9b53-e839a1f06b13
//   Hook: "That tiny note took you 10 seconds. Her face when she read it?
//          That's the whole thing."
//   Render: 2026-05-09. PASSED legacy qa-agent.ts.
//
// Expected verdict: PARTIAL (phrase_caption_timing + hook_overlay_style
// UNMEASURED). PASS on all measured dims; FAIL acceptable on
// color_filter_consistency or transition_style_verification only if the
// declared values (warm_light filter + 0.3s crossfade) don't match the
// actual render — in which case we surface the discrepancy.
//
// Cost: ~$0.09 per run. Gated on RUN_QA_CALIBRATION=1.

import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { assertFfmpegAvailable } from "../../lib/qa-helpers.js";

const FIXTURE = {
  asset_id: "d93e2bcd-5665-469f-9b53-e839a1f06b13",
  asset_url: "https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/post-images/videos/d93e2bcd-5665-469f-9b53-e839a1f06b13-v2.mp4",
  hook: "That tiny note took you 10 seconds. Her face when she read it? That's the whole thing.",
};

const COST_PROJECTION = 0.09;
const COST_CEILING = 0.13; // ≤ 30% over projection per the merge gate

function runAgent(opts: {
  assetUrl: string;
  metadataPath: string;
  outputDir: string;
  workdir: string;
}): { exitCode: number; reportJsonPath: string | null } {
  const mp4Local = path.join(opts.workdir, "mi-fixture.mp4");
  process.stderr.write(`[mi-calib] downloading fixture...\n`);
  const dl = spawnSync("curl", ["-fsSL", "-o", mp4Local, opts.assetUrl], { stdio: ["ignore", "pipe", "pipe"] });
  if (dl.status !== 0) {
    process.stderr.write(`[mi-calib] curl failed: ${dl.stderr?.toString()}\n`);
    return { exitCode: 99, reportJsonPath: null };
  }

  process.stderr.write(`[mi-calib] running agent...\n`);
  const tsxPath = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  const tsx = fs.existsSync(tsxPath) ? tsxPath : "npx";
  const tsxArgs = fs.existsSync(tsxPath) ? [] : ["tsx"];
  const res = spawnSync(tsx, [
    ...tsxArgs,
    "qa/run.ts",
    "--asset", mp4Local,
    "--profile", "moving-images",
    "--metadata", opts.metadataPath,
    "--output-dir", opts.outputDir,
  ], { cwd: path.resolve(process.cwd()), stdio: ["ignore", "pipe", "inherit"], env: process.env });

  if (res.status !== 0) {
    process.stderr.write(`[mi-calib] agent failed with code ${res.status}\n`);
    return { exitCode: res.status ?? 1, reportJsonPath: null };
  }

  const jsons = fs.readdirSync(opts.outputDir)
    .filter(f => f.endsWith(".json"))
    .map(f => ({ f, t: fs.statSync(path.join(opts.outputDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (jsons.length === 0) return { exitCode: 0, reportJsonPath: null };
  return { exitCode: 0, reportJsonPath: path.join(opts.outputDir, jsons[0].f) };
}

function summarizeReport(reportPath: string): {
  verdict: string;
  cost: number;
  failed: string[];
  unmeasured: string[];
  passing: string[];
  dimSummary: string;
} {
  const j = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  return {
    verdict: j.overall_verdict,
    cost: j.cost_summary?.total_usd ?? 0,
    failed: j.dimensions.filter((d: any) => d.status === "FAIL").map((d: any) => d.name),
    unmeasured: j.dimensions.filter((d: any) => d.status === "UNMEASURED").map((d: any) => d.name),
    passing: j.dimensions.filter((d: any) => d.status === "PASS").map((d: any) => d.name),
    dimSummary: j.dimensions.map((d: any) =>
      `${d.name}=${d.status}${d.score !== undefined ? `(${typeof d.score === "number" ? d.score.toFixed(2) : d.score})` : ""}`,
    ).join(", "),
  };
}

async function main() {
  if (process.env.RUN_QA_CALIBRATION !== "1") {
    process.stderr.write(`[mi-calib] RUN_QA_CALIBRATION not set — skipping. This harness makes real API calls (~$0.09). To run:

  RUN_QA_CALIBRATION=1 npx tsx video/qa/__tests__/calibration-moving-images.test.ts

Fixture: content_queue.${FIXTURE.asset_id}
URL: ${FIXTURE.asset_url}

Expected verdict: PARTIAL (phrase_caption_timing + hook_overlay_style UNMEASURED).
Expected cost: ~$${COST_PROJECTION.toFixed(2)} per run (ceiling $${COST_CEILING.toFixed(2)}).
`);
    process.exit(0);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("[fatal] ANTHROPIC_API_KEY missing"); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error("[fatal] OPENAI_API_KEY missing"); process.exit(1); }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("[fatal] SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }
  assertFfmpegAvailable();

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mi-calib-"));
  process.stderr.write(`[mi-calib] workdir=${work}\n`);
  const outDir = path.resolve(process.cwd(), "qa-calibration-reports");
  fs.mkdirSync(outDir, { recursive: true });

  const meta = path.join(work, "mi-meta.json");
  fs.writeFileSync(meta, JSON.stringify({
    asset_id: FIXTURE.asset_id,
    hook_overlay_text: { line1: FIXTURE.hook },
  }), "utf-8");

  const run = runAgent({ assetUrl: FIXTURE.asset_url, metadataPath: meta, outputDir: outDir, workdir: work });
  const summary = run.reportJsonPath ? summarizeReport(run.reportJsonPath) : null;

  if (!summary) {
    process.stderr.write(`[mi-calib] no report produced (exit ${run.exitCode})\n`);
    process.exit(1);
  }

  const costDelta = ((summary.cost - COST_PROJECTION) / COST_PROJECTION) * 100;
  const costPasses = summary.cost <= COST_CEILING;

  const md = `# Moving Images QA calibration — ${new Date().toISOString()}

## Fixture
- Asset: \`${FIXTURE.asset_id}\`
- Hook: "${FIXTURE.hook}"
- URL: ${FIXTURE.asset_url}

## Result
- Verdict: **${summary.verdict}**
- Cost: **$${summary.cost.toFixed(4)}** (projection: $${COST_PROJECTION.toFixed(2)}; delta: ${costDelta.toFixed(1)}%; ceiling: $${COST_CEILING.toFixed(2)}; ${costPasses ? "**WITHIN BUDGET**" : "**OVER BUDGET — SURFACE BEFORE MERGE**"})

### Dimensions
- Passing: ${summary.passing.join(", ") || "(none)"}
- Failed: ${summary.failed.join(", ") || "(none)"}
- Unmeasured: ${summary.unmeasured.join(", ") || "(none)"}

### Detail
${summary.dimSummary}

## Gate check
- Cost ≤ $${COST_CEILING.toFixed(2)}: ${costPasses ? "✓" : "✗ — surface before merge"}
- Verdict is PARTIAL (expected — phrase_caption_timing + hook_overlay_style UNMEASURED): ${summary.verdict === "PARTIAL" ? "✓" : `→ actual ${summary.verdict}, investigate`}
- phrase_caption_timing UNMEASURED: ${summary.unmeasured.includes("phrase_caption_timing") ? "✓" : "✗"}
- hook_overlay_style UNMEASURED: ${summary.unmeasured.includes("hook_overlay_style") ? "✓" : "✗"}
`;

  const summaryPath = path.join(outDir, "moving-images-calibration-summary.md");
  fs.writeFileSync(summaryPath, md, "utf-8");
  process.stderr.write(`\n[mi-calib] summary written: ${summaryPath}\n`);
  process.stdout.write(md);

  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => {
  console.error("[mi-calib] crashed:", e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
