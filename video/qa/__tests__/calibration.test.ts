// Calibration harness against the v1-broken and v3-known-good Avatar Full
// fixtures (raw clips + composited final MP4) pinned in YAR-129 thread.
//
// What it does:
//   1. Whisper-transcribes the v3 raw clip audios to establish a known-good
//      script per clip (proxy for the verbatim ElevenLabs script — v3 was
//      Whisper-verified by Yaron during the proof loop).
//   2. Constructs metadata.json with those scripts as the expected scripts,
//      using v1 raw clip URLs + v1 final mp4. Runs the Avatar Full agent.
//      Expected: FAIL on audio_integrity_raw_clips for clips 02 and 05a;
//      everything else informational.
//   3. Same with v3 raw clip URLs + v3 final mp4. Expected: most dims PASS;
//      color_filter_consistency and transition_style_verification may FAIL
//      against the avatar-v1 row's PRE-V3 reality declarations (warm_light
//      + 0.2s crossfade) — that's the "v3 reality update is gated on human
//      approval" decision from PR 0.
//   4. Captures per-run cost from each report.
//   5. Writes a Markdown summary to ./qa-calibration-report.md.
//
// Cost: ~$0.95 per full pass. Will NOT run without explicit env opt-in
// (RUN_QA_CALIBRATION=1) — calibration is real money, not a unit test.
//
// Run: RUN_QA_CALIBRATION=1 npx tsx video/qa/__tests__/calibration.test.ts

import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { downloadFile, extractAudioMp3, whisperTranscribe, assertFfmpegAvailable } from "../../lib/qa-helpers.js";

const V1_BASE = "https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/post-images/avatar-full-proof/deepfakes-v1";
const V3_BASE = "https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/post-images/avatar-full-proof/deepfakes-v3";
const REFERENCE_URL = "https://d8j0ntlcm91z4.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/hf_20260518_091205_969d4ab9-bd54-46de-8987-a7a70e6c2d51.png";

const CLIP_IDS = ["clip_01", "clip_02", "clip_03a", "clip_03b", "clip_04", "clip_05a", "clip_05b"];

// Approximate per-clip durations from the Linear v1/v2 reports.
const CLIP_DURATIONS_S: Record<string, number> = {
  clip_01: 8, clip_02: 8, clip_03a: 8, clip_03b: 8, clip_04: 10, clip_05a: 8, clip_05b: 8,
};

function ensureWork() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "qa-calib-"));
  process.stderr.write(`[calib] workdir=${work}\n`);
  return work;
}

async function transcribeKnownGood(work: string): Promise<Record<string, string>> {
  process.stderr.write(`[calib] transcribing v3 raw clips for expected scripts...\n`);
  const scripts: Record<string, string> = {};
  for (const id of CLIP_IDS) {
    const url = `${V3_BASE}/raw/${id}.mp4`;
    const mp4 = path.join(work, `v3-${id}.mp4`);
    const mp3 = path.join(work, `v3-${id}.mp3`);
    await downloadFile(url, mp4);
    extractAudioMp3(mp4, mp3);
    const w = await whisperTranscribe(mp3);
    scripts[id] = w.text.trim();
    process.stderr.write(`  ${id}: "${scripts[id].slice(0, 60)}..."\n`);
  }
  return scripts;
}

function buildMetadata(opts: {
  fixtureName: "v1" | "v3";
  clipBaseUrl: string;
  scripts: Record<string, string>;
}): any {
  let cursor = 0;
  const clips = CLIP_IDS.map(id => {
    const out = {
      id,
      url: `${opts.clipBaseUrl}/raw/${id}.mp4`,
      expected_script: opts.scripts[id],
      duration_s: CLIP_DURATIONS_S[id],
      start_offset_in_final_s: cursor,
    };
    cursor += CLIP_DURATIONS_S[id];
    return out;
  });
  return {
    asset_id: null,
    reference_image_url: REFERENCE_URL,
    clips,
    hook_overlay_text: { line1: "DEEPFAKES", line2: "OF YOUR KID" },
  };
}

