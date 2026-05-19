// Phrase-grouper for Avatar Full v5 captions.
//
// Ports the v3 algorithm from
// vigilant-engelbart-d6b66c/video/scripts/proof-deepfakes-render-v3.ts:40-63
// — `buildPhrasesForClip(words)` — verbatim.
//
// Rules:
//   - At most MAX_WORDS (4) words per phrase.
//   - Split EARLY when the gap between consecutive words exceeds
//     GAP_THRESHOLD (0.3s) — that's a natural breath/pause and reads
//     as a sentence-internal break, which feels right for spoken
//     phrase captions.
//
// Pure function — no I/O, no external deps. The words come from
// Whisper's word-level timestamps; downstream code feeds the result
// into the AvatarV5Captions Remotion component.

export type WhisperWord = {
  word: string;
  start: number;
  end: number;
};

export type Phrase = {
  text: string;
  start_s: number;
  end_s: number;
};

export const MAX_WORDS_PER_PHRASE = 4;
export const PAUSE_SPLIT_THRESHOLD_S = 0.3;

export function buildPhrases(
  words: WhisperWord[],
  opts: { maxWords?: number; gapThresholdS?: number } = {},
): Phrase[] {
  const maxWords = opts.maxWords ?? MAX_WORDS_PER_PHRASE;
  const gapThreshold = opts.gapThresholdS ?? PAUSE_SPLIT_THRESHOLD_S;

  if (words.length === 0) return [];

  const phrases: Phrase[] = [];
  let i = 0;
  while (i < words.length) {
    let phraseLen = Math.min(maxWords, words.length - i);
    // Scan inside this phrase window for any inter-word gap that exceeds
    // the natural-pause threshold — split there instead of riding through
    // the full MAX_WORDS.
    for (let j = 1; j < phraseLen; j++) {
      const prevEnd = words[i + j - 1].end;
      const nextStart = words[i + j].start;
      if (nextStart - prevEnd > gapThreshold) {
        phraseLen = j;
        break;
      }
    }
    const chunk = words.slice(i, i + phraseLen);
    phrases.push({
      text: chunk.map((w) => w.word.trim()).join(" ").trim(),
      start_s: chunk[0].start,
      end_s: chunk[chunk.length - 1].end,
    });
    i += phraseLen;
  }
  return phrases;
}
