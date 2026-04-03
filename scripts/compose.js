/**
 * SMT Image Composition Script
 *
 * Composites brand typography onto DALL-E background images using Sharp.
 * Zero LLM tokens — pure image processing.
 *
 * Flow:
 *   1. Query content_queue WHERE status=approved AND image_status=generated AND not yet composed
 *   2. Download bg image, resize to target dimensions
 *   3. Overlay gradient + text SVG (hook, pillar chip, handle)
 *   4. Upload final composite to Supabase Storage
 *   5. Update content_queue with final image URL
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/compose.js
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { logCost } from './utils/cost-logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Dimensions by format ---

const DIMENSIONS = {
  tiktok_slideshow: { width: 1080, height: 1920 },
  tiktok_text: { width: 1080, height: 1920 },
  ig_carousel: { width: 1080, height: 1350 },
  ig_static: { width: 1080, height: 1350 },
  ig_meme: { width: 1080, height: 1350 },
  video_script: { width: 1080, height: 1350 },
};

const PILLAR_COLORS = {
  ai_magic: '#B8A9C9',
  parenting_insights: '#C9A090',
  tech_for_moms: '#D4A853',
  mom_health: '#8B9E8B',
  trending: '#74B9FF',
};

const PILLAR_LABELS = {
  ai_magic: 'AI Magic',
  parenting_insights: 'Parenting',
  tech_for_moms: 'Tech for Moms',
  mom_health: 'Mom Health',
  trending: 'Trending',
};

// --- Text utilities ---

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wordWrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxChars && currentLine) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? ' ' : '') + word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines;
}

// --- SVG generators ---

function createGradientOverlay(width, height) {
  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="black" stop-opacity="0.3"/>
          <stop offset="40%" stop-color="black" stop-opacity="0.1"/>
          <stop offset="60%" stop-color="black" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="black" stop-opacity="0.4"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
    </svg>
  `);
}

function createTextOverlayTikTok(width, height, { hook, pillar }) {
  const pillarColor = PILLAR_COLORS[pillar] || '#666';
  const pillarLabel = PILLAR_LABELS[pillar] || pillar || '';
  const lines = wordWrap(hook || '', 22);
  const lineHeight = 58;
  const startY = (height - lines.length * lineHeight) / 2;

  // Pillar chip dimensions
  const chipWidth = pillarLabel.length * 10 + 24;

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .hook { font-family: Georgia, serif; font-size: 48px; font-weight: bold; fill: white; text-anchor: middle; }
        .handle { font-family: Helvetica, sans-serif; font-size: 18px; fill: rgba(255,255,255,0.5); text-anchor: middle; }
        .chip-text { font-family: Helvetica, sans-serif; font-size: 14px; font-weight: bold; fill: white; }
      </style>
      ${pillarLabel ? `
        <rect x="32" y="32" width="${chipWidth}" height="28" rx="14" fill="${pillarColor}"/>
        <text x="${32 + chipWidth / 2}" y="51" class="chip-text" text-anchor="middle">${escapeXml(pillarLabel)}</text>
      ` : ''}
      ${lines.map((line, i) =>
        `<text x="${width / 2}" y="${startY + i * lineHeight}" class="hook">${escapeXml(line)}</text>`
      ).join('\n      ')}
      <text x="${width / 2}" y="${height - 60}" class="handle">@thesecretmomstribe</text>
    </svg>
  `);
}

function createTextOverlayCarousel(width, height, { hook, pillar }) {
  const pillarColor = PILLAR_COLORS[pillar] || '#666';
  const pillarLabel = PILLAR_LABELS[pillar] || pillar || '';
  const lines = wordWrap(hook || '', 24);
  const lineHeight = 52;
  const startY = (height - lines.length * lineHeight) / 2;

  const chipWidth = pillarLabel.length * 10 + 24;

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .hook { font-family: Georgia, serif; font-size: 42px; font-weight: bold; fill: white; text-anchor: middle; }
        .handle { font-family: Helvetica, sans-serif; font-size: 18px; fill: rgba(255,255,255,0.5); text-anchor: middle; }
        .swipe { font-family: Helvetica, sans-serif; font-size: 16px; fill: rgba(255,255,255,0.4); text-anchor: middle; }
        .chip-text { font-family: Helvetica, sans-serif; font-size: 14px; font-weight: bold; fill: white; }
      </style>
      ${pillarLabel ? `
        <rect x="32" y="32" width="${chipWidth}" height="28" rx="14" fill="${pillarColor}"/>
        <text x="${32 + chipWidth / 2}" y="51" class="chip-text" text-anchor="middle">${escapeXml(pillarLabel)}</text>
      ` : ''}
      ${lines.map((line, i) =>
        `<text x="${width / 2}" y="${startY + i * lineHeight}" class="hook">${escapeXml(line)}</text>`
      ).join('\n      ')}
      <text x="${width / 2}" y="${height - 90}" class="swipe">Swipe →</text>
      <text x="${width / 2}" y="${height - 60}" class="handle">@thesecretmomstribe</text>
    </svg>
  `);
}

function createTextOverlayStatic(width, height, { hook }) {
  const quotedHook = `\u201C${hook || ''}\u201D`;
  const lines = wordWrap(quotedHook, 24);
  const lineHeight = 54;
  const startY = (height - lines.length * lineHeight) / 2;

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .hook { font-family: Georgia, serif; font-size: 44px; font-weight: bold; fill: white; text-anchor: middle; }
        .handle { font-family: Helvetica, sans-serif; font-size: 18px; fill: rgba(255,255,255,0.5); text-anchor: middle; }
      </style>
      ${lines.map((line, i) =>
        `<text x="${width / 2}" y="${startY + i * lineHeight}" class="hook">${escapeXml(line)}</text>`
      ).join('\n      ')}
      <text x="${width / 2}" y="${height - 60}" class="handle">@thesecretmomstribe</text>
    </svg>
  `);
}

function createTextOverlay(width, height, post) {
  const format = post.post_format;
  const opts = { hook: post.hook, pillar: post.content_pillar };

  if (format === 'tiktok_slideshow' || format === 'tiktok_text') {
    return createTextOverlayTikTok(width, height, opts);
  }
  if (format === 'ig_carousel') {
    return createTextOverlayCarousel(width, height, opts);
  }
  // ig_static, ig_meme, video_script
  return createTextOverlayStatic(width, height, opts);
}

// --- Composition ---

async function composePost(post) {
  const dims = DIMENSIONS[post.post_format] || { width: 1080, height: 1350 };
  const bgUrl = post.image_url;

  console.log(`[Compose] Processing ${post.id} (${post.post_format}, ${dims.width}x${dims.height})...`);

  // Download background
  const bgResponse = await fetch(bgUrl);
  if (!bgResponse.ok) throw new Error(`Failed to download bg: ${bgResponse.status}`);
  const bgBuffer = Buffer.from(await bgResponse.arrayBuffer());

  // Create overlays
  const gradient = createGradientOverlay(dims.width, dims.height);
  const textOverlay = createTextOverlay(dims.width, dims.height, post);

  // Composite
  const result = await sharp(bgBuffer)
    .resize(dims.width, dims.height, { fit: 'cover' })
    .composite([
      { input: gradient, blend: 'over' },
      { input: textOverlay, blend: 'over' },
    ])
    .png()
    .toBuffer();

  // Upload to Supabase Storage
  const filename = `${post.id}-final-${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from('post-images')
    .upload(filename, result, { contentType: 'image/png', upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(filename);
  const finalUrl = urlData.publicUrl;

  // Update content_queue
  const metadata = { ...(post.metadata || {}), bg_url: bgUrl, composed: true };
  const { error: dbError } = await supabase
    .from('content_queue')
    .update({ image_url: finalUrl, metadata })
    .eq('id', post.id);

  if (dbError) throw new Error(`DB update failed: ${dbError.message}`);

  // Log cost ($0 — this is local processing)
  await logCost(supabase, {
    pipeline_stage: 'image_composition',
    service: 'sharp',
    model: 'compose',
    content_id: post.id,
    description: `Composed ${post.post_format} image`,
    metadata: { width: dims.width, height: dims.height },
  });

  console.log(`[Compose] ${post.id}: uploaded ${finalUrl}`);
  return finalUrl;
}

// --- Main ---

async function main() {
  console.log('[Compose] Starting image composition for approved posts...');
  const startTime = Date.now();

  // Find posts with generated images that haven't been composed yet
  const { data: posts, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('status', 'approved')
    .eq('image_status', 'generated')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Compose] Query failed:', error);
    process.exit(1);
  }

  // Filter to only uncomposed posts
  const uncomposed = (posts || []).filter(p => {
    const meta = p.metadata || {};
    return !meta.composed && p.image_url;
  });

  if (uncomposed.length === 0) {
    console.log('[Compose] No posts needing composition. Done.');
    process.exit(0);
  }

  console.log(`[Compose] Found ${uncomposed.length} post(s) to compose`);

  let success = 0;
  let fail = 0;

  for (const post of uncomposed) {
    try {
      await composePost(post);
      success++;
    } catch (err) {
      console.error(`[Compose] ${post.id} FAILED: ${err.message}`);
      fail++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Compose] Done in ${elapsed}s. ${success} succeeded, ${fail} failed.`);
}

main().catch(err => {
  console.error('[Compose] Fatal error:', err);
  process.exit(1);
});
