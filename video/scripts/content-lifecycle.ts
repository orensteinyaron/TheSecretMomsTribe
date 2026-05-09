/**
 * content-lifecycle CLI — implementation of skills/content-lifecycle/SKILL.md
 *
 * v1 supports `--mode persist` only. re_render and publish are placeholders
 * for follow-up PRs.
 *
 * Usage:
 *   npx tsx scripts/content-lifecycle.ts \
 *     --mode persist \
 *     --content-id <uuid> \
 *     --manifest /abs/path/to/manifest.json \
 *     --hook-overlay "How I get my teen talking"
 *
 * Mime-type guessing is deliberately simple — extend the table as needed.
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  ensurePath,
  ensureFolder,
  uploadFile,
  type UploadedFile,
} from "../lib/drive.js";

interface Args {
  mode: "persist" | "re_render" | "publish";
  contentId: string;
  manifestPath: string;
  hookOverlay?: string;
  publishDate?: string;
  parentPath: string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    mode: "persist",
    contentId: "",
    manifestPath: "",
    parentPath: ["SMT", "Content"],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") out.mode = argv[++i] as Args["mode"];
    else if (a === "--content-id") out.contentId = argv[++i];
    else if (a === "--manifest") out.manifestPath = argv[++i];
    else if (a === "--hook-overlay") out.hookOverlay = argv[++i];
    else if (a === "--publish-date") out.publishDate = argv[++i];
    else if (a === "--parent-path") out.parentPath = argv[++i].split("/");
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
  }
  return out;
}

function printUsage() {
  process.stderr.write(`Usage: npx tsx scripts/content-lifecycle.ts --mode persist|re_render|publish [...]

  --mode <persist|re_render|publish>   required
  --content-id <uuid>                  required
  --manifest <path>                    required for persist/re_render
  --hook-overlay <text>                required for persist; used in folder slug
  --publish-date <YYYY-MM-DD>          required for publish
  --parent-path <path>                 default: SMT/Content

Drive OAuth: looks for ~/.config/smt/drive-credentials.json. First run
opens browser; subsequent runs use ~/.config/smt/drive-token.json.
`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.contentId) { process.stderr.write("[fatal] --content-id required\n"); process.exit(1); }
if (args.mode === "persist" || args.mode === "re_render") {
  if (!args.manifestPath) { process.stderr.write(`[fatal] --manifest required for ${args.mode} mode\n`); process.exit(1); }
}
if (args.mode === "persist" && !args.hookOverlay) {
  process.stderr.write("[fatal] --hook-overlay required for persist mode (used in folder slug)\n");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_KEY) { process.stderr.write("[fatal] SUPABASE_SERVICE_ROLE_KEY missing in env\n"); process.exit(1); }
const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- Helpers ----

function log(msg: string) { process.stderr.write(`${msg}\n`); }

function todayISO(): string {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")  // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFolderSlug(hookOverlay: string, contentId: string, date: string): string {
  return `${slugify(hookOverlay)}_${date}_${contentId.slice(0, 4)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".mp4":  "video/mp4",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3":  "audio/mpeg",
  ".m4a":  "audio/mp4",
  ".wav":  "audio/wav",
  ".json": "application/json",
  ".txt":  "text/plain",
  ".md":   "text/markdown",
};
function mimeFor(localPath: string, override?: string): string {
  if (override) return override;
  const ext = path.extname(localPath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// ---- Manifest ----

interface ManifestArtifact {
  type: string;
  subtype?: string;
  path: string;            // relative to manifest's work_dir
  size_bytes?: number;
  duration_s?: number;
  width?: number;
  height?: number;
  mime_type?: string;
  metadata?: Record<string, any>;
}

interface Manifest {
  status: string;
  content_id?: string;
  work_dir: string;
  produced_at?: string;
  render_params?: Record<string, any>;
  origin?: string;
  artifacts: ManifestArtifact[];
}

function loadManifest(manifestPath: string): Manifest {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
  if (m.status !== "success") throw new Error(`manifest status is "${m.status}", not "success"`);
  if (!m.work_dir) throw new Error("manifest missing work_dir");
  if (!Array.isArray(m.artifacts) || m.artifacts.length === 0) throw new Error("manifest has no artifacts");
  return m;
}

// ---- Persist mode ----

async function runPersist(): Promise<void> {
  log(`[persist] content_id=${args.contentId}`);
  log(`[persist] manifest=${args.manifestPath}`);

  const manifest = loadManifest(args.manifestPath);
  if (manifest.content_id && manifest.content_id !== args.contentId) {
    log(`[warn] manifest.content_id (${manifest.content_id}) != --content-id (${args.contentId}); using --content-id`);
  }

  // Sanity: verify content row exists
  const { data: contentRow, error: contentErr } = await sb
    .from("content_queue")
    .select("id, hook, status, render_status")
    .eq("id", args.contentId)
    .single();
  if (contentErr || !contentRow) throw new Error(`content_queue row not found for id=${args.contentId}: ${contentErr?.message}`);
  log(`[persist] content row: status=${contentRow.status} render_status=${contentRow.render_status ?? "null"}`);

  // Drive: ensure parent path + create slug folder
  const date = todayISO();
  const slug = buildFolderSlug(args.hookOverlay!, args.contentId, date);
  log(`[persist] folder slug: ${slug}`);

  log(`[persist] ensuring Drive parent path: ${args.parentPath.join("/")}/Produced/`);
  const parentId = await ensurePath([...args.parentPath, "Produced"]);
  const slugFolderId = await ensureFolder(parentId, slug);
  log(`[persist] slug folder ready: id=${slugFolderId}`);

  // Subfolders for any artifact paths that include directories
  const subfolderIds = new Map<string, string>();
  subfolderIds.set("", slugFolderId);
  for (const art of manifest.artifacts) {
    const dir = path.posix.dirname(art.path);
    if (dir === "." || dir === "/" || dir === "") continue;
    if (subfolderIds.has(dir)) continue;
    // Walk the dir parts
    let curParent = slugFolderId;
    let acc = "";
    for (const part of dir.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      if (subfolderIds.has(acc)) {
        curParent = subfolderIds.get(acc)!;
        continue;
      }
      curParent = await ensureFolder(curParent, part);
      subfolderIds.set(acc, curParent);
      log(`[persist]   subfolder ${acc}/ -> ${curParent}`);
    }
  }

  // Upload artifacts (sequential — Drive resumable doesn't love parallel from one OAuth client)
  const uploaded: Array<{
    asset_type: string;
    asset_subtype: string | null;
    drive: UploadedFile;
    storage_path: string;
    duration_s: number | null;
    metadata: Record<string, any>;
  }> = [];

  for (const art of manifest.artifacts) {
    const localAbs = path.isAbsolute(art.path) ? art.path : path.join(manifest.work_dir, art.path);
    if (!fs.existsSync(localAbs)) throw new Error(`artifact missing on disk: ${localAbs}`);
    const dir = path.posix.dirname(art.path);
    const targetParent = subfolderIds.get(dir === "." ? "" : dir)!;
    const fileName = path.basename(art.path);
    const mime = mimeFor(localAbs, art.mime_type);
    const stat = fs.statSync(localAbs);

    log(`[upload] ${art.type}${art.subtype ? `/${art.subtype}` : ""}: ${art.path} (${fmtBytes(stat.size)})`);
    const drive = await uploadFile({
      parentId: targetParent,
      name: fileName,
      localPath: localAbs,
      mimeType: mime,
    });
    log(`[upload]   -> ${drive.id} (${fmtBytes(drive.size)})`);

    const storagePath = `${args.parentPath.join("/")}/Produced/${slug}/${art.path}`;
    uploaded.push({
      asset_type: art.type,
      asset_subtype: art.subtype ?? null,
      drive,
      storage_path: storagePath,
      duration_s: typeof art.duration_s === "number" ? art.duration_s : null,
      metadata: { ...(art.metadata ?? {}), width: art.width, height: art.height, manifest_origin: manifest.origin },
    });
  }

  // Upload manifest.json itself
  const manifestStorage = `${args.parentPath.join("/")}/Produced/${slug}/manifest.json`;
  log(`[upload] manifest.json (${fmtBytes(fs.statSync(args.manifestPath).size)})`);
  const manifestDrive = await uploadFile({
    parentId: slugFolderId,
    name: "manifest.json",
    localPath: args.manifestPath,
    mimeType: "application/json",
  });
  log(`[upload]   -> ${manifestDrive.id}`);
  uploaded.push({
    asset_type: "manifest",
    asset_subtype: null,
    drive: manifestDrive,
    storage_path: manifestStorage,
    duration_s: null,
    metadata: { generated_by: "content-lifecycle persist" },
  });

  // Insert content_assets rows
  log(`[persist] writing ${uploaded.length} content_assets rows ...`);
  const rows = uploaded.map((u) => ({
    content_id: args.contentId,
    asset_type: u.asset_type,
    asset_subtype: u.asset_subtype,
    storage_provider: "google_drive",
    storage_url: u.drive.webViewLink,
    storage_path: u.storage_path,
    drive_file_id: u.drive.id,
    file_size_bytes: u.drive.size,
    duration_s: u.duration_s,
    version: 1,
    supersedes_id: null,
    is_current: true,
    metadata: u.metadata,
  }));
  const { data: insertedRows, error: insertErr } = await sb
    .from("content_assets")
    .insert(rows)
    .select("id, asset_type, asset_subtype, drive_file_id, version");
  if (insertErr) throw new Error(`content_assets insert failed: ${insertErr.message}`);
  log(`[persist]   inserted ${insertedRows?.length ?? 0} rows`);

  // Update content_queue
  const finalAssetUrl = uploaded.find((u) => u.asset_type === "final_mp4")?.drive.webViewLink ?? null;
  const { error: updateErr } = await sb
    .from("content_queue")
    .update({
      render_status: "ready",
      render_completed_at: new Date().toISOString(),
      final_asset_url: finalAssetUrl,
    })
    .eq("id", args.contentId);
  if (updateErr) throw new Error(`content_queue update failed: ${updateErr.message}`);
  log(`[persist] content_queue updated`);

  // Output
  const folderUrl = `https://drive.google.com/drive/folders/${slugFolderId}`;
  process.stdout.write(JSON.stringify({
    status: "success",
    mode: "persist",
    content_id: args.contentId,
    drive_folder_url: folderUrl,
    drive_folder_id: slugFolderId,
    drive_folder_path: `${args.parentPath.join("/")}/Produced/${slug}`,
    artifacts_persisted: uploaded.length,
    asset_rows: insertedRows ?? [],
    final_mp4_url: finalAssetUrl,
  }, null, 2) + "\n");
}

// ---- Main ----

async function main() {
  switch (args.mode) {
    case "persist": return runPersist();
    case "re_render": throw new Error("re_render mode not implemented in v1");
    case "publish": throw new Error("publish mode not implemented in v1");
    default: throw new Error(`unknown mode: ${args.mode}`);
  }
}

main().catch((e) => {
  process.stderr.write(`[fatal] ${e.stack || e.message}\n`);
  process.exit(1);
});
