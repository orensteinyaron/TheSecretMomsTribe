// Clip-duration guardrails for Avatar Full v5 (Seedance pipeline).
//
// WHY THIS EXISTS
// ---------------
// Seedance produces a clip of EXACTLY the requested `duration` seconds and
// crams the supplied TTS audio to fit. Two failure modes follow:
//   1. If the spoken audio is LONGER than `duration`, Seedance speeds the
//      voice up to fit — the result is garbled / chipmunked.
//   2. If the audio exceeds Seedance's 15s ceiling, the job hard-fails.
// During an e2e we hit both: clips authored from ~5-9s duration GUESSES
// actually carried 8-15.5s of audio.
//
// This module is the planning layer that lets the pipeline derive clip
// `duration` from REAL (or estimated) audio length, and split a clip script
// that won't fit into sub-scripts that will.
//
// CALIBRATION (ElevenLabs eleven_v3, the voice this pipeline uses):
//   ~125 chars → 8.96s, ~155 chars → 12.08s, ~190 chars → 13.68s
//   ⇒ ≈ 14 characters / second.
//
// Pure module — no I/O, no external deps. Every export is a pure function or
// a constant so it is trivially unit-testable and safe to call anywhere in
// the orchestrator.

/** Seedance model hard ceiling for a single clip (seconds). */
export const SEEDANCE_MAX_CLIP_S = 15;

/** eleven_v3 speaking-rate calibration: visible characters per second. */
export const CHARS_PER_SECOND = 14;

/**
 * Silent tail appended to each clip's submit `duration` so the inter-clip
 * audio bridge (a 4-frame Sequence overlap) never clips the last word.
 */
export const CLIP_TAIL_S = 1;

/**
 * Max acceptable spoken-audio length per clip. Chosen so that
 * `ceil(MAX_AUDIO_S) + CLIP_TAIL_S = 14 + 1 = 15` keeps the submit duration
 * at or under the Seedance ceiling even for a clip that fills the budget.
 */
export const MAX_AUDIO_S = 13.5;

/**
 * A clip whose measured audio is over MAX_AUDIO_S by no more than this much
 * can usually be salvaged by trimming leading/trailing silence rather than
 * re-splitting the script. Beyond this, the script must be split.
 */
export const TRIM_TOLERANCE_S = 1.0;

/**
 * Estimate the spoken duration (seconds) of `text` at the eleven_v3 rate.
 *
 * Counts VISIBLE characters: the text is trimmed and internal whitespace
 * runs are collapsed to a single space before counting, so formatting /
 * indentation does not inflate the estimate. Returns an unrounded number.
 */
export function estimateAudioSeconds(text: string): number {
  const visible = collapseWhitespace(text);
  return visible.length / CHARS_PER_SECOND;
}

/**
 * The integer `duration` to submit to Seedance for a clip whose real audio
 * is `audioSeconds`: natural-speed playback (ceil to the next whole second)
 * plus a silent tail, never exceeding the model ceiling.
 *
 *   duration = min(SEEDANCE_MAX_CLIP_S, ceil(audioSeconds) + CLIP_TAIL_S)
 */
export function seedanceDurationForAudio(audioSeconds: number): number {
  return Math.min(SEEDANCE_MAX_CLIP_S, Math.ceil(audioSeconds) + CLIP_TAIL_S);
}

/**
 * Split a clip script into the FEWEST sub-scripts such that each sub-script's
 * estimated audio length is <= `maxSeconds`.
 *
 * Strategy (in escalating order, only escalating when needed):
 *   1. Split into sentences (on `.`, `!`, `?`, keeping the punctuation).
 *   2. Greedily pack consecutive sentences into a chunk while the running
 *      estimate stays <= maxSeconds; start a new chunk when the next
 *      sentence would push it over.
 *   3. If a SINGLE sentence alone exceeds maxSeconds, split that sentence on
 *      clause boundaries (" - ", ", ", " — ").
 *   4. If even a single clause exceeds maxSeconds, hard-split on word
 *      boundaries.
 *
 * Safety property: no returned chunk's estimate exceeds maxSeconds (the only
 * exception is a single indivisible token longer than maxSeconds, which
 * cannot be split without dropping characters — it is returned intact).
 *
 * Invariants: returns `[text.trim()]` when the whole thing already fits;
 * never returns empty strings; concatenating the chunks with spaces yields
 * every original word, in order, with nothing dropped.
 */
export function splitScriptToFit(text: string, maxSeconds = MAX_AUDIO_S): string[] {
  const trimmed = collapseWhitespace(text);
  if (trimmed.length === 0) return [];
  if (estimateAudioSeconds(trimmed) <= maxSeconds) return [trimmed];

  // Atomic units = sentences. Any sentence that is itself too long is first
  // broken into clauses, and any clause still too long into words. This
  // produces a flat list of fragments, each <= maxSeconds where divisible.
  const units: string[] = [];
  for (const sentence of splitSentences(trimmed)) {
    if (estimateAudioSeconds(sentence) <= maxSeconds) {
      units.push(sentence);
      continue;
    }
    for (const clause of splitClauses(sentence)) {
      if (estimateAudioSeconds(clause) <= maxSeconds) {
        units.push(clause);
        continue;
      }
      units.push(...splitWords(clause, maxSeconds));
    }
  }

  return packGreedily(units, maxSeconds);
}

/**
 * Classify a MEASURED audio length against the per-clip budget. Exactly one
 * of the three flags is true:
 *   - fits:      audio <= maxSeconds
 *   - trimmable: maxSeconds < audio <= maxSeconds + TRIM_TOLERANCE_S
 *   - mustSplit: audio > maxSeconds + TRIM_TOLERANCE_S
 */
export function needsSilenceTrim(
  audioSeconds: number,
  maxSeconds = MAX_AUDIO_S,
): { fits: boolean; trimmable: boolean; mustSplit: boolean } {
  const fits = audioSeconds <= maxSeconds;
  const trimmable = !fits && audioSeconds <= maxSeconds + TRIM_TOLERANCE_S;
  const mustSplit = !fits && !trimmable;
  return { fits, trimmable, mustSplit };
}

// ── internal helpers ───────────────────────────────────────────────────────

/** Trim and collapse internal whitespace runs to a single space. */
function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Split on sentence-terminating punctuation (`.`, `!`, `?`), keeping the
 * punctuation attached to its sentence. Abbreviation handling is out of
 * scope — a simple terminator split is sufficient for our scripts.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (matches ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Split a single sentence on clause boundaries: " — " (em-dash), " - "
 * (spaced hyphen), and ", ". The delimiter is dropped; words are preserved.
 */
function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s+—\s+|\s+-\s+|,\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Hard-split a fragment on word boundaries so that no produced chunk exceeds
 * maxSeconds. A single word longer than maxSeconds cannot be divided without
 * dropping characters, so it is emitted on its own (over budget) — the only
 * way the safety property can be exceeded, and it is unavoidable.
 */
function splitWords(fragment: string, maxSeconds: number): string[] {
  const words = fragment.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateAudioSeconds(candidate) > maxSeconds) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Greedily pack pre-sized units into the fewest chunks whose estimate stays
 * <= maxSeconds. Each unit is assumed already <= maxSeconds (except an
 * indivisible over-budget single token, which lands in its own chunk).
 */
function packGreedily(units: string[], maxSeconds: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (current && estimateAudioSeconds(candidate) > maxSeconds) {
      chunks.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
