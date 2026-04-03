/**
 * SMT Image Composition Pipeline — Two-Track System
 *
 * Track 1: Branded Background (NO DALL-E) — text-heavy posts
 *   Pure SVG + Sharp. Zero API cost. Clean editorial look.
 *
 * Track 2: Photo Background (DALL-E) — scene-based posts
 *   DALL-E bg + gradient + text overlay via Sharp.
 *
 * Most posts use Track 1. Only posts with scene-based image_prompts use Track 2.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/compose.js
 */

import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { logCost } from './utils/cost-logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Brand Config (Visual Design Guide) ───

const PILLAR_ACCENT = {
  ai_magic: '#B8A9C9',
  parenting_insights: '#C9A090',
  tech_for_moms: '#D4A853',
  mom_health: '#8B9E8B',
  trending: '#74B9FF',
};

const PILLAR_LABEL = {
  ai_magic: 'AI MAGIC',
  parenting_insights: 'PARENTING',
  tech_for_moms: 'TECH FOR MOMS',
  mom_health: 'MOM HEALTH',
  trending: 'TRENDING',
};

// Dark variant: mom_health, trending, ai_magic
// Light variant: parenting_insights, tech_for_moms
const DARK_PILLARS = new Set(['mom_health', 'trending', 'ai_magic']);

const DIMS = {
  tiktok_slideshow: { w: 1080, h: 1920 },
  tiktok_text: { w: 1080, h: 1920 },
  ig_carousel: { w: 1080, h: 1350 },
  ig_static: { w: 1080, h: 1350 },
  ig_meme: { w: 1080, h: 1350 },
};

const TEXT_SIZE = {
  ig_static: { fontSize: 48, maxWidth: 900, lineHeight: 62, maxChars: 28 },
  ig_carousel: { fontSize: 44, maxWidth: 880, lineHeight: 58, maxChars: 30 },
  ig_meme: { fontSize: 48, maxWidth: 900, lineHeight: 62, maxChars: 28 },
  tiktok_text: { fontSize: 52, maxWidth: 920, lineHeight: 66, maxChars: 26 },
  tiktok_slideshow: { fontSize: 50, maxWidth: 900, lineHeight: 64, maxChars: 27 },
};

// ─── Text Utilities ───

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
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Track 1: Branded Background (pure SVG, no DALL-E) ───

