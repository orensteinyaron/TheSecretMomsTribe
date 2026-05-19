import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPhrases,
  MAX_WORDS_PER_PHRASE,
  PAUSE_SPLIT_THRESHOLD_S,
  type WhisperWord,
} from "../phrase-grouper.js";

function w(word: string, start: number, end: number): WhisperWord {
  return { word, start, end };
}

test("empty input → empty output", () => {
  assert.deepEqual(buildPhrases([]), []);
});

test("single word → one one-word phrase", () => {
  const out = buildPhrases([w("hello", 0, 0.5)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "hello");
  assert.equal(out[0].start_s, 0);
  assert.equal(out[0].end_s, 0.5);
});

test("4 words with tight gaps → one 4-word phrase (MAX_WORDS cap)", () => {
  // gaps all under threshold, so the only split is the 4-word cap
  const out = buildPhrases([
    w("the", 0.00, 0.20),
    w("quick", 0.25, 0.50),
    w("brown", 0.55, 0.80),
    w("fox", 0.85, 1.10),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "the quick brown fox");
});

test("5 words with tight gaps → two phrases (4 + 1) — splits at MAX_WORDS", () => {
  const out = buildPhrases([
    w("the", 0.00, 0.20),
    w("quick", 0.25, 0.50),
    w("brown", 0.55, 0.80),
    w("fox", 0.85, 1.10),
    w("jumps", 1.15, 1.40),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "the quick brown fox");
  assert.equal(out[1].text, "jumps");
});

test("pause > GAP_THRESHOLD splits the phrase early", () => {
  // gap between "wait" and "this" = 0.45s > 0.3s threshold → splits
  const out = buildPhrases([
    w("okay", 0.00, 0.20),
    w("wait", 0.25, 0.50),
    w("this", 0.95, 1.10),     // big gap before this word
    w("is", 1.15, 1.30),
    w("happening", 1.35, 1.80),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "okay wait");
  assert.equal(out[1].text, "this is happening");
});

test("pause just under GAP_THRESHOLD does NOT split", () => {
  // gaps slightly under 0.3 — should stay one phrase under the MAX_WORDS cap
  const out = buildPhrases([
    w("one", 0.00, 0.20),
    w("two", 0.45, 0.65),     // gap 0.25
    w("three", 0.90, 1.10),   // gap 0.25
    w("four", 1.35, 1.55),    // gap 0.25
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "one two three four");
});

test("start_s and end_s match first/last word times", () => {
  const out = buildPhrases([
    w("a", 1.234, 1.500),
    w("b", 1.510, 1.700),
    w("c", 1.710, 2.000),
  ]);
  assert.equal(out[0].start_s, 1.234);
  assert.equal(out[0].end_s, 2.000);
});

test("custom maxWords + gapThresholdS", () => {
  const out = buildPhrases(
    [
      w("a", 0.00, 0.20),
      w("b", 0.25, 0.50),
      w("c", 0.55, 0.80),
      w("d", 0.85, 1.10),
    ],
    { maxWords: 2 },
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "a b");
  assert.equal(out[1].text, "c d");
});

test("default constants exported and match v3 spec", () => {
  assert.equal(MAX_WORDS_PER_PHRASE, 4);
  assert.equal(PAUSE_SPLIT_THRESHOLD_S, 0.3);
});

test("real-world deepfakes clip_01 scripting splits sensibly", () => {
  // Simulates the actual Whisper output we saw for clip_01:
  // "Okay, wait. This is happening right now and most parents have no idea.
  //  AI deepfakes are already inside your kid's school."
  // Whisper attaches punctuation to the word — we just preserve that.
  const out = buildPhrases([
    w("Okay,", 0.10, 0.45),
    w("wait.", 0.50, 0.95),
    w("This", 1.20, 1.40),
    w("is", 1.45, 1.55),
    w("happening", 1.60, 2.10),
    w("right", 2.15, 2.35),
    w("now", 2.40, 2.60),
    w("and", 2.65, 2.80),
  ]);
  // Expect: ["Okay, wait. This is", "happening right now and"] — first
  // 4 hits MAX_WORDS cap, next 4 hits cap again. No gap exceeded 0.3s.
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "Okay, wait. This is");
  assert.equal(out[1].text, "happening right now and");
});
