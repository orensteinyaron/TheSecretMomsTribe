/**
 * CAPTURE (skill §1) — pull a source piece into a structured CaptureObject.
 *
 * Deterministic orchestration with injected network deps:
 *   - open web   → fetchWeb (web_fetch equivalent), first.
 *   - instagram  → Apify `apify/instagram-post-scraper` (direct fetch is blocked).
 *   - tiktok     → Apify `clockworks/free-tiktok-scraper` (locked by the build plan).
 *
 * No LLM here — capture is scrapers + parsing. Partial captures throw
 * CaptureIncompleteError so the skill can fall back to screenshots-in-chat
 * rather than fabricating what the source "probably" said.
 */

import { detectPlatform } from './platform.js';
import type { CaptureDeps, CaptureObject, CaptureSlide, SourceFormat } from './types.js';

export const APIFY_ACTORS = {
  instagram: 'apify/instagram-post-scraper',
  tiktok: 'clockworks/free-tiktok-scraper',
} as const;

export class CaptureIncompleteError extends Error {
  readonly code = 'capture_incomplete';
  readonly partial: Partial<CaptureObject>;
  constructor(message: string, partial: Partial<CaptureObject>) {
    super(`[create-from-url] capture_incomplete: ${message}`);
    this.name = 'CaptureIncompleteError';
    this.partial = partial;
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  return [...caption.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
}
function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return line ?? null;
}

export async function capture(url: string, deps: CaptureDeps): Promise<CaptureObject> {
  const platform = detectPlatform(url);
  if (platform === 'web') return captureWeb(url, deps);
  const actor = APIFY_ACTORS[platform];
  const input =
    platform === 'instagram'
      ? { directUrls: [url], resultsLimit: 1 }
      : { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false };
  const items = await deps.runApifyActor(actor, input);
  const item = items?.[0] as Record<string, unknown> | undefined;
  if (!item) {
    throw new CaptureIncompleteError(`${actor} returned no items for ${url}`, { source_url: url, platform });
  }
  return platform === 'instagram' ? normalizeInstagram(item, url) : normalizeTiktok(item, url);
}

async function captureWeb(url: string, deps: CaptureDeps): Promise<CaptureObject> {
  const { text, title } = await deps.fetchWeb(url);
  const caption = str(text);
  if (!caption) {
    throw new CaptureIncompleteError(`web_fetch returned no text for ${url}`, { source_url: url, platform: 'web' });
  }
  return {
    source_url: url,
    platform: 'web',
    creator_handle: null,
    engagement: {},
    format: 'image',
    slides: [],
    transcript_or_script: caption,
    on_screen_text: null,
    hook: str(title) ?? firstLine(caption),
    caption,
    hashtags: extractHashtags(caption),
    complete: true,
  };
}

function igFormat(type: unknown): SourceFormat {
  if (type === 'Sidecar') return 'carousel';
  if (type === 'Video') return 'video';
  return 'image';
}

function normalizeInstagram(item: Record<string, unknown>, url: string): CaptureObject {
  const caption = str(item.caption);
  const format = igFormat(item.type);
  const children = Array.isArray(item.childPosts) ? (item.childPosts as Record<string, unknown>[]) : [];
  const slides: CaptureSlide[] =
    format === 'carousel'
      ? children.map((c, i) => ({
          index: i,
          on_screen_text: '',
          image_description: str(c.alt) ?? str(c.type) ?? `slide ${i + 1}`,
        }))
      : [];
  const creator = str(item.ownerUsername) ?? str(item.ownerFullName);
  const result: CaptureObject = {
    source_url: url,
    platform: 'instagram',
    creator_handle: creator,
    engagement: { likes: num(item.likesCount), comments: num(item.commentsCount), views: num(item.videoViewCount) },
    format,
    slides,
    transcript_or_script: format === 'video' ? str(item.caption) : null,
    on_screen_text: null,
    hook: firstLine(caption),
    caption,
    hashtags: Array.isArray(item.hashtags) ? (item.hashtags as string[]) : extractHashtags(caption),
    complete: Boolean(caption || slides.length > 0),
  };
  if (!result.complete) {
    throw new CaptureIncompleteError(`instagram post had no caption or slides (${url})`, result);
  }
  return result;
}

function normalizeTiktok(item: Record<string, unknown>, url: string): CaptureObject {
  const caption = str(item.text);
  const author = (item.authorMeta as Record<string, unknown> | undefined) ?? {};
  const creator = str(author.name) ?? str(author.nickName);
  const result: CaptureObject = {
    source_url: url,
    platform: 'tiktok',
    creator_handle: creator,
    engagement: {
      views: num(item.playCount),
      likes: num(item.diggCount),
      comments: num(item.commentCount),
      shares: num(item.shareCount),
    },
    format: 'video',
    slides: [],
    transcript_or_script: caption,
    on_screen_text: null,
    hook: firstLine(caption),
    caption,
    hashtags: extractHashtags(caption),
    complete: Boolean(caption),
  };
  if (!result.complete) {
    throw new CaptureIncompleteError(`tiktok post had no text/caption (${url})`, result);
  }
  return result;
}
