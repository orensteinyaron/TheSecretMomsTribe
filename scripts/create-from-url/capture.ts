/**
 * CLI: capture a source URL into a CaptureObject (skill §1).
 *
 *   npx tsx scripts/create-from-url/capture.ts <url>
 *
 * web  → node fetch + crude HTML→text (the skill prefers live web_fetch; this is
 *        the deterministic helper).
 * IG   → Apify apify/instagram-post-scraper   (needs APIFY_TOKEN)
 * TT   → Apify clockworks/free-tiktok-scraper (needs APIFY_TOKEN)
 *
 * Prints the CaptureObject as JSON. On a partial capture it exits non-zero with
 * a capture_incomplete message so the operator falls back to screenshots-in-chat.
 */

import { ApifyClient } from 'apify-client';
import { capture } from '../../lib/create-from-url/index.js';
import type { CaptureDeps } from '../../lib/create-from-url/types.js';

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

async function fetchWeb(url: string): Promise<{ text: string; title?: string }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`web fetch ${res.status} for ${url}`);
  const html = await res.text();
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return { text: htmlToText(html), title };
}

function makeApifyRunner(): CaptureDeps['runApifyActor'] {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return async () => {
      throw new Error('APIFY_TOKEN is required to capture Instagram/TikTok sources');
    };
  }
  const client = new ApifyClient({ token });
  return async (actorId, input) => {
    const run = await client.actor(actorId).call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
  };
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: tsx scripts/create-from-url/capture.ts <url>');
    process.exit(1);
  }
  const deps: CaptureDeps = { fetchWeb, runApifyActor: makeApifyRunner() };
  const result = await capture(url, deps);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
