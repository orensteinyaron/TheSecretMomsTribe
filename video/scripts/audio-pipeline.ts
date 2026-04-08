/**
 * Audio Pipeline — TTS + Whisper + phrase timing
 *
 * Key insight: Whisper strips punctuation from words. Sentence boundaries must
 * be derived from the original TTS script text, then mapped onto Whisper word indices.
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import OpenAI from "openai";
import { parseFile } from "music-metadata";
import { logCost } from "../lib/cost-tracker";
import fs from "fs";
import path from "path";
import { type PhraseGroup, type AudioMode } from "../src/templates/v2/types";

export interface AudioResult {
  audioFile: string;
  durationSec: number;
  phraseTimings: PhraseGroup[];
  cost: number;
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

function normalize(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

/**
 * Find Whisper word indices that end a sentence.
 *
 * Strategy: Split the TTS script into sentences. For each sentence, find the
 * last word and locate it in the Whisper word list (sequentially). That Whisper
 * word index is a sentence ending.
 *
 * Also: detect large gaps (>0.4s) between Whisper words as implicit sentence breaks,
 * since TTS naturally pauses between sentences even if text alignment fails.
 */
function findSentenceEndings(ttsScript: string, whisperWords: WhisperWord[], originalEndTimes?: number[]): Set<number> {
  const endings = new Set<number>();

  // Method 1: Align TTS script sentences to Whisper words
  const sentences = ttsScript.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  let wIdx = 0;

  for (const sentence of sentences) {
    const sentWords = sentence.split(/\s+/).map(w => normalize(w)).filter(w => w.length > 0);
    if (sentWords.length === 0) continue;

    const lastSentWord = sentWords[sentWords.length - 1];

    // Find this sentence's last word in Whisper output (search forward from current position)
    let found = false;
    for (let searchIdx = wIdx; searchIdx < Math.min(wIdx + sentWords.length + 10, whisperWords.length); searchIdx++) {
      const wNorm = normalize(whisperWords[searchIdx].word);

      // Match: exact, or starts-with but ONLY for words > 3 chars (short words match too loosely)
      const isMatch = wNorm === lastSentWord ||
        (lastSentWord.length > 3 && (wNorm.startsWith(lastSentWord) || lastSentWord.startsWith(wNorm)));
      if (!isMatch) continue;

      // Verify context: check that 2+ prior words also match (prevents false positives)
      let priorMatches = 0;
      for (let backtrack = 1; backtrack <= Math.min(3, sentWords.length - 1); backtrack++) {
        if (searchIdx - backtrack >= 0) {
          const wBack = normalize(whisperWords[searchIdx - backtrack].word);
          const sBack = sentWords[sentWords.length - 1 - backtrack];
          if (sBack && wBack === sBack) {
            priorMatches++;
          }
        }
      }

      const minMatches = sentWords.length <= 2 ? 0 : (sentWords.length <= 4 ? 1 : 2);
      if (priorMatches >= minMatches) {
        endings.add(searchIdx);
        wIdx = searchIdx + 1;
        found = true;
        break;
      }
    }

    // If text alignment failed, advance wIdx by approximate sentence length
    if (!found) {
      wIdx = Math.min(wIdx + sentWords.length, whisperWords.length);
    }
  }

  // Method 2: Also mark pauses (>0.3s) as sentence boundaries
  // Use ORIGINAL end times (before zero-duration fix) to detect real pauses
  for (let i = 0; i < whisperWords.length - 1; i++) {
    const originalEnd = originalEndTimes?.[i] ?? whisperWords[i].end;
    const gap = whisperWords[i + 1].start - originalEnd;
    if (gap > 0.3) {
      endings.add(i);
    }
  }

  return endings;
}

/**
 * Build phrase groups from Whisper words, respecting sentence boundaries
 * derived from the TTS script.
 */
