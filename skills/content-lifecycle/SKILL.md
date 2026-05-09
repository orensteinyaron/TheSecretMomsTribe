---
name: content-lifecycle
description: Persists content artifacts produced by any SMT profile skill (full-avatar-profile, moving-images, etc.) into Google Drive and Supabase. Handles upload, folder naming, Produced/Published moves, and versioned re-renders via supersedes_id. Profile skills produce files locally and emit a manifest; this skill is what takes that manifest and persists everything. Does not generate content, does not call LLMs.
---

# Content Lifecycle Skill

## Implementation

- CLI: `video/scripts/content-lifecycle.ts`
- Drive helper: `video/lib/drive.ts`
- Run: `npx tsx video/scripts/content-lifecycle.ts --mode persist --content-id <uuid> --manifest <path> --hook-overlay "<text>"`
- v1 implements `mode=persist` only. `re_render` and `publish` are placeholders.

### Drive auth (one-time)

The skill manages its own OAuth flow and token cache. No `rclone`, no `gdrive`, no manual scripts.

**One-time setup before the first run** (~3 min, then never again):
1. Open https://console.cloud.google.com/apis/credentials and pick or create a Google Cloud project.
2. Click **"Create Credentials" → "OAuth client ID"**. Application type **"Desktop app"**, name **"SMT content-lifecycle"**.
3. Click **DOWNLOAD JSON**.
4. `mkdir -p ~/.config/smt && mv ~/Downloads/client_secret_*.json ~/.config/smt/drive-credentials.json`
5. Enable the Drive API in that project: https://console.cloud.google.com/apis/library/drive.googleapis.com

**First skill run**: opens the browser to Google's consent screen. One click to grant access. The skill exchanges the auth code for a refresh token and caches it at `~/.config/smt/drive-token.json` (mode 0600).

**Subsequent runs**: token loaded from disk; access tokens refreshed automatically. Zero user interaction.

If credentials.json is missing on a run, the skill exits with the setup steps above instead of silently continuing.

### Uploads

Uploads go through googleapis with a readable stream — Drive's resumable upload protocol kicks in automatically for large files. Tested up to 45MB; the protocol supports up to 5TB. No request-body size limits to worry about.

## What this skill does

Takes a manifest produced by a profile skill and:
1. Uploads files to Google Drive under the correct folder
2. Writes/updates rows in Supabase `content_assets`
3. Updates the parent `content` row status
4. On publish: moves the folder Produced → Published, renames it
5. On re-render: versions assets via `supersedes_id`, keeps history

This skill is content-agnostic. It works for full-avatar-profile output, moving-images output, or any future profile that produces a manifest matching the input contract below.

## When to use

Primary trigger: a profile skill has just produced a manifest and the caller wants the artifacts persisted.

Modes (one per invocation):
- `mode: persist` — first-time persistence of a new piece. Creates Drive folder under Produced/, uploads files, writes content_assets rows.
- `mode: re_render` — versioned re-render of an existing piece. Renames old Drive files with `.v{n}` suffix, marks old Supabase rows `is_current=false`, uploads new versions, inserts new rows with `supersedes_id`.
- `mode: publish` — moves a Produced folder to Published, renames with publish date, updates content.status.

## When NOT to use

- No manifest provided — return error
- Manifest has no `content_id` — return error
- Drive or Supabase credentials missing — return error
- Caller asks to generate content — wrong skill, return error

## Inputs

```json
{
  "mode": "persist | re_render | publish",
  "content_id": "uuid",
  "manifest_path": "/abs/path/to/work_dir/manifest.json",
  "publish_date": "2026-05-09 (only for mode=publish)"
}
```

The manifest itself comes from the profile skill. Required fields in any manifest:
```json
{
  "status": "success",
  "work_dir": "/abs/path",
  "render_params": { "character_id": "...", ... },
  "artifacts": [
    { "type": "final_mp4", "path": "final.mp4", ... },
    { "type": "thumbnail", "path": "thumbnail.png", ... },
    ...
  ]
}
```

This skill also reads `script.hook_overlay` from the parent content row in Supabase to build the folder slug. The profile skill does not need to provide it.

## Drive folder structure

Account: Yarono. Root path: `My Drive/SMT/Content/`

```
SMT/Content/
  Produced/
    {hook_slug}_{produced_date}_{content_id_short}/
      manifest.json
      final.mp4
      thumbnail.png
      hook_card.png
      qa_report.md
      audio/scene_1.mp3, ...
      clips/scene_1.mp4, ...
  Published/
    {hook_slug}_{published_date}_{content_id_short}/
      (same contents, folder moved + renamed on publish)
```

Folder slug:
- `hook_slug` — content.script.hook_overlay lowercased, spaces → hyphens, non-alphanumerics stripped
- `produced_date` / `published_date` — `YYYY-MM-DD`
- `content_id_short` — first 4 chars of content_id UUID
- example: `how-i-get-my-teen-talking_2026-05-09_a4f2`

## Pipeline per mode

