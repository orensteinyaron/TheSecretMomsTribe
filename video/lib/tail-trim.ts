/**
 * Silence-aware tail trim — spec Finding 9, finally implemented (2026-06-10,
 * YAR-156).
 *
 * Seedance frequently appends an isolated transient AFTER the last spoken word
 * — a mouth click, breath, or re-voicing glitch sitting alone in the trailing
 * silence. When clips are stitched, that transient lands in the inter-sentence
 * gap and is heard as a "click / stitch" at the cut (the crossfade attenuates
 * but does not remove it — it can be louder than the speech). Observed on
 * clip_05 of the @themompsychologist render: "together" ends ~9.9s, then a
 * 0.28-RMS burst at ~10.05s before the clip ends at 10.10s.
 *
 * Finding 9 says "trim to last_whisper_word.end + 0.1s", but Whisper word-end
 * timestamps under-count the acoustic decay, so a fixed pad either clips the
 * word or keeps the transient (the transient can be only ~0.15s past the
 * Whisper end). Instead we SNAP to the trailing silence: from the last word,
 * scan forward to the first sustained-silence onset (the true acoustic end of
 * speech), then cut a small pad later — before any later transient.
 *
 * Pure + transport-free (caller supplies decoded mono PCM) so it is unit-testable.
 */

export interface TailTrimOptions {
  /** RMS below this (over a `silenceHoldS` window) counts as silence. */
  silenceRms?: number;
  /** Silence must persist this long to count as the trailing-silence onset. */
  silenceHoldS?: number;
  /** Pad kept after the detected acoustic end, before cutting. */
  padS?: number;
  /** Never trim earlier than this (safety floor, e.g. last word end). */
  minS?: number;
  /** Never trim later than the clip duration. */
  maxS: number;
}

const DEFAULTS = { silenceRms: 0.012, silenceHoldS: 0.04, padS: 0.1 };

function windowRms(pcm: Float32Array, start: number, len: number): number {
  let s = 0;
  const end = Math.min(pcm.length, start + len);
  let n = 0;
  for (let i = Math.max(0, start); i < end; i++, n++) s += pcm[i] * pcm[i];
  return n > 0 ? Math.sqrt(s / n) : 0;
}

/**
 * Trim point (seconds): the first sustained-silence onset at/after
 * `lastWordEndS`, plus `padS`. Clamped to [minS, maxS]. If no trailing silence
 * is found (speech runs to the end), returns `maxS` (no trim).
 */
export function findTailTrimSeconds(
  pcm: Float32Array,
  sampleRate: number,
  lastWordEndS: number,
  opts: TailTrimOptions,
): number {
  const silenceRms = opts.silenceRms ?? DEFAULTS.silenceRms;
  const holdS = opts.silenceHoldS ?? DEFAULTS.silenceHoldS;
  const padS = opts.padS ?? DEFAULTS.padS;
  const minS = opts.minS ?? lastWordEndS;
  const maxS = opts.maxS;

  const holdLen = Math.round(holdS * sampleRate);
  const stepLen = Math.round(0.01 * sampleRate); // 10 ms scan resolution
  const fromSample = Math.round(Math.max(0, lastWordEndS) * sampleRate);
  const endSample = Math.round(maxS * sampleRate);

  for (let i = fromSample; i + holdLen < endSample; i += stepLen) {
    if (windowRms(pcm, i, holdLen) < silenceRms) {
      // Onset of sustained silence = acoustic end of speech.
      const trim = i / sampleRate + padS;
      return Math.min(maxS, Math.max(minS, trim));
    }
  }
  // No trailing silence found — keep the whole clip.
  return maxS;
}