function buildPhrasesFromWhisper(
  whisperWords: WhisperWord[],
  sentenceEndings: Set<number>,
  maxWordsPerPhrase: number = 4,
  originalEnds?: number[],
): PhraseGroup[] {
  const phrases: PhraseGroup[] = [];
  let i = 0;

  while (i < whisperWords.length) {
    let phraseLen = Math.min(maxWordsPerPhrase, whisperWords.length - i);
    let hasSentenceEnd = false;

    // Rule 1: NEVER cross a sentence boundary.
    for (let j = 0; j < phraseLen; j++) {
      if (sentenceEndings.has(i + j)) {
        phraseLen = j + 1;
        hasSentenceEnd = true;
        break;
      }
    }

    // Rule 2: Break at natural pause points (gap > 0.3s using ORIGINAL end times).
    // BUT: never shorten past a sentence ending — that drops words.
    if (!hasSentenceEnd && phraseLen > 2) {
      for (let j = 2; j < phraseLen; j++) {
        const prevEnd = originalEnds ? originalEnds[i + j - 1] : whisperWords[i + j - 1].end;
        const gap = whisperWords[i + j].start - prevEnd;
        if (gap > 0.3) {
          phraseLen = j;
          break;
        }
      }
    }

    if (phraseLen < 1) phraseLen = 1;

    const chunk = whisperWords.slice(i, i + phraseLen);
    const words = chunk.map(w => w.word).join(" ");

    phrases.push({
      words,
      emphasis: false,
      startTime: chunk[0].start,
      endTime: chunk[chunk.length - 1].end,
    });

    i += phraseLen;
  }

  // Ensure every phrase has minimum 0.2s duration
  const MIN_PHRASE_DURATION = 0.2;
  for (const p of phrases) {
    if (p.endTime - p.startTime < MIN_PHRASE_DURATION) {
      p.endTime = p.startTime + MIN_PHRASE_DURATION;
    }
  }

  // Hard validation: every Whisper word must appear in exactly one phrase
  const totalPhraseWords = phrases.reduce((sum, p) => sum + p.words.split(/\s+/).length, 0);
  if (totalPhraseWords !== whisperWords.length) {
    const allPhraseWords = phrases.flatMap(p => p.words.split(/\s+/));
    let phraseWordIdx = 0;
    const missing: string[] = [];
    for (let w = 0; w < whisperWords.length; w++) {
      if (phraseWordIdx >= allPhraseWords.length || normalize(allPhraseWords[phraseWordIdx]) !== normalize(whisperWords[w].word)) {
        missing.push(`word ${w}: "${whisperWords[w].word}" at ${whisperWords[w].start.toFixed(2)}s`);
      } else {
        phraseWordIdx++;
      }
    }
    throw new Error(`WORD COUNT MISMATCH: Phrases have ${totalPhraseWords} words but Whisper has ${whisperWords.length}. Missing: ${missing.join(", ")}`);
  }
  console.log(`   Word count validated: ${totalPhraseWords}/${whisperWords.length} OK`);

  return phrases;
}

/**
 * Fallback: evenly distribute phrases when Whisper fails.
 */
function evenDistribution(
  phrases: { words: string; emphasis: boolean }[],
  totalDuration: number,
): PhraseGroup[] {
  if (phrases.length === 0) return [];
  const dur = totalDuration / phrases.length;
  return phrases.map((p, i) => ({
    words: p.words,
    emphasis: p.emphasis,
    startTime: i * dur,
    endTime: (i + 1) * dur,
  }));
}

