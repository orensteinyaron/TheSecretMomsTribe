/**
 * Hook Card Thumbnail Generator v1
 *
 * Renders 2 PNG variants of a hook card thumbnail at 1080x1920:
 *   Option A — bold solid block (rotated purple band, white display sans)
 *   Option B — editorial overlay (white serif italic with soft drop shadow)
 *
 * Both share the same Rachel still as background and the same hook text.
 * Hardcoded inputs for v1; flags later.
 *
 * Usage:
 *   npx tsx scripts/generate-hook-card.ts
 *
 * Output: 2 PNG paths printed to stdout.
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";

// ---- Hardcoded inputs (parameterise later) ----

const RACHEL_STILL_URL =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png";
const HOOK_TEXT = "How I get my teen talking";
const HANDLE = "@thesecretmomstribe";

// Option B line wrap (manual for v1 — auto-wrap is a follow-up).
const HOOK_LINES_OPTION_B: [string, string] = ["How I get", "my teen talking"];

const W = 1080;
const H = 1920;
const BRAND_PURPLE = "#63246a";
const OFF_WHITE = "#fcfcfa";

// ---- Setup ----

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const tmpDir = path.join(os.tmpdir(), `hook-card-${runId}`);
fs.mkdirSync(tmpDir, { recursive: true });

function log(msg: string) { process.stderr.write(`${msg}\n`); }
log(`[setup] tmpDir=${tmpDir}`);

// ---- Helpers ----

async function downloadFile(url: string, destPath: string, retries = 3): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`download failed: ${url} :: ${(lastErr as Error)?.message}`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---- Option A — bold solid block (rotated purple band) ----

function svgOptionA(): string {
  const text = escapeXml(HOOK_TEXT.toUpperCase());
  const handle = escapeXml(HANDLE);
  // Band: middle third, rotated -2° around canvas centre.
  // Wider than canvas (overshoot ±100px) so rotation corners don't expose
  // the background through the edges.
  // textLength + lengthAdjust forces the text to fit the band width exactly;
  // librsvg can't always find Impact, but glyph squeeze keeps the long
  // headline contained regardless of which display sans it falls back to.
  const bandTextWidth = 920;  // band is 1080 wide; leave ~80px padding either side
  // Band sits in the bottom-third — centered around y≈1500 — so it lands
  // below Rachel's face/sweater rather than over it.
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-2 540 1500)">
    <rect x="-100" y="1320" width="1280" height="360" fill="${BRAND_PURPLE}"/>
    <text x="540" y="1525"
          font-family="'Helvetica Neue', Impact, 'Arial Black', sans-serif"
          font-size="95"
          font-weight="900"
          font-stretch="condensed"
          fill="${OFF_WHITE}"
          text-anchor="middle"
          letter-spacing="-1"
          textLength="${bandTextWidth}"
          lengthAdjust="spacingAndGlyphs">${text}</text>
  </g>
  <text x="540" y="1850"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-size="28"
        fill="#FFFFFF"
        fill-opacity="0.7"
        text-anchor="middle">${handle}</text>
</svg>`;
}

// ---- Option B — editorial overlay (white serif italic, drop shadow) ----

function svgOptionB(): string {
  const handle = escapeXml(HANDLE);
  const line1 = escapeXml(HOOK_LINES_OPTION_B[0]);
  const line2 = escapeXml(HOOK_LINES_OPTION_B[1]);
  // line-height 1.05 → 110pt * 1.05 = 115.5px between baselines.
  // Bottom-left, with breathing room above the handle.
  const fontSize = 110;
  const lineHeight = Math.round(fontSize * 1.05);
  const bottomPaddingForHandle = 130; // handle baseline is at 1850 → leave gap
  const line2Baseline = H - bottomPaddingForHandle - 60; // ~ 1730
  const line1Baseline = line2Baseline - lineHeight;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12"/>
      <feOffset dx="0" dy="8" result="offsetBlur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#softShadow)">
    <text x="80" y="${line1Baseline}"
          font-family="Georgia, 'Times New Roman', serif"
          font-style="italic"
          font-weight="400"
          font-size="${fontSize}"
          fill="#FFFFFF">${line1}</text>
    <text x="80" y="${line2Baseline}"
          font-family="Georgia, 'Times New Roman', serif"
          font-style="italic"
          font-weight="400"
          font-size="${fontSize}"
          fill="#FFFFFF">${line2}</text>
  </g>
  <text x="540" y="1850"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-size="28"
        fill="#FFFFFF"
        fill-opacity="0.7"
        text-anchor="middle">${handle}</text>
</svg>`;
}

// ---- Main ----

async function main() {
  // Step 1: Download Rachel still
  const bgPath = path.join(tmpDir, "background.png");
  log(`[step 1/3] downloading background -> ${bgPath} ...`);
  await downloadFile(RACHEL_STILL_URL, bgPath);

  // Step 2: Resize background to 1080x1920 cover-fit (shared base for both options)
  log(`[step 2/3] resizing background to ${W}x${H} (cover-fit) ...`);
  const baseBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();

  // Step 3: Composite each variant
  log(`[step 3/3] rendering 2 variants ...`);
  const optionA = path.join(tmpDir, "option-a-bold-block.png");
  const optionB = path.join(tmpDir, "option-b-editorial.png");

  await sharp(baseBuf).composite([{ input: Buffer.from(svgOptionA()), top: 0, left: 0 }]).png().toFile(optionA);
  await sharp(baseBuf).composite([{ input: Buffer.from(svgOptionB()), top: 0, left: 0 }]).png().toFile(optionB);

  // Print final paths
  process.stdout.write(`\n=== Hook Card Thumbnails ===\n`);
  process.stdout.write(`Option A (bold solid block):    ${optionA}\n`);
  process.stdout.write(`Option B (editorial overlay):   ${optionB}\n`);
}

main().catch((e) => {
  console.error(`[fatal] ${e.stack || e.message}`);
  process.exit(1);
});
