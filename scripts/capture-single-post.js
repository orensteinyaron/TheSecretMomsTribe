import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) { console.error('Missing APIFY_TOKEN'); process.exit(1); }

const url = process.argv[2];
if (!url) { console.error('Usage: node capture-single-post.js <url>'); process.exit(1); }

const client = new ApifyClient({ token: APIFY_TOKEN });

const run = await client.actor('apify/instagram-scraper').call({
  directUrls: [url],
  resultsType: 'details',
  resultsLimit: 1,
  addParentData: false,
});

import { writeFileSync } from 'fs';
const { items } = await client.dataset(run.defaultDatasetId).listItems();
const out = process.argv[3] || '/tmp/smt_capture.json';
writeFileSync(out, JSON.stringify(items, null, 2));
console.error('WROTE', out, items.length, 'items');
