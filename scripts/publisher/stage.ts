/**
 * CLI: resolve and stage a due piece's channels (skill §2 resolve-assets/publish).
 *
 *   npx tsx scripts/publisher/stage.ts --content-id <uuid> [--channel instagram|tiktok]
 *                                      [--tiktok-slideshow] [--dry-run]
 *
 * For each channel of the piece it computes the deterministic plan:
 *   - 'stage' → downloads the asset to a local temp file and prints a StagingPlan
 *     (composer URL + asset path + caption + media). The browser agent (Claude in
 *     Chrome) then opens the composer, uploads, pastes the caption, and STOPS at
 *     the publish button. This script never drives the browser and never posts.
 *   - 'skip' / 'fail' → these are deterministic, so the script writes them via the
 *     lifecycle module now (or, with --dry-run, only prints the intent).
 *   - 'noop' → printed, nothing written.
 *
 * After Yaron clicks publish, run scripts/publisher/close.ts with the permalink.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  BrowserAssistedProvider,
  failChannel,
  planPiece,
  selectDuePieces,
  skipChannel,
} from '../../lib/publisher/index.js';
import { createLifecycle, SupabaseLifecycleStore } from '../../lib/lifecycle/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function downloadAsset(url: string, contentId: string, channel: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset download ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'smt-publish-'));
  const ext = url.split('.').pop()?.split('?')[0] || 'bin';
  const path = join(dir, `${contentId}-${channel}.${ext}`);
  writeFileSync(path, buf);
  return path;
}

async function main(): Promise<void> {
  const contentId = arg('--content-id');
  if (!contentId) throw new Error('usage: stage.ts --content-id <uuid> [--channel ..] [--dry-run]');
  const onlyChannel = arg('--channel');
  const dryRun = flag('--dry-run');
  const opts = { tiktokSlideshow: flag('--tiktok-slideshow') };

  const sb = getClient();
  const now = new Date();
  const piece = (await selectDuePieces(sb, now)).find((p) => p.contentId === contentId);
  if (!piece) throw new Error(`no DUE piece found for content-id ${contentId} (not approved/rendered/due?)`);

  const lifecycle = dryRun ? null : createLifecycle(new SupabaseLifecycleStore(sb));
  const provider = new BrowserAssistedProvider();
  const results: unknown[] = [];

  for (const action of planPiece(piece, now, opts)) {
    if (onlyChannel && action.channel !== onlyChannel) continue;
    if (action.action === 'stage') {
      const assetPath = dryRun ? `(dry-run)${piece.finalAssetUrl}` : await downloadAsset(piece.finalAssetUrl!, contentId, action.channel);
      results.push({ ...provider.buildStagingPlan({ contentId, channel: action.channel, assetPath, caption: action.caption, media: action.media }) });
    } else if (action.action === 'skip') {
      results.push(dryRun || !lifecycle ? { channel: action.channel, wouldSkip: action.reason } : await skipChannel(lifecycle, contentId, action.channel, action.reason ?? 'skipped'));
    } else if (action.action === 'fail') {
      results.push(dryRun || !lifecycle ? { channel: action.channel, wouldFail: action.reason } : await failChannel(lifecycle, contentId, action.channel, action.reason ?? 'failed'));
    } else {
      results.push({ channel: action.channel, noop: action.reason });
    }
  }

  console.log(JSON.stringify({ contentId, dryRun, results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
