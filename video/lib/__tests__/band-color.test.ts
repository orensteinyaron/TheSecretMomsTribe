import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

import {
  assertBandIsBrandPurple,
  checkBandColor,
  detectBandColor,
  maxChannelDistance,
  BRAND_PURPLE_HEX,
  BRAND_PRIMARY_HEX,
} from "../cover/band-color.js";

// Build a 1080×1920 PNG with a band in the lower third (the position both the
// cover banner and SMTHookOverlay occupy) plus centered white text, like a
// real thumbnail.
async function makeBandPng(bandHex: string): Promise<Buffer> {
  const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1920" fill="#2a2a2a"/>
    <rect x="0" y="1306" width="1080" height="347" fill="${bandHex}"/>
    <text x="540" y="1500" font-size="110" font-weight="900" fill="#fcfcfa" text-anchor="middle">CHARLIE PUTH</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("detectBandColor reads the plum band, ignoring the white text", async () => {
  const c = await detectBandColor(await makeBandPng(BRAND_PURPLE_HEX));
  assert.ok(c, "band detected");
  // Within a few units of #63246a = (99,36,106) after PNG encode.
  assert.ok(maxChannelDistance(c!, { r: 0x63, g: 0x24, b: 0x6a }) <= 6, `detected rgb(${c!.r},${c!.g},${c!.b})`);
});

test("checkBandColor PASSES the correct plum band", async () => {
  const res = await checkBandColor(await makeBandPng(BRAND_PURPLE_HEX));
  assert.equal(res.ok, true);
});

test("checkBandColor FAILS the wrong bright purple (the shipped mistake)", async () => {
  const res = await checkBandColor(await makeBandPng(BRAND_PRIMARY_HEX));
  assert.equal(res.ok, false);
  assert.ok((res.distance ?? 0) > 28, `bright-purple distance ${res.distance} should exceed tolerance`);
});

test("assertBandIsBrandPurple resolves on plum, throws on bright purple", async () => {
  await assertBandIsBrandPurple(await makeBandPng(BRAND_PURPLE_HEX)); // no throw
  const bright = await makeBandPng(BRAND_PRIMARY_HEX);
  await assert.rejects(() => assertBandIsBrandPurple(bright, { label: "thumbnail" }), /not BRAND_PURPLE #63246a/);
});

test("assertBandIsBrandPurple throws when no band is present", async () => {
  const plain = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#2a2a2a" } }).png().toBuffer();
  await assert.rejects(() => assertBandIsBrandPurple(plain), /no band pixels detected|not BRAND_PURPLE/);
});