async function processVoice(
  ttsScript: string,
  phraseGroupsPerSlide: { words: string; emphasis: boolean }[][],
  contentId: string,
  outDir: string,
  publicDir: string,
): Promise<AudioResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let totalCost = 0;

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  // ── TTS ──
  const audioFileName = `voiceover-v2-${contentId}.mp3`;
  const audioOutPath = path.join(outDir, audioFileName);
  const audioPublicPath = path.join(publicDir, audioFileName);

  const ttsResp = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: ttsScript,
    response_format: "mp3",
  });

  const buf = Buffer.from(await ttsResp.arrayBuffer());
  fs.writeFileSync(audioOutPath, buf);
  fs.copyFileSync(audioOutPath, audioPublicPath);

  const ttsCost = ttsScript.length * 0.000015;
  totalCost += ttsCost;
  await logCost(contentId, "openai", "tts-1", 0, 0, ttsCost);

  const meta = await parseFile(audioOutPath);
  const durationSec = meta.format.duration ?? 30;

  // ── Whisper ──
  let whisperWords: WhisperWord[] = [];

  try {
    const whisperResult = await runWhisper(audioOutPath, contentId, outDir);
    whisperWords = whisperResult.words;
    totalCost += whisperResult.cost;
    console.log(`   Whisper: ${whisperWords.length} words, ${whisperResult.durationSec.toFixed(1)}s`);
  } catch (err) {
    console.warn("[audio-pipeline] Whisper failed:", err);
  }

  // ── Build phrases ──
  let phraseTimings: PhraseGroup[];

  if (whisperWords.length > 0) {
    // Save original end times before fixing zero-duration words
    const originalEnds = whisperWords.map(w => w.end);
    for (const w of whisperWords) {
      if (w.end <= w.start) w.end = w.start + 0.3;
    }

    // Find sentence boundaries (uses original end times for gap detection)
    const sentenceEndings = findSentenceEndings(ttsScript, whisperWords, originalEnds);
    console.log(`   Sentence endings at Whisper indices: [${[...sentenceEndings].join(", ")}]`);

    // Build phrases respecting sentence boundaries (uses original ends for gap detection)
    phraseTimings = buildPhrasesFromWhisper(whisperWords, sentenceEndings, 4, originalEnds);

    // ── Debug: print phrase groups ──
    console.log(`   Phrases: ${phraseTimings.length}`);
    for (let p = 0; p < phraseTimings.length; p++) {
      const pg = phraseTimings[p];
      const isBoundary = [...sentenceEndings].some(idx => {
        // Check if this phrase ends at a sentence boundary
        const lastWordTime = pg.endTime;
        return whisperWords[idx] && Math.abs(whisperWords[idx].end - lastWordTime) < 0.05;
      });
      console.log(`     ${(p + 1).toString().padStart(3)}. [${pg.startTime.toFixed(2)}s-${pg.endTime.toFixed(2)}s] "${pg.words}"${isBoundary ? " ◄ SENTENCE END" : ""}`);
    }
  } else {
    phraseTimings = evenDistribution(phraseGroupsPerSlide.flat(), durationSec);
    console.log(`   Phrases: ${phraseTimings.length} (even distribution fallback)`);
  }

  return {
    audioFile: audioFileName,
    durationSec,
    phraseTimings,
    cost: totalCost,
  };
}

/**
 * Run Whisper on an audio file and return word-level timestamps.
 * Reusable by avatar pipeline.
 */
export async function runWhisper(
  audioPath: string,
  contentId: string,
  outDir: string,
): Promise<{ words: WhisperWord[]; durationSec: number; cost: number }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const meta = await parseFile(audioPath);
  const durationSec = meta.format.duration ?? 0;

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: fs.createReadStream(audioPath),
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    language: "en",
  });

  fs.writeFileSync(
    path.join(outDir, "timestamps.json"),
    JSON.stringify(transcription, null, 2),
  );

  const words: WhisperWord[] = ((transcription as any).words || [])
    .map((w: any) => ({
      word: (w.word || "").trim(),
      start: w.start,
      end: w.end,
    }))
    .filter((w: WhisperWord) => w.word.length > 0);

  const cost = Math.ceil(durationSec / 60) * 0.006;
  await logCost(contentId, "openai", "whisper-1", 0, 0, cost);

  console.log(`[whisper] ${words.length} words, ${durationSec.toFixed(1)}s`);

  return { words, durationSec, cost };
}

export async function processAudio(
  ttsScript: string,
  phraseGroupsPerSlide: { words: string; emphasis: boolean }[][],
  audioMode: AudioMode,
  contentId: string,
  outDir: string,
  publicDir: string,
  _trendingAudioPath?: string,
): Promise<AudioResult> {
  switch (audioMode) {
    case "voice":
      return processVoice(ttsScript, phraseGroupsPerSlide, contentId, outDir, publicDir);
    case "sound":
      throw new Error("Mode B (sound) not yet implemented");
    case "hybrid":
      throw new Error("Mode C (hybrid) not yet implemented");
    default:
      throw new Error(`Unknown audio mode: ${audioMode}`);
  }
}
