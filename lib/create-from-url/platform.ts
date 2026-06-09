/**
 * Platform detection for a source URL. Deterministic; no network.
 *
 * Instagram and TikTok block direct fetch (robots-disallowed) — the skill routes
 * those straight to the Apify path. Everything else is treated as open web.
 */

import type { SourcePlatform } from './types.js';

export function detectPlatform(rawUrl: string): SourcePlatform {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    throw new Error(`[create-from-url] not a valid URL: ${rawUrl}`);
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  return 'web';
}