### mode: persist
1. Read manifest from `manifest_path`
2. Read content row from Supabase to get `hook_overlay`
3. Build folder slug: `{hook_slug}_{today}_{content_id_short}`
4. Create Drive folder under `SMT/Content/Produced/{slug}/`
5. For each artifact: upload to Drive at the relative path from manifest, capture Drive file_id and shareable URL
6. Upload `manifest.json` itself to the folder root
7. For each artifact: insert `content_assets` row with `version=1`, `is_current=true`, `supersedes_id=null`, `storage_provider="google_drive"`, `storage_url`, `storage_path`
8. Update `content` row: `status='ready'`, `final_mp4_url`, `thumbnail_url`, `produced_at=now()`
9. Return success with Drive folder URL + asset summary

### mode: re_render
1. Read manifest from `manifest_path`
2. Look up existing Drive folder for content_id (find via Supabase `content_assets` where content_id matches and is_current=true — read `storage_path`)
3. For each artifact in manifest:
   - Find current Drive file at the artifact's relative path
   - Rename current Drive file from `final.mp4` → `final.v{n}.mp4` (where n is current version)
   - Mark current Supabase row `is_current=false`
   - Upload new file to the unsuffixed path
   - Insert new `content_assets` row with `version=n+1`, `is_current=true`, `supersedes_id={old_row_id}`
4. Replace `manifest.json` in the folder with the new manifest (old one renamed `manifest.v{n}.json`)
5. Update `content` row: bump `last_rendered_at`
6. Return success with new Drive URLs + supersedes chain

### mode: publish
1. Look up Drive folder for content_id (current Produced folder)
2. Build new slug with `published_date` instead of `produced_date`
3. Move folder from `SMT/Content/Produced/{old_slug}/` to `SMT/Content/Published/{new_slug}/`
4. Update Drive folder name in-place
5. Drive file_ids inside the folder stay stable, so Supabase `storage_url` values keep working — no row updates needed for individual assets
6. Update Supabase `content_assets.storage_path` for all current assets of this content_id (just the path string, not the URLs)
7. Update `content` row: `status='published'`, `published_at=now()`
8. Return success with new Drive folder URL

## Hard rules

- **Never delete Drive files.** Re-renders rename, never destroy. Failed uploads can leave orphans — those are fine, surface them but do not auto-clean.
- **Never write Supabase rows pointing to non-existent Drive files.** Upload first, write row second. If Drive upload fails, do not write the row.
- **Folder file_ids are stable across renames/moves.** Drive renaming preserves file_id, so `storage_url` stays valid. Only `storage_path` (the human-readable path) changes on publish.
- **Atomic per-artifact, not per-piece.** If 3 of 8 artifacts upload then the 4th fails, the 3 stay uploaded and their rows stay written. Surface partial failure to caller. Do not roll back.
- **Versioning is monotonic.** Re-render always increments version, never reuses or decrements. supersedes_id chain is append-only.

## content_assets schema

```sql
content_assets (
  id              uuid primary key,
  content_id      uuid not null references content(id),
  asset_type      text not null,  -- final_mp4 | thumbnail | hook_card | scene_audio | scene_clip | qa_report | manifest
  asset_subtype   text,           -- nullable, e.g. SCENE_1 for per-scene assets
  storage_provider text not null, -- "google_drive"
  storage_url     text not null,  -- Drive shareable link
  storage_path    text not null,  -- human-readable path
  drive_file_id   text not null,  -- stable Drive file ID
  file_size_bytes bigint,
  duration_s      numeric,
  version         int not null default 1,
  supersedes_id   uuid references content_assets(id),
  is_current      boolean not null default true,
  metadata        jsonb,          -- render_params, higgsfield_job_id, etc.
  created_at      timestamptz not null default now()
);

-- Exactly one current version per (content_id, asset_type, asset_subtype)
create unique index content_assets_current_unique
  on content_assets (content_id, asset_type, coalesce(asset_subtype, ''))
  where is_current = true;
```

## Outputs

```json
{
  "status": "success",
  "mode": "persist",
  "content_id": "uuid",
  "drive_folder_url": "https://drive.google.com/drive/folders/...",
  "drive_folder_path": "SMT/Content/Produced/how-i-get-my-teen-talking_2026-05-09_a4f2",
  "artifacts_persisted": 14,
  "asset_rows": [
    { "id": "uuid", "asset_type": "final_mp4", "version": 1, "drive_file_id": "..." },
    ...
  ]
}
```

On failure:
```json
{
  "status": "error",
  "stage": "drive_upload | supabase_write | folder_move",
  "error": "human-readable message",
  "partial_persisted": [...]
}
```

## What this skill does NOT do

- Generate content (that's the profile skills)
- Call LLMs
- Decide when to publish (that's the orchestrator / human)
- Trigger re-renders (caller decides)
- Modify the manifest itself

## Failure modes

| Failure | Action |
|---|---|
| Drive upload fails mid-batch | Continue with remaining files, return partial success, list orphaned + persisted |
| Supabase write fails for one row | Surface immediately, do not roll back Drive uploads |
| Drive folder already exists in persist mode | Hard fail — content_id should be unique, suggests duplicate run |
| Drive folder not found in re_render or publish mode | Hard fail — caller has stale state |
| Race condition on simultaneous re_renders | Second insert fails on partial unique index, second run's Drive upload becomes orphan, surface to caller |
| Hook_overlay missing on content row | Hard fail — required for folder slug |

## Version

v1.0 — May 9, 2026.
