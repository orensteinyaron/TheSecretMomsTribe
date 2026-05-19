// Per-profile QA entry point. Composite dispatch on (render_profile_slug,
// avatar_config.format). One CLI binary; one Markdown report per run.
//
// Usage:
//   npx tsx video/qa/run.ts \
//     --asset <local-path-to-final-mp4-or-png> \
//     --profile <render_profile_slug> \
//     --metadata <path-to-metadata.json> \
//     [--variant <avatar_config.format>] \
//     [--content-id <uuid>] \
//     [--keep-workdir]
//
// metadata.json schema (per-profile fields documented in video/qa/README.md):
// {
//   "asset_id": "uuid|null",
//   "reference_image_url": "https://...",     // avatar profiles only
//   "clips": [                                  // avatar / moving-images
//     { "id": "SCENE_01", "url": "https://...",
//       "expected_script": "...", "duration_s": 9,
//       "start_offset_in_final_s": 0 }
//   ],
//   "hook_overlay_text": { "line1": "...", "line2": "..." }
// }

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import os from "os";
import path from "path";

import { assertFfmpegAvailable, downloadFile } from "../lib/qa-helpers.js";
import { loadProfileConfig } from "./base/helpers/profile-config.js";
import { runAvatarFullQA } from "./profiles/avatar-full.js";
import { runMovingImagesQA } from "./profiles/moving-images.js";
import { runAvatarVisualQA } from "./profiles/avatar-visual.js";
import { runAskRachelQA } from "./profiles/ask-rachel.js";
import { runStaticImageQA } from "./profiles/static-image.js";
import { runCarouselQA } from "./profiles/carousel.js";
import { renderQAReportMarkdown } from "./report/render-markdown.js";
import { persistCostLog } from "./report/persist-cost-log.js";
import type { QAInput, ClipMeta } from "./base/qa-contract.js";
import type { QAReport } from "./schemas/qa-report.js";

type Args = {
  asset?: string;
  profile?: string;
  metadata?: string;
  variant?: string | null;
  contentId?: string | null;
  outputDir?: string;
  keepWorkdir: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { keepWorkdir: false, variant: null, contentId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--asset") out.asset = argv[++i];
    else if (a === "--profile") out.profile = argv[++i];
    else if (a === "--metadata") out.metadata = argv[++i];
    else if (a === "--variant") out.variant = argv[++i];
    else if (a === "--content-id") out.contentId = argv[++i];
    else if (a === "--output-dir") out.outputDir = argv[++i];
    else if (a === "--keep-workdir") out.keepWorkdir = true;
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
  }
  return out;
}

function printUsage() {
  console.error(`Usage: npx tsx video/qa/run.ts \\
  --asset <local-path> \\
  --profile <render_profile_slug> \\
  --metadata <path-to-metadata.json> \\
  [--variant <avatar_config.format>] \\
  [--content-id <uuid>] \\
  [--output-dir <dir>] \\
  [--keep-workdir]

Requires: ffmpeg, ffprobe, ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY`);
}

async function loadMetadata(metaPath: string): Promise<any> {
  if (!fs.existsSync(metaPath)) throw new Error(`metadata not found: ${metaPath}`);
  const raw = fs.readFileSync(metaPath, "utf-8");
  try { return JSON.parse(raw); }
  catch (e: any) { throw new Error(`metadata parse error: ${e.message}`); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.asset || !args.profile || !args.metadata) {
    printUsage();
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("[fatal] ANTHROPIC_API_KEY missing"); process.exit(1); }
  if (!process.env.OPENAI_API_KEY)    { console.error("[fatal] OPENAI_API_KEY missing"); process.exit(1); }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("[fatal] SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }

  assertFfmpegAvailable();

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const workdir = path.join(os.tmpdir(), `qa-${args.profile}-${runId}`);
  fs.mkdirSync(workdir, { recursive: true });
  process.stderr.write(`[qa] workdir=${workdir}\n`);

  const profileConfig = await loadProfileConfig(args.profile);
  const metadata = await loadMetadata(args.metadata);

  let referenceImagePath: string | undefined;
  if (metadata.reference_image_url) {
    referenceImagePath = path.join(workdir, "reference.png");
    await downloadFile(metadata.reference_image_url, referenceImagePath);
  }

  const clips: ClipMeta[] | undefined = Array.isArray(metadata.clips) ? metadata.clips : undefined;

  const input: QAInput = {
    asset_id: metadata.asset_id ?? args.contentId ?? null,
    asset_path: args.asset,
    profile_config: profileConfig,
    variant: args.variant ?? null,
    reference_image_url: metadata.reference_image_url,
    reference_image_path: referenceImagePath,
    clips,
    hook_overlay_text: metadata.hook_overlay_text,
    hook_card_image_url: metadata.hook_card_image_url,
    carousel_slide_paths: metadata.carousel_slide_paths,
    workdir,
  };

  // Composite dispatch: render_profile_slug × variant. PR 1 implements
  // avatar-v1 (Avatar Full baseline). Variant-specific paths (avatar_visual,
  // ask-rachel) will layer in PR 3 — for now they fall through to the
  // Avatar Full agent with a note in the report.
  let report: QAReport;
  if (args.profile === "avatar-v1") {
    // Composite dispatch on variant. Variants are declared in
    // render_profiles.qa_rules.variants for avatar-v1 (migration
    // 20260519120000). Each variant agent inherits the Avatar Full
    // baseline and layers add_to_in_scope dims.
    switch (args.variant) {
      case "avatar_visual":
        report = await runAvatarVisualQA(input);
        break;
      case "ask_rachel":
        report = await runAskRachelQA(input);
        break;
      case "full_avatar":
      case null:
      case undefined:
        report = await runAvatarFullQA(input);
        break;
      default:
        throw new Error(`Unknown avatar-v1 variant: ${args.variant}. Valid: full_avatar | avatar_visual | ask_rachel.`);
    }
  } else if (args.profile === "moving-images") {
    report = await runMovingImagesQA(input);
  } else if (args.profile === "static-image") {
    report = await runStaticImageQA(input);
  } else if (args.profile === "carousel") {
    report = await runCarouselQA(input);
  } else {
    throw new Error(`Unknown profile slug '${args.profile}'. Valid: avatar-v1 | moving-images | static-image | carousel.`);
  }

  // Persist cost telemetry.
  await persistCostLog(report);

  // Render Markdown and write to qa-reports/.
  const md = renderQAReportMarkdown(report);
  const outDir = args.outputDir ?? path.resolve(process.cwd(), "qa-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.ran_at.replace(/[:.]/g, "-");
  const mdPath = path.join(outDir, `${report.asset_id ?? "noid"}_${stamp}.md`);
  fs.writeFileSync(mdPath, md, "utf-8");
  process.stderr.write(`[qa] report written: ${mdPath}\n`);

  // Also emit Markdown to stdout for chat-pasting / piping.
  process.stdout.write(md);

  // JSON sidecar for orchestrator parsing.
  const jsonPath = path.join(outDir, `${report.asset_id ?? "noid"}_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  if (args.keepWorkdir) {
    process.stderr.write(`[qa] --keep-workdir: preserving ${workdir}\n`);
  } else {
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  // Exit code: 0 = report generated successfully. We do NOT exit non-zero
  // on FAIL — the orchestrator reads the JSON and decides. The CLI's job is
  // to produce the report; the verdict is data.
  process.exit(0);
}

main().catch(e => {
  console.error(`[qa] fatal: ${e?.stack ?? e?.message ?? String(e)}`);
  process.exit(1);
});