function createBrandedBackground(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;
  const { w, h } = dims;
  const ts = TEXT_SIZE[post.post_format] || TEXT_SIZE.ig_static;
  const isDark = DARK_PILLARS.has(post.content_pillar);
  const accent = PILLAR_ACCENT[post.content_pillar] || '#888';
  const label = PILLAR_LABEL[post.content_pillar] || '';

  // Colors
  const bgColor = isDark ? '#0F0F23' : '#FFF8F0';
  const glowColor = isDark ? '#1A1A2E' : '#FFF5E8';
  const textColor = isDark ? '#F8F8FF' : '#1A1A2E';
  const mutedColor = isDark ? 'rgba(248,248,255,0.20)' : 'rgba(26,26,46,0.15)';
  const accentMuted = isDark ? accent : accent;

  // Word wrap hook
  const hookLines = wordWrap(post.hook || '', ts.maxChars);
  const totalHookHeight = hookLines.length * ts.lineHeight;
  const hookStartY = (h / 2) - (totalHookHeight / 2) + ts.fontSize * 0.35;

  // Pillar chip position
  const cx = w / 2;
  const labelWidth = label.length * 9.5 + 28;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${w}" height="${h}" fill="${bgColor}"/>

  <!-- Subtle radial glow -->
  <defs>
    <radialGradient id="glow" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="${glowColor}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${bgColor}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>

  <!-- Pillar accent line -->
  <rect x="${cx - 50}" y="${hookStartY - 100}" width="100" height="3" rx="1.5" fill="${accentMuted}"/>

  <!-- Pillar label -->
  ${label ? `<text x="${cx}" y="${hookStartY - 70}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${accentMuted}" text-anchor="middle" letter-spacing="2">${escapeXml(label)}</text>` : ''}

  <!-- Hook text -->
  ${hookLines.map((line, i) => `<text x="${cx}" y="${hookStartY + i * ts.lineHeight}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="${textColor}" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Decorative divider -->
  <text x="${cx}" y="${hookStartY + totalHookHeight + 30}" font-family="Georgia, serif" font-size="18" fill="${mutedColor}" text-anchor="middle">&#x2014; &#x2726; &#x2014;</text>

  <!-- Handle -->
  <text x="${cx}" y="${h - 52}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="${mutedColor}" text-anchor="middle">@thesecretmomstribe</text>
</svg>`;

  return sharp(Buffer.from(svg))
    .png({ quality: 95 })
    .toBuffer();
}

// ─── Track 2: Photo Background with overlay ───

function createGradientOverlay(w, h) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0.45"/>
      <stop offset="30%" stop-color="black" stop-opacity="0.15"/>
      <stop offset="70%" stop-color="black" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`);
}

function createPhotoTextOverlay(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;
  const { w, h } = dims;
  const ts = TEXT_SIZE[post.post_format] || TEXT_SIZE.ig_static;
  const accent = PILLAR_ACCENT[post.content_pillar] || '#888';
  const label = PILLAR_LABEL[post.content_pillar] || '';

  const hookLines = wordWrap(post.hook || '', ts.maxChars);
  const totalHookHeight = hookLines.length * ts.lineHeight;
  const hookStartY = (h / 2) - (totalHookHeight / 2) + ts.fontSize * 0.35;

  const cx = w / 2;

  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <!-- Pillar chip -->
  ${label ? `
  <rect x="40" y="44" width="${label.length * 9.5 + 28}" height="30" rx="15" fill="${accent}"/>
  <text x="${40 + 14}" y="64" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="white" letter-spacing="1">${escapeXml(label)}</text>
  ` : ''}

  <!-- Hook text -->
  ${hookLines.map((line, i) => `<text x="${cx}" y="${hookStartY + i * ts.lineHeight}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="#F8F8FF" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Divider -->
  <text x="${cx}" y="${hookStartY + totalHookHeight + 30}" font-family="Georgia, serif" font-size="18" fill="rgba(248,248,255,0.25)" text-anchor="middle">&#x2014; &#x2726; &#x2014;</text>

  <!-- Handle -->
  <text x="${cx}" y="${h - 52}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="rgba(248,248,255,0.30)" text-anchor="middle">@thesecretmomstribe</text>
</svg>`);
}

async function composeWithPhoto(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;

  const bgResponse = await fetch(post.image_url);
  if (!bgResponse.ok) throw new Error(`Failed to download bg: ${bgResponse.status}`);
  const bgBuffer = Buffer.from(await bgResponse.arrayBuffer());

  const gradient = createGradientOverlay(dims.w, dims.h);
  const text = createPhotoTextOverlay(post);

  return sharp(bgBuffer)
    .resize(dims.w, dims.h, { fit: 'cover', position: 'centre' })
    .composite([
      { input: gradient, blend: 'over' },
      { input: text, blend: 'over' },
    ])
    .png({ quality: 95 })
    .toBuffer();
}

// ─── Track Selection ───

const SCENE_KEYWORDS = [
  'hands', 'child', 'mother', 'mom', 'toddler', 'kid',
  'kitchen', 'bedroom', 'table', 'walking', 'sitting',
  'holding', 'photograph', 'shot of', 'overhead', 'close-up',
  'back of', 'shoulder', 'feet', 'park', 'living room',
];

function hasPhotoBackground(post) {
  // Only use DALL-E photo when image_status is 'generated' (DALL-E already ran)
  // AND the image_prompt describes an actual scene
  if (post.image_status !== 'generated' || !post.image_url) return false;

  const prompt = (post.image_prompt || '').toLowerCase();
  return SCENE_KEYWORDS.some((kw) => prompt.includes(kw));
}

// ─── Main Composition ───

async function composePost(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;

  if (hasPhotoBackground(post)) {
    console.log(`[Compose]   Track 2 (photo bg): ${dims.w}x${dims.h}`);
    return composeWithPhoto(post);
  } else {
    console.log(`[Compose]   Track 1 (branded bg): ${dims.w}x${dims.h}, ${DARK_PILLARS.has(post.content_pillar) ? 'dark' : 'light'}`);
    return createBrandedBackground(post);
  }
}

// ─── Upload + Update ───

async function uploadAndUpdate(post, imageBuffer) {
  const filename = `${post.id}-final-${Date.now()}.png`;
  const { error: uploadErr } = await supabase.storage
    .from('post-images')
    .upload(filename, imageBuffer, { contentType: 'image/png', upsert: true });

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  const { data: urlData } = supabase.storage
    .from('post-images')
    .getPublicUrl(filename);

  const meta = post.metadata || {};
  await supabase
    .from('content_queue')
    .update({
      image_url: urlData.publicUrl,
      metadata: {
        ...meta,
        composed: true,
        track: hasPhotoBackground(post) ? 'photo' : 'branded',
        background_url: meta.bg_url || post.image_url || null,
      },
    })
    .eq('id', post.id);

  return urlData.publicUrl;
}

// ─── Runner ───

async function main() {
  console.log('[Compose] Starting two-track image composition...');
  const startTime = Date.now();

  // Get approved posts that need composition
  // Both 'generated' (has DALL-E bg) and 'not_needed' (skip DALL-E, use branded bg)
  const { data: posts, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('status', 'approved')
    .in('image_status', ['generated', 'not_needed'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Compose] Query failed:', error.message);
    process.exit(1);
  }

  // Filter to uncomposed
  const toCompose = (posts || []).filter((p) => !(p.metadata?.composed));

  if (toCompose.length === 0) {
    console.log('[Compose] No posts need composition. Done.');
    return;
  }

  console.log(`[Compose] ${toCompose.length} post(s) to compose`);

  let track1 = 0;
  let track2 = 0;
  let fail = 0;

  for (const post of toCompose) {
    try {
      console.log(`[Compose] "${post.hook.slice(0, 55)}..."`);
      const imageBuffer = await composePost(post);
      const url = await uploadAndUpdate(post, imageBuffer);
      console.log(`[Compose]   Done: ${url}`);

      if (hasPhotoBackground(post)) track2++;
      else track1++;

      await logCost(supabase, {
        pipeline_stage: 'image_composition', service: 'sharp', model: 'compose',
        content_id: post.id,
        description: `Composed ${post.post_format} (${hasPhotoBackground(post) ? 'photo' : 'branded'})`,
      });
    } catch (err) {
      console.error(`[Compose]   FAILED ${post.id}: ${err.message}`);
      fail++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Compose] Done in ${elapsed}s.`);
  console.log(`[Compose] Track 1 (branded): ${track1} | Track 2 (photo): ${track2} | Failed: ${fail}`);
  console.log(`[Compose] DALL-E cost saved: ~$${(track1 * 0.08).toFixed(2)} (${track1} posts used branded bg)`);
}

main().catch((err) => {
  console.error('[Compose] Fatal error:', err);
  process.exit(1);
});
