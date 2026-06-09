/**
 * CLI: enqueue an approved remix concept onto the rails (skill §7).
 *
 *   npx tsx scripts/create-from-url/enqueue.ts <plan.json> --approved
 *   cat plan.json | npx tsx scripts/create-from-url/enqueue.ts - --approved
 *
 * The plan JSON is a RemixEnqueuePlan WITHOUT `approved` — approval is conferred
 * ONLY by the explicit `--approved` flag (fail-closed; a JSON file can never
 * silently auto-approve a piece). Without it, the piece enqueues as
 * 'pending_approval'. This represents approval #2, the human gate.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Prints the verified result.
 */

import { readFileSync } from 'node:fs';
import { createLifecycle, SupabaseLifecycleStore } from '../../lib/lifecycle/index.js';
import { enqueueRemix } from '../../lib/create-from-url/index.js';
import type { RemixEnqueuePlan } from '../../lib/create-from-url/types.js';

function readPlan(): Omit<RemixEnqueuePlan, 'approved'> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const path = positional[0];
  const raw = path && path !== '-' ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  return JSON.parse(raw) as Omit<RemixEnqueuePlan, 'approved'>;
}

async function main(): Promise<void> {
  const approved = process.argv.includes('--approved');
  const plan: RemixEnqueuePlan = { ...readPlan(), approved };

  const lifecycle = createLifecycle(new SupabaseLifecycleStore());
  const result = await enqueueRemix(plan, lifecycle);
  console.log(
    JSON.stringify(
      {
        contentId: result.contentId,
        approved,
        skipped: result.skipped,
        channels: result.scheduledPosts.map((r) => ({ channel: r.channel, status: r.status })),
        postCheck: result.postCheck,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
