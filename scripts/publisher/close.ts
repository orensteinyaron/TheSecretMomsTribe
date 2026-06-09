/**
 * CLI: close a channel after the human acts (skill §1.3-1.4, §5A).
 *
 *   # Yaron clicked publish; record the result:
 *   npx tsx scripts/publisher/close.ts --content-id <uuid> --channel instagram \
 *       --post-url https://instagram.com/p/XXXX --external-id 1789...
 *
 *   # Or record a deterministic skip / fail:
 *   npx tsx scripts/publisher/close.ts --content-id <uuid> --channel tiktok --skip --reason tiktok_web_photo_unsupported
 *   npx tsx scripts/publisher/close.ts --content-id <uuid> --channel instagram --fail --reason composer_upload_error
 *
 * markPosted is idempotent and atomic; if the permalink or id is missing the row
 * is LEFT in place (never marked posted) for manual reconcile. Needs
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { createLifecycle, SupabaseLifecycleStore } from '../../lib/lifecycle/index.js';
import { closeChannel, failChannel, skipChannel } from '../../lib/publisher/index.js';
import type { Channel } from '../../lib/lifecycle/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const contentId = arg('--content-id');
  const channel = arg('--channel') as Channel | undefined;
  if (!contentId || !channel) throw new Error('usage: close.ts --content-id <uuid> --channel <instagram|tiktok> ...');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const lifecycle = createLifecycle(new SupabaseLifecycleStore(createClient(url, key, { auth: { persistSession: false } })));

  let result;
  if (flag('--skip')) {
    result = await skipChannel(lifecycle, contentId, channel, arg('--reason') ?? 'skipped');
  } else if (flag('--fail')) {
    result = await failChannel(lifecycle, contentId, channel, arg('--reason') ?? 'failed');
  } else {
    result = await closeChannel(lifecycle, {
      contentId, channel, postUrl: arg('--post-url') ?? null, externalPostId: arg('--external-id') ?? null,
    });
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
