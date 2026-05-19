// Word Error Rate computation for audio integrity dimensions.
//
// Compares an expected script (the ElevenLabs / TTS input) against the
// Whisper transcript of what's actually in the video's audio track.
// Strict-equality is too strict (Whisper varies punctuation/casing).
// WER on normalized token streams is the calibrated metric.

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  if (n === "") return [];
  return n.split(" ");
}

// Levenshtein distance on token arrays. O(m*n) time and space; fine for
// transcripts up to a few hundred words.
function tokenDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export type WerResult = {
  wer: number;
  reference_words: number;
  hypothesis_words: number;
  edit_distance: number;
};

export function computeWer(reference: string, hypothesis: string): WerResult {
  const refTokens = tokenize(reference);
  const hypTokens = tokenize(hypothesis);
  const edit = tokenDistance(refTokens, hypTokens);
  const wer = refTokens.length === 0 ? (hypTokens.length === 0 ? 0 : 1) : edit / refTokens.length;
  return {
    wer,
    reference_words: refTokens.length,
    hypothesis_words: hypTokens.length,
    edit_distance: edit,
  };
}

// PASS threshold calibrated against Whisper-1 baseline variance on clean
// audio. 0.15 = 15% token error rate. Below 0.15 = transcript matches script
// closely enough that any human listener would say "this is the same line."
// Above = real mismatch.
export const WER_PASS_THRESHOLD = 0.15;
