/**
 * SMT Image Composition Pipeline — Two-Track System
 *
 * Track 1: Branded Background (NO DALL-E) — text-heavy posts
 *   Pure SVG + Sharp. Zero API cost. Clean editorial look.
 *   Dark (purple→black gradient) or Light (#fcfcfa) based on pillar.
 *
 * Track 2: Photo Background (DALL-E) — scene-based posts
 *   DALL-E bg + gradient + text overlay via Sharp.
 *
 * Brand Assets:
 *   Logo: /assets/brand/SMT_LOGO_small.png (purple circle, transparent bg)
 *   Font: Blankspot (brand script) — embedded as base64 in SVG
 *   Palette: #63246a (purple), #b74780 (pink), #000, #efedea, #fcfcfa
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/compose.js
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { logCost } from './utils/cost-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Brand Assets (loaded once) ───

const LOGO_PATH = path.join(__dirname, '../assets/brand/SMT_LOGO_small.png');
const BLANKSPOT_PATH = path.join(__dirname, '../assets/brand/Blankspot-owlw4.ttf');
const BLANKSPOT_B64 = fs.readFileSync(BLANKSPOT_PATH).toString('base64');

// ─── Official Brand Palette ───

const BRAND = {
  purple: '#63246a',
  pink: '#b74780',
  black: '#000000',
  gray: '#efedea',
  white: '#fcfcfa',
  purpleLight: '#7d3585',
  pinkLight: '#d4699e',
};

// All pillars use the purple/pink family for brand cohesion
const PILLAR_COLOR = {
  ai_magic: BRAND.purple,
  parenting_insights: BRAND.pink,
  tech_for_moms: BRAND.purple,
  mom_health: BRAND.purpleLight,
  trending: BRAND.pink,
};

const PILLAR_LABEL = {
  ai_magic: 'AI MAGIC',
  parenting_insights: 'PARENTING',
  tech_for_moms: 'TECH FOR MOMS',
  mom_health: 'MOM HEALTH',
  trending: 'TRENDING',
};

// Dark template: ai_magic, mom_health, trending
// Light template: parenting_insights, tech_for_moms
const DARK_PILLARS = new Set(['ai_magic', 'mom_health', 'trending']);

const DIMS = {
  tiktok_slideshow: { w: 1080, h: 1920 },
  tiktok_text: { w: 1080, h: 1920 },
  ig_carousel: { w: 1080, h: 1350 },
  ig_static: { w: 1080, h: 1350 },
  ig_meme: { w: 1080, h: 1350 },
};

const TEXT_SIZE = {
  ig_static: { fontSize: 48, lineHeight: 62, maxChars: 28 },
  ig_carousel: { fontSize: 44, lineHeight: 58, maxChars: 30 },
  ig_meme: { fontSize: 48, lineHeight: 62, maxChars: 28 },
  tiktok_text: { fontSize: 52, lineHeight: 66, maxChars: 26 },
  tiktok_slideshow: { fontSize: 50, lineHeight: 64, maxChars: 27 },
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

// ─── Logo Loader ───

async function loadLogo(size, opacity) {
  return sharp(LOGO_PATH)
    .resize(size, size)
    .ensureAlpha(opacity)
    .toBuffer();
}

// ─── Track 1: Dark Branded Background ───

function createDarkBackground(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;
  const { w, h } = dims;
  const ts = TEXT_SIZE[post.post_format] || TEXT_SIZE.ig_static;
  const accent = PILLAR_COLOR[post.content_pillar] || BRAND.pink;
  const label = PILLAR_LABEL[post.content_pillar] || '';

  const hookLines = wordWrap(post.hook || '', ts.maxChars);
  const totalHookHeight = hookLines.length * ts.lineHeight;
  const hookStartY = (h / 2) - (totalHookHeight / 2) + ts.fontSize * 0.35;
  const cx = w / 2;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BRAND.purple}"/>
      <stop offset="100%" stop-color="${BRAND.black}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="${BRAND.purpleLight}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${BRAND.black}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Purple-to-black gradient -->
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>

  <!-- Pillar accent line -->
  <rect x="${cx - 50}" y="${hookStartY - 100}" width="100" height="3" rx="1.5" fill="${accent}"/>

  <!-- Pillar label -->
  ${label ? `<text x="${cx}" y="${hookStartY - 68}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="13" fill="${accent}" text-anchor="middle" letter-spacing="2.5" font-weight="600">${escapeXml(label)}</text>` : ''}

  <!-- Hook text -->
  ${hookLines.map((line, i) => `<text x="${cx}" y="${hookStartY + i * ts.lineHeight}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="${BRAND.white}" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Decorative divider -->
  <text x="${cx}" y="${hookStartY + totalHookHeight + 35}" font-family="Georgia, serif" font-size="18" fill="rgba(252,252,250,0.2)" text-anchor="middle">&#x2014; &#x2726; &#x2014;</text>

  <!-- Handle -->
  <text x="${cx}" y="${h - 52}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="15" fill="rgba(252,252,250,0.3)" text-anchor="middle">@thesecretmomstribe</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Track 1: Light Branded Background ───

function createLightBackground(post) {
  const dims = DIMS[post.post_format] || DIMS.ig_static;
  const { w, h } = dims;
  const ts = TEXT_SIZE[post.post_format] || TEXT_SIZE.ig_static;
  const accent = PILLAR_COLOR[post.content_pillar] || BRAND.purple;
  const label = PILLAR_LABEL[post.content_pillar] || '';

  const hookLines = wordWrap(post.hook || '', ts.maxChars);
  const totalHookHeight = hookLines.length * ts.lineHeight;
  const hookStartY = (h / 2) - (totalHookHeight / 2) + ts.fontSize * 0.35;
  const cx = w / 2;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <!-- Off-white background -->
  <rect width="${w}" height="${h}" fill="${BRAND.white}"/>

  <!-- Subtle warm tint in center -->
  <defs>
    <radialGradient id="warmglow" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${BRAND.gray}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${BRAND.white}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#warmglow)"/>

  <!-- Pillar accent line -->
  <rect x="${cx - 50}" y="${hookStartY - 100}" width="100" height="3" rx="1.5" fill="${accent}"/>

  <!-- Pillar label -->
  ${label ? `<text x="${cx}" y="${hookStartY - 68}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="13" fill="${accent}" text-anchor="middle" letter-spacing="2.5" font-weight="600">${escapeXml(label)}</text>` : ''}

  <!-- Hook text -->
  ${hookLines.map((line, i) => `<text x="${cx}" y="${hookStartY + i * ts.lineHeight}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="${BRAND.black}" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Decorative divider -->
  <text x="${cx}" y="${hookStartY + totalHookHeight + 35}" font-family="Georgia, serif" font-size="18" fill="rgba(99,36,106,0.15)" text-anchor="middle">&#x2014; &#x2726; &#x2014;</text>

  <!-- Handle -->
  <text x="${cx}" y="${h - 52}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="15" fill="rgba(99,36,106,0.3)" text-anchor="middle">@thesecretmomstribe</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
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
  const label = PILLAR_LABEL[post.content_pillar] || '';

  const hookLines = wordWrap(post.hook || '', ts.maxChars);
  const totalHookHeight = hookLines.length * ts.lineHeight;
  const hookStartY = (h / 2) - (totalHookHeight / 2) + ts.fontSize * 0.35;
  const cx = w / 2;
  const chipW = label.length * 9.5 + 28;

  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <!-- Pillar chip -->
  ${label ? `
  <rect x="40" y="44" width="${chipW}" height="30" rx="15" fill="${BRAND.purple}" opacity="0.9"/>
  <text x="${40 + chipW / 2}" y="64" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="white" text-anchor="middle" letter-spacing="1">${escapeXml(label)}</text>
  ` : ''}

  <!-- Hook text with subtle shadow -->
  ${hookLines.map((line, i) => `
  <text x="${cx + 1}" y="${hookStartY + i * ts.lineHeight + 2}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="rgba(0,0,0,0.4)" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>
  <text x="${cx}" y="${hookStartY + i * ts.lineHeight}" font-family="Georgia, 'Times New Roman', serif" font-size="${ts.fontSize}" font-weight="700" fill="${BRAND.white}" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`).join('\n  ')}

  <!-- Divider -->
  <text x="${cx}" y="${hookStartY + totalHookHeight + 35}" font-family="Georgia, serif" font-size="18" fill="rgba(252,252,250,0.25)" text-anchor="middle">&#x2014; &#x2726; &#x2014;</text>

  <!-- Handle -->
  <text x="${cx}" y="${h - 52}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="15" fill="rgba(252,252,250,0.3)" text-anchor="middle">@thesecretmomstribe</text>
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
    .png()
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
  if (post.image_status !== 'generated' || !post.image_url) return false;
  const prompt = (post.image_prompt || '').toLowerCase();
  return SCENE_KEYWORDS.some((kw) => prompt.includes(kw));
}

function selectTemplate(post) {
  if (hasPhotoBackground(post)) return 'photo';
  return DARK_PILLARS.has(post.content_pillar) ? 'dark' : 'light';
}

// ─── Main Composition ───

async function composePost(post) {
  const template = selectTemplate(post);
  const dims = DIMS[post.post_format] || DIMS.ig_static;

  let imageBuffer;
  if (template === 'photo') {
    console.log(`[Compose]   Track: photo bg (${dims.w}x${dims.h})`);
    imageBuffer = await composeWithPhoto(post);
  } else if (template === 'dark') {
    console.log(`[Compose]   Track: dark branded (${dims.w}x${dims.h})`);
    imageBuffer = await createDarkBackground(post);
  } else {
    console.log(`[Compose]   Track: light branded (${dims.w}x${dims.h})`);
    imageBuffer = await createLightBackground(post);
  }

  // Composite logo on top
  const logoSize = 60;
  const logoMargin = 40;
  const logoOpacity = template === 'light' ? 0.6 : 0.8;
  const logo = await loadLogo(logoSize, logoOpacity);

  return sharp(imageBuffer)
    .composite([
      { input: logo, top: dims.h - logoSize - logoMargin, left: dims.w - logoSize - logoMargin },
    ])
    .png({ quality: 95 })
    .toBuffer();
}

// ─── Upload + Update ───

async function uploadAndUpdate(post, imageBuffer, template) {
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
        track: template,
        background_url: meta.bg_url || post.image_url || null,
      },
    })
    .eq('id', post.id);

  return urlData.publicUrl;
}

// ─── Runner ───

async function main() {
  console.log('[Compose] Starting two-track image composition...');
  console.log(`[Compose] Brand: purple=#63246a, pink=#b74780`);
  const startTime = Date.now();

  // Get approved posts that need composition
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

  const toCompose = (posts || []).filter((p) => !(p.metadata?.composed));

  if (toCompose.length === 0) {
    console.log('[Compose] No posts need composition. Done.');
    return;
  }

  console.log(`[Compose] ${toCompose.length} post(s) to compose`);

  let darkCount = 0, lightCount = 0, photoCount = 0, fail = 0;

  for (const post of toCompose) {
    try {
      const hookPreview = (post.hook || '').slice(0, 55);
      console.log(`[Compose] "${hookPreview}..."`);
      const template = selectTemplate(post);
      const imageBuffer = await composePost(post);
      const url = await uploadAndUpdate(post, imageBuffer, template);
      console.log(`[Compose]   Done: ${url}`);

      if (template === 'dark') darkCount++;
      else if (template === 'light') lightCount++;
      else photoCount++;

      await logCost(supabase, {
        pipeline_stage: 'image_composition', service: 'sharp', model: 'compose',
        content_id: post.id,
        description: `Composed ${post.post_format} (${template})`,
      });
    } catch (err) {
      console.error(`[Compose]   FAILED ${post.id}: ${err.message}`);
      fail++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Compose] Done in ${elapsed}s.`);
  console.log(`[Compose] Dark: ${darkCount} | Light: ${lightCount} | Photo: ${photoCount} | Failed: ${fail}`);
  console.log(`[Compose] DALL-E saved: ~$${((darkCount + lightCount) * 0.08).toFixed(2)} (${darkCount + lightCount} branded bg)`);
}

main().catch((err) => {
  console.error('[Compose] Fatal error:', err);
  process.exit(1);
});