function runAgent(opts: {
  assetUrl: string;
  metadataPath: string;
  outputDir: string;
  workdir: string;
  fixtureName: string;
}): { exitCode: number; reportJsonPath: string | null } {
  // Download the composited mp4 to local first.
  const mp4Local = path.join(opts.workdir, `${opts.fixtureName}-final.mp4`);
  process.stderr.write(`[calib] ${opts.fixtureName}: downloading composited mp4...\n`);
  const dl = spawnSync("curl", ["-fsSL", "-o", mp4Local, opts.assetUrl], { stdio: ["ignore", "pipe", "pipe"] });
  if (dl.status !== 0) {
    process.stderr.write(`[calib] curl failed: ${dl.stderr?.toString()}\n`);
    return { exitCode: 99, reportJsonPath: null };
  }

  process.stderr.write(`[calib] ${opts.fixtureName}: running agent...\n`);
  const tsxPath = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  const tsx = fs.existsSync(tsxPath) ? tsxPath : "npx";
  const tsxArgs = fs.existsSync(tsxPath) ? [] : ["tsx"];
  const res = spawnSync(tsx, [
    ...tsxArgs,
    "qa/run.ts",
    "--asset", mp4Local,
    "--profile", "avatar-v1",
    "--metadata", opts.metadataPath,
    "--output-dir", opts.outputDir,
  ], { cwd: path.resolve(process.cwd()), stdio: ["ignore", "pipe", "inherit"], env: process.env });

  if (res.status !== 0) {
    process.stderr.write(`[calib] agent failed with code ${res.status}\n`);
    return { exitCode: res.status ?? 1, reportJsonPath: null };
  }

  const jsons = fs.readdirSync(opts.outputDir)
    .filter(f => f.endsWith(".json"))
    .map(f => ({ f, t: fs.statSync(path.join(opts.outputDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (jsons.length === 0) return { exitCode: 0, reportJsonPath: null };
  return { exitCode: 0, reportJsonPath: path.join(opts.outputDir, jsons[0].f) };
}

function summarizeReport(reportPath: string): { verdict: string; cost: number; dimSummary: string; failedDims: string[]; unmeasuredDims: string[] } {
  const j = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  const failed = j.dimensions.filter((d: any) => d.status === "FAIL").map((d: any) => d.name);
  const unmeasured = j.dimensions.filter((d: any) => d.status === "UNMEASURED").map((d: any) => d.name);
  const summary = j.dimensions.map((d: any) => `${d.name}=${d.status}${d.score !== undefined ? `(${typeof d.score === "number" ? d.score.toFixed(2) : d.score})` : ""}`).join(", ");
  return {
    verdict: j.overall_verdict,
    cost: j.cost_summary?.total_usd ?? 0,
    dimSummary: summary,
    failedDims: failed,
    unmeasuredDims: unmeasured,
  };
}

async function main() {
  if (process.env.RUN_QA_CALIBRATION !== "1") {
    process.stderr.write(`[calib] RUN_QA_CALIBRATION not set — skipping. This harness makes real API calls (~$0.95). To run:

  RUN_QA_CALIBRATION=1 npx tsx video/qa/__tests__/calibration.test.ts

Expected outcome:
  - v1-broken fixture: FAIL overall, with audio_integrity_raw_clips=FAIL on clips 02 and 05a; lip_sync=UNMEASURED.
  - v3-known-good fixture: PASS or PARTIAL overall; if PARTIAL, the failing dim is color_filter_consistency and/or transition_style_verification due to the avatar-v1 PRE-V3 reality declarations (filter_setting='warm_light', transition_style.duration_s=0.2). That's the gated-update behavior from PR 0 — the v3 reality update only flips after human approval.
  - Per-run cost target: ≤ $0.65 (≤ 30% over the $0.47 projection).
`);
    process.exit(0);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("[fatal] ANTHROPIC_API_KEY missing"); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error("[fatal] OPENAI_API_KEY missing"); process.exit(1); }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("[fatal] SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }
  assertFfmpegAvailable();

  const work = ensureWork();
  const outDir = path.resolve(process.cwd(), "qa-calibration-reports");
  fs.mkdirSync(outDir, { recursive: true });

  const scripts = await transcribeKnownGood(work);

  // v1 broken
  const v1Meta = path.join(work, "v1-meta.json");
  fs.writeFileSync(v1Meta, JSON.stringify(buildMetadata({ fixtureName: "v1", clipBaseUrl: V1_BASE, scripts })), "utf-8");
  const v1Run = runAgent({ assetUrl: `${V1_BASE}/avatar_full_deepfakes_v1.mp4`, metadataPath: v1Meta, outputDir: outDir, workdir: work, fixtureName: "v1" });
  const v1Summary = v1Run.reportJsonPath ? summarizeReport(v1Run.reportJsonPath) : null;

  // v3 known-good
  const v3Meta = path.join(work, "v3-meta.json");
  fs.writeFileSync(v3Meta, JSON.stringify(buildMetadata({ fixtureName: "v3", clipBaseUrl: V3_BASE, scripts })), "utf-8");
  const v3Run = runAgent({ assetUrl: `${V3_BASE}/avatar_full_deepfakes_v3.mp4`, metadataPath: v3Meta, outputDir: outDir, workdir: work, fixtureName: "v3" });
  const v3Summary = v3Run.reportJsonPath ? summarizeReport(v3Run.reportJsonPath) : null;

  // Summary markdown
  const summaryPath = path.join(outDir, "calibration-summary.md");
  const summaryMd = `# QA agent calibration — ${new Date().toISOString()}

## v1 (broken)
- Verdict: ${v1Summary?.verdict ?? "agent crashed"}
- Cost: $${v1Summary?.cost.toFixed(4) ?? "n/a"}
- Failed dims: ${v1Summary?.failedDims.join(", ") || "(none)"}
- Unmeasured: ${v1Summary?.unmeasuredDims.join(", ") || "(none)"}
- Detail: ${v1Summary?.dimSummary ?? "(no report)"}

**Expected:** FAIL with audio_integrity_raw_clips on clips 02 + 05a; lip_sync UNMEASURED.
**Actual matches expected:** ${v1Summary?.failedDims.includes("audio_integrity_raw_clips") && v1Summary.unmeasuredDims.includes("lip_sync") ? "YES" : "NO — investigate"}

## v3 (known-good, PRE-V3 reality declared)
- Verdict: ${v3Summary?.verdict ?? "agent crashed"}
- Cost: $${v3Summary?.cost.toFixed(4) ?? "n/a"}
- Failed dims: ${v3Summary?.failedDims.join(", ") || "(none)"}
- Unmeasured: ${v3Summary?.unmeasuredDims.join(", ") || "(none)"}
- Detail: ${v3Summary?.dimSummary ?? "(no report)"}

**Expected:** PARTIAL (lip_sync + hook_overlay_style + register_adherence UNMEASURED), possibly FAIL on color_filter_consistency + transition_style_verification if v3 reality update on avatar-v1 has not yet been applied.

## Cost vs projection

| Fixture | Measured cost | Projection | Delta |
|---|---|---|---|
| v1 | $${v1Summary?.cost.toFixed(4) ?? "n/a"} | $0.47 | ${v1Summary ? (((v1Summary.cost - 0.47) / 0.47) * 100).toFixed(1) + "%" : "n/a"} |
| v3 | $${v3Summary?.cost.toFixed(4) ?? "n/a"} | $0.47 | ${v3Summary ? (((v3Summary.cost - 0.47) / 0.47) * 100).toFixed(1) + "%" : "n/a"} |

**Gate threshold:** ≤ 30% over projection per profile. Otherwise surface before merging PR 1 / future QA changes.
`;
  fs.writeFileSync(summaryPath, summaryMd, "utf-8");
  process.stderr.write(`\n[calib] summary written: ${summaryPath}\n`);
  process.stdout.write(summaryMd);

  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => {
  console.error("[calib] crashed:", e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
