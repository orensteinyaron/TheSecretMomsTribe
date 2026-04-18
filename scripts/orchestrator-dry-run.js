/**
 * Orchestrator V2 dry-run — evaluates eligibility for every agent
 * against the configured Supabase DB and prints the decision matrix.
 *
 * Does NOT spawn agents or write to agent_runs. Read-only safe.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/orchestrator-dry-run.js
 */

import { supabase } from '../agents/lib/supabase.js';
import { isEligibleToRun, topoSortAgents } from '../agents/lib/schedule.js';

const now = new Date();
console.log(`[dry-run] now = ${now.toISOString()}`);

const { data: agents, error } = await supabase
  .from('agents')
  .select('*')
  .order('created_at', { ascending: true });
if (error) { console.error(error); process.exit(1); }

const sorted = topoSortAgents(agents);
console.log(`[dry-run] ${sorted.length} agent(s) in topo order: ${sorted.map(a => a.slug).join(' → ')}\n`);

for (const agent of sorted) {
  const eligibility = await isEligibleToRun(agent, now, supabase);
  const mark = eligibility.eligible ? 'RUN' : 'skip';
  const extra = eligibility.missing ? ` missing=${JSON.stringify(eligibility.missing)}` : '';
  console.log(`  [${mark}] ${agent.slug.padEnd(22)} schedule="${agent.schedule}"  reason=${eligibility.reason}${extra}`);
}

process.exit(0);
