/**
 * CLI: list the work that is due (skill §2).
 *
 *   npx tsx scripts/publisher/select.ts
 *
 * Prints one DuePiece per approved + rendered piece that has at least one
 * pending/scheduled, due channel. Read-only. Needs SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { planPiece, selectDuePieces } from '../../lib/publisher/index.js';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main(): Promise<void> {
  const now = new Date();
  const pieces = await selectDuePieces(getClient(), now);
  const out = pieces.map((p) => ({
    contentId: p.contentId,
    renderProfileSlug: p.renderProfileSlug,
    pillar: p.pillar,
    plan: planPiece(p, now),
  }));
  console.log(JSON.stringify({ now: now.toISOString(), count: pieces.length, pieces: out }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
