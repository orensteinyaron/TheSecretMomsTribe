/**
 * Avatar QA Agent
 *
 * Reusable CLI QA agent for any avatar pipeline output (Soul 2.0, HeyGen, etc).
 * Takes N video URLs + a reference still, outputs a chat-ready Markdown report.
 *
 * Usage:
 *   npx tsx scripts/qa-agent-avatar.ts \
 *     --reference https://.../reference.png \
 *     --clips clips.json \
 *     --label "Test 5 — Soul 2.0 + Seedance" \
 *     [--keep-tmp]
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import os from "os";
import {
  assertFfmpegAvailable,
  downloadFile,
  probeDurationSeconds,
  extractFrame,
  extractAudioMp3,
  whisperTranscribe,
  imageFromFile,
  sonnetVisionJson,
  type ImagePart,
  type WhisperResult,
} from "../lib/qa-helpers.js";
import type {
  AudioPacing,
  ClipInput,
  ClipResult,
  ClipVisionResult,
  CrossClipDrift,
  IdentityMarkerDisagreement,
  IdentityMarkerEntry,
  IdentityMarkerFrame,
  IdentityMarkerResult,
  SilenceCheck,
} from "../types/qa-avatar.js";
import { spawnSync } from "child_process";

// ---- Args ----

function parseArgs(argv: string[]) {
  const out: { reference?: string; clips?: string; label?: string; keepTmp: boolean } = { keepTmp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reference") out.reference = argv[++i];
    else if (a === "--clips") out.clips = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--keep-tmp") out.keepTmp = true;
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
  }
  return out;
}

function printUsage() {
  console.error(`Usage: npx tsx scripts/qa-agent-avatar.ts \\
  --reference <url> \\
  --clips <path-to-clips.json> \\
  [--label "Display label"] \\
  [--keep-tmp]

clips.json schema: [{ "id": "SCENE_1", "url": "https://..." }, ...]
Requires: ffmpeg, ffprobe, ANTHROPIC_API_KEY, OPENAI_API_KEY`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.reference || !args.clips) { printUsage(); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("[fatal] ANTHROPIC_API_KEY missing"); process.exit(1); }
if (!process.env.OPENAI_API_KEY)    { console.error("[fatal] OPENAI_API_KEY missing"); process.exit(1); }

assertFfmpegAvailable();

const clipsRaw = fs.readFileSync(args.clips, "utf-8");
let clips: ClipInput[];
try { clips = JSON.parse(clipsRaw); } catch (e: any) { console.error(`[fatal] clips.json parse error: ${e.message}`); process.exit(1); }
if (!Array.isArray(clips) || clips.length === 0) { console.error("[fatal] clips.json must be a non-empty array"); process.exit(1); }
for (const c of clips) {
  if (!c.id || !c.url) { console.error(`[fatal] each clip needs {id, url}: ${JSON.stringify(c)}`); process.exit(1); }
}

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const tmpDir = path.join(os.tmpdir(), `qa-avatar-${runId}`);
fs.mkdirSync(tmpDir, { recursive: true });
log(`[setup] tmpDir=${tmpDir}`);

function log(msg: string) { process.stderr.write(`${msg}\n`); }

// ---- Per-clip vision prompt ----

const PER_CLIP_PROMPT = `You are a strict QA reviewer for AI-generated avatar video content.
You will see 4 images:
- IMAGE 1: REFERENCE — the approved canonical face/identity for this character (Rachel)
- IMAGES 2-4: Three frames sampled from a single video clip (start, middle, end)

Score each dimension on 0-5 (5 = perfect match to reference, 0 = totally different person/setup).
Be ruthless. If you're unsure, score lower. Hair restyles, framing shifts are HARD FAILS.

Identity-marker auditing (moles, scars, freckles, asymmetries, etc.) is handled by a separate
per-frame call — do NOT score markers here. Focus on the 5 dimensions below.

Return STRICT JSON only, no prose:

{
  "identity":               { "score": 0-5, "notes": "specific observations about face shape, eyes, nose, mouth" },
  "hair":                   { "score": 0-5, "notes": "style, length, parting, volume vs reference" },
  "framing":                { "score": 0-5, "notes": "shot composition, distance from camera, head position" },
  "background_consistency": { "score": 0-5, "notes": "across the 3 frames of THIS clip — does background drift?" },
  "lighting":               { "score": 0-5, "notes": "warmth, direction, intensity vs reference" },
  "hard_fails":             ["list any dealbreaker issues — empty array if none"],
  "summary":                "one sentence verdict on this clip"
}`;

const IDENTITY_MARKERS_PROMPT = `You are auditing identity preservation in an AI-generated video frame against the canonical character reference.

You will receive TWO images:
- IMAGE 1: the canonical reference still (ground truth for the character's identity)
- IMAGE 2: a frame extracted from a generated video clip

STEP 1 — INSPECT THE REFERENCE.
Examine IMAGE 1 carefully. Enumerate every distinctive, persistent identity marker on the visible face and skin. Include:
- Scars, cuts, stitches, or healed wounds
- Moles, freckles, beauty marks
- Birthmarks or pigmentation patches
- Notable asymmetries (eye, brow, lip, nostril)
- Distinctive permanent features (chipped tooth, gap, dimple, etc.)

For each marker, record: location (anatomical region), approximate size, shape, and orientation.

If the reference shows NO distinctive markers in a region, explicitly note "no markers in [region]."

STEP 2 — INSPECT THE GENERATED FRAME.
Examine IMAGE 2 and perform the same enumeration independently. Do not assume markers exist because they appeared in the reference. Do not assume markers are absent because the reference lacked them. Look at IMAGE 2 on its own terms first.

STEP 3 — COMPARE.
For each region (forehead, brow, cheeks, nose, lips, chin, neck): does the set of markers in IMAGE 2 agree with IMAGE 1?

Agreement means:
- Markers present in IMAGE 1 also appear in IMAGE 2 with matching location, size, and shape
- Regions empty in IMAGE 1 are also empty in IMAGE 2
- No markers in IMAGE 2 that are absent from IMAGE 1 (no hallucinated features)

Disagreement includes any of:
- (a) Marker present in reference, absent in frame
- (b) Marker absent in reference, present in frame (hallucination)
- (c) Marker present in both but in different location, size, or shape

STEP 4 — SCORE.
Return JSON only:
{
  "reference_markers": [{"region": "...", "description": "..."}],
  "frame_markers":     [{"region": "...", "description": "..."}],
  "disagreements":     [{"type": "missing|hallucinated|drifted", "region": "...", "detail": "..."}],
  "score": 0-5,
  "reasoning": "one sentence"
}

Scoring rubric:
- 5 = perfect agreement; reference and frame match across all regions
- 4 = one minor drift (small position/size shift, no hallucination, no loss)
- 3 = one missing marker OR one minor hallucination
- 2 = multiple disagreements but core identity intact
- 1 = major hallucination (prominent feature added that isn't in reference) OR major loss
- 0 = identity unrecognizable

CRITICAL: a hallucinated feature (something present in IMAGE 2 but absent in IMAGE 1) is treated as severely as a missing one. Do not reward "feature present" if the reference does not have it.`;

const CROSS_CLIP_PROMPT_PREAMBLE = `You will see N+1 images:
- IMAGE 1: REFERENCE canonical Rachel
- IMAGES 2..N+1: One representative frame from each video clip, in this order:`;

const CROSS_CLIP_PROMPT_SUFFIX = `

Identify drift ACROSS the clips, not against reference. Where is Rachel inconsistent across the set?

Return STRICT JSON:
{
  "identity_drift":     { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "hair_drift":         { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "background_drift":   { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "framing_drift":      { "severity": "none|minor|major|hard_fail", "which_clips": ["SCENE_X"], "notes": "" },
  "overall_verdict":    "PASS | CONDITIONAL | FAIL",
  "verdict_reasoning":  "2-3 sentences"
}`;

// ---- Audio pacing classifier (deterministic, NOT lip-sync) ----

function classifyAudio(whisper: WhisperResult, clipDuration: number): AudioPacing {
  const wordCount = whisper.words.length;
  const speechDuration =
    whisper.words.length > 0
      ? whisper.words[whisper.words.length - 1].end - whisper.words[0].start
      : 0;
  const wps = speechDuration > 0 ? wordCount / speechDuration : 0;
  const coverage = clipDuration > 0 ? speechDuration / clipDuration : 0;

  let status: AudioPacing["status"] = "OK";
  const notes: string[] = [];
  if (wps > 0 && (wps < 1.8 || wps > 3.5)) {
    status = "PACING_ANOMALY";
    notes.push(`wps ${wps.toFixed(2)} outside 1.8–3.5 (likely sync issue)`);
  }
  if (coverage > 0 && coverage < 0.6) {
    status = status === "OK" ? "LONG_TAIL" : status;
    notes.push(`speech covers only ${(coverage * 100).toFixed(0)}% of clip (long silent tail)`);
  }
  if (notes.length === 0) notes.push("within expected range");

  return {
    word_count: wordCount,
    speech_duration_s: round(speechDuration, 2),
    clip_duration_s: round(clipDuration, 2),
    wps: round(wps, 2),
    speech_coverage: round(coverage, 2),
    status,
    notes: notes.join("; "),
    transcript: whisper.text.trim(),
  };
}

function round(n: number, digits = 2): number { return Math.round(n * 10 ** digits) / 10 ** digits; }

// ---- Silence check (deterministic, post-render safety net) ----
//
// Mirrors the trim trigger thresholds in video/scripts/trim-clip-silence.ts:
// lead silence > 0.5s or tail silence > 1.0s = hard_fail. Three layers cover
// the same bug surface — script-too-short → silent tail:
//   1. validate-script.ts (pre-TTS): rejects sub-4s scenes before any spend
//   2. trim-clip-silence.ts (in stitcher): clips dead air per-clip
//   3. silence_check (here): post-render catches anything that slipped through
//      (e.g. --no-trim debug runs, threshold edge cases, novel failure modes)
//
// Runs on the clip's extracted audio (already on disk for Whisper). No extra
// download, no extra LLM call, runs in milliseconds.

const LEAD_SILENCE_HARD_FAIL_S = 0.5;
const TAIL_SILENCE_HARD_FAIL_S = 1.0;

function checkSilence(audioPath: string, clipDuration: number): SilenceCheck {
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-nostats",
      "-i", audioPath,
      "-af", "silencedetect=noise=-40dB:d=0.3",
      "-f", "null", "-",
    ],
    { encoding: "utf-8" },
  );
  const text: string = r.stderr || "";

  const runs: { startSec: number; endSec: number }[] = [];
  let openStart: number | null = null;
  for (const line of text.split("\n")) {
    const ms = line.match(/silence_start:\s*(-?[\d.]+)/);
    const me = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (ms) openStart = parseFloat(ms[1]);
    if (me && openStart !== null) {
      runs.push({ startSec: openStart, endSec: parseFloat(me[1]) });
      openStart = null;
    }
  }
  if (openStart !== null) runs.push({ startSec: openStart, endSec: clipDuration });

  const leadRun = runs.find((r) => r.startSec < 0.05);
  const tailRun = [...runs].reverse().find((r) => r.endSec >= clipDuration - 0.05);
  const lead = leadRun ? leadRun.endSec - leadRun.startSec : 0;
  const tail = tailRun ? tailRun.endSec - tailRun.startSec : 0;

  const leadFail = lead > LEAD_SILENCE_HARD_FAIL_S;
  const tailFail = tail > TAIL_SILENCE_HARD_FAIL_S;
  let status: SilenceCheck["status"] = "OK";
  if (leadFail && tailFail) status = "BOTH_TOO_LONG";
  else if (leadFail) status = "LEAD_TOO_LONG";
  else if (tailFail) status = "TAIL_TOO_LONG";

  const notes = status === "OK"
    ? `lead ${lead.toFixed(2)}s ≤ ${LEAD_SILENCE_HARD_FAIL_S}s; tail ${tail.toFixed(2)}s ≤ ${TAIL_SILENCE_HARD_FAIL_S}s`
    : [
        leadFail ? `lead ${lead.toFixed(2)}s > ${LEAD_SILENCE_HARD_FAIL_S}s (HARD FAIL)` : `lead ${lead.toFixed(2)}s OK`,
        tailFail ? `tail ${tail.toFixed(2)}s > ${TAIL_SILENCE_HARD_FAIL_S}s (HARD FAIL)` : `tail ${tail.toFixed(2)}s OK`,
      ].join("; ");

  return {
    lead_silence_s: round(lead, 3),
    tail_silence_s: round(tail, 3),
    lead_threshold_s: LEAD_SILENCE_HARD_FAIL_S,
    tail_threshold_s: TAIL_SILENCE_HARD_FAIL_S,
    status,
    notes,
  };
}

// ---- Identity-marker aggregation ----

function aggregateFrameMarkers(
  perFrame: (IdentityMarkerFrame | { error: string })[],
): IdentityMarkerResult {
  const successful = perFrame.filter((f): f is IdentityMarkerFrame => !("error" in f));
  if (successful.length === 0) {
    return {
      per_frame: perFrame,
      aggregate_score: 0,
      reference_markers_summary: [],
      all_disagreements: [],
    };
  }
  const aggregate_score = Math.min(...successful.map(f => f.score));
  const reference_markers_summary = dedupeMarkers(successful.flatMap(f => f.reference_markers || []));
  const all_disagreements = perFrame.flatMap((f, i) =>
    "error" in f
      ? []
      : (f.disagreements || []).map(d => ({ ...d, frame_index: i + 1 })),
  );
  return { per_frame: perFrame, aggregate_score, reference_markers_summary, all_disagreements };
}

function dedupeMarkers(items: IdentityMarkerEntry[]): IdentityMarkerEntry[] {
  const seen = new Set<string>();
  const out: IdentityMarkerEntry[] = [];
  for (const m of items) {
    const key = `${(m.region || "").toLowerCase()}|${(m.description || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// ---- Per-clip pipeline ----

async function processClip(clip: ClipInput, refImage: ImagePart): Promise<ClipResult> {
  const localVideo = path.join(tmpDir, `${clip.id}.mp4`);
  const audioPath  = path.join(tmpDir, `${clip.id}.mp3`);
  const framePaths = [1, 2, 3].map(i => path.join(tmpDir, `${clip.id}-frame-${i}.jpg`));
  let duration = 0;

  try {
    log(`[${clip.id}] download ...`);
    await downloadFile(clip.url, localVideo);
    duration = probeDurationSeconds(localVideo);
    log(`[${clip.id}] duration=${duration.toFixed(2)}s`);

    const stamps = sampleTimestamps(duration);
    for (let i = 0; i < 3; i++) extractFrame(localVideo, stamps[i], framePaths[i]);

    extractAudioMp3(localVideo, audioPath);

    const frameAuditPromises = framePaths.map(fp =>
      sonnetVisionJson<IdentityMarkerFrame>(
        [refImage, imageFromFile(fp)],
        IDENTITY_MARKERS_PROMPT,
        { maxTokens: 1200 },
      ),
    );

    const [whisper, vision, ...frameAudits] = await Promise.all([
      whisperTranscribe(audioPath).then(
        w => ({ ok: true as const, w }),
        e => ({ ok: false as const, error: `whisper: ${e.message}` }),
      ),
      sonnetVisionJson<ClipVisionResult>(
        [refImage, ...framePaths.map(imageFromFile)],
        PER_CLIP_PROMPT,
        { maxTokens: 1500 },
      ),
      ...frameAuditPromises,
    ]);

    const audio: ClipResult["audio"] = whisper.ok
      ? classifyAudio(whisper.w, duration)
      : { error: whisper.error };

    const silence: ClipResult["silence"] = (() => {
      try { return checkSilence(audioPath, duration); }
      catch (e: any) { return { error: `silence: ${e.message}` }; }
    })();

    const visionResult: ClipResult["vision"] =
      "error" in (vision as any) ? (vision as { error: string }) : (vision as ClipVisionResult);

    const markers = aggregateFrameMarkers(frameAudits);

    log(`[${clip.id}] done`);
    return { id: clip.id, url: clip.url, duration_s: round(duration, 2), vision: visionResult, markers, audio, silence, frame_paths: framePaths };
  } catch (e: any) {
    log(`[${clip.id}] ERROR ${e.message}`);
    return {
      id: clip.id,
      url: clip.url,
      duration_s: round(duration, 2),
      vision: { error: e.message },
      markers: { error: e.message },
      audio: { error: e.message },
      silence: { error: e.message },
      error: e.message,
      frame_paths: framePaths.filter(p => fs.existsSync(p)),
    };
  }
}

function sampleTimestamps(durationS: number): [number, number, number] {
  const clamp = (t: number) => Math.max(0, Math.min(t, Math.max(0, durationS - 0.05)));
  return [clamp(0.5), clamp(durationS / 2), clamp(durationS - 0.5)];
}

// ---- Cross-clip ----

async function runCrossClip(
  refImage: ImagePart,
  results: ClipResult[],
): Promise<CrossClipDrift | { error: string }> {
  const usable = results.filter(r => r.frame_paths[1] && fs.existsSync(r.frame_paths[1]));
  if (usable.length < 2) return { error: `only ${usable.length} clips have a middle frame; need >= 2` };

  const labelList = usable.map((r, idx) => `  IMAGE ${idx + 2}: ${r.id}`).join("\n");
  const prompt = `${CROSS_CLIP_PROMPT_PREAMBLE}\n${labelList}${CROSS_CLIP_PROMPT_SUFFIX}`;

  const images: ImagePart[] = [refImage, ...usable.map(r => imageFromFile(r.frame_paths[1]))];
  return sonnetVisionJson<CrossClipDrift>(images, prompt, { maxTokens: 1200 });
}

// ---- Markdown rendering ----

function renderReport(opts: {
  label: string;
  referenceUrl: string;
  results: ClipResult[];
  drift: CrossClipDrift | { error: string };
}): string {
  const { label, referenceUrl, results, drift } = opts;
  const visionDims = ["identity", "hair", "framing", "background_consistency", "lighting"] as const;
  const colHeader = ["Identity", "Markers", "Hair", "Framing", "Bg", "Lighting"];

  const headerLine = `| Clip | ${colHeader.join(" | ")} | Audio Pacing | Silence | Hard Fails |`;
  const sepLine = `|------|${colHeader.map(() => "----").join("|")}|----|----|----|`;

  const rows = results.map(r => {
    const visionErr = "error" in r.vision;
    const markersErr = "error" in r.markers;
    if (visionErr && markersErr) {
      return `| ${r.id} | ${colHeader.map(() => "ERR").join(" | ")} | ${audioCell(r)} | ${silenceCell(r)} | ${visionErrCell(r)} |`;
    }
    const cells: string[] = [];
    cells.push(visionErr ? "ERR" : `${(r.vision as ClipVisionResult).identity.score}/5`);
    cells.push(markersErr ? "ERR" : `${(r.markers as IdentityMarkerResult).aggregate_score}/5`);
    cells.push(visionErr ? "ERR" : `${(r.vision as ClipVisionResult).hair.score}/5`);
    cells.push(visionErr ? "ERR" : `${(r.vision as ClipVisionResult).framing.score}/5`);
    cells.push(visionErr ? "ERR" : `${(r.vision as ClipVisionResult).background_consistency.score}/5`);
    cells.push(visionErr ? "ERR" : `${(r.vision as ClipVisionResult).lighting.score}/5`);
    const visionHf = visionErr ? [] : (r.vision as ClipVisionResult).hard_fails;
    const silenceHf = !("error" in r.silence) && r.silence.status !== "OK" ? [`silence: ${r.silence.status}`] : [];
    const allHf = [...visionHf, ...silenceHf];
    const hf = visionErr ? "—" : (allHf.length === 0 ? "none" : allHf.join("; "));
    return `| ${r.id} | ${cells.join(" | ")} | ${audioCell(r)} | ${silenceCell(r)} | ${escapeCell(hf)} |`;
  });

  // Averages over numeric results
  const numericVision = results.filter(r => !("error" in r.vision)) as (ClipResult & { vision: ClipVisionResult })[];
  const numericMarkers = results.filter(r => !("error" in r.markers)) as (ClipResult & { markers: IdentityMarkerResult })[];
  const avgParts: string[] = [];
  if (numericVision.length > 0) {
    avgParts.push(...visionDims.map(d => {
      const avg = numericVision.reduce((s, r) => s + (r.vision as any)[d].score, 0) / numericVision.length;
      return `${labelize(d)} ${avg.toFixed(1)}`;
    }));
  }
  if (numericMarkers.length > 0) {
    const avg = numericMarkers.reduce((s, r) => s + r.markers.aggregate_score, 0) / numericMarkers.length;
    avgParts.splice(1, 0, `Markers ${avg.toFixed(1)}`); // insert after Identity
  }
  const averages = avgParts.length > 0 ? avgParts.join(" · ") : "no successful results";

  const perClipDetail = results.map(r => renderClipDetail(r)).join("\n");

  const driftSection = "error" in drift
    ? `_Cross-clip vision call failed: ${drift.error}_`
    : renderDriftSection(drift);

  const ts = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return `# Avatar QA Report — ${label}
Generated: ${ts}
Reference: ${referenceUrl}
Clips: ${results.length}

## Per-clip scores

${headerLine}
${sepLine}
${rows.join("\n")}

**Average:** ${averages}

## Per-clip detail
${perClipDetail}

## Cross-clip drift analysis

${driftSection}

## Comparison to prior baseline (manual entry by Yaron)

_Empty section — fill in chat with delta vs prior test._
`;
}

function audioCell(r: ClipResult): string {
  if ("error" in r.audio) return `ERR (${escapeCell(r.audio.error)})`;
  const tag = r.audio.status === "OK" ? "OK" : r.audio.status;
  return `${tag} (${r.audio.wps.toFixed(2)} wps)`;
}

function silenceCell(r: ClipResult): string {
  if ("error" in r.silence) return `ERR`;
  const lead = r.silence.lead_silence_s.toFixed(2);
  const tail = r.silence.tail_silence_s.toFixed(2);
  if (r.silence.status === "OK") return `OK (lead ${lead}s · tail ${tail}s)`;
  return `**${r.silence.status}** (lead ${lead}s · tail ${tail}s)`;
}

function visionErrCell(r: ClipResult): string {
  if ("error" in r.vision) return `vision ERR: ${escapeCell(r.vision.error)}`;
  return "—";
}

function renderClipDetail(r: ClipResult): string {
  const head = `\n### ${r.id}\n- **Duration:** ${r.duration_s}s\n- **URL:** ${r.url}`;
  if (r.error) return `${head}\n- **ERROR:** ${r.error}`;

  const visionLines = "error" in r.vision
    ? `- **Vision call failed:** ${r.vision.error}`
    : ([
        ["Identity",  r.vision.identity],
        ["Hair",      r.vision.hair],
        ["Framing",   r.vision.framing],
        ["Background (within clip)", r.vision.background_consistency],
        ["Lighting",  r.vision.lighting],
      ] as const)
        .map(([k, v]) => `- **${k} (${v.score}/5):** ${v.notes}`)
        .join("\n") +
        `\n- **Hard fails:** ${r.vision.hard_fails.length === 0 ? "none" : r.vision.hard_fails.join("; ")}` +
        `\n- **Summary:** ${r.vision.summary}`;

  const markerLines = renderMarkerBlock(r.markers);

  const audioLines = "error" in r.audio
    ? `- **Audio (proxy for sync issues):** ERROR — ${r.audio.error}`
    : `- **Audio (proxy for sync issues):** ${r.audio.word_count} words / ${r.audio.clip_duration_s}s = ${r.audio.wps.toFixed(2)} wps — ${r.audio.status}. Speech covers ${(r.audio.speech_coverage * 100).toFixed(0)}% of clip.${r.audio.transcript ? `\n  - Transcript: "${r.audio.transcript}"` : ""}`;

  const silenceLines = "error" in r.silence
    ? `- **Silence check:** ERROR — ${r.silence.error}`
    : `- **Silence check:** ${r.silence.status === "OK" ? "OK" : `**${r.silence.status}**`} — ${r.silence.notes}`;

  return `${head}\n${visionLines}\n${markerLines}\n${audioLines}\n${silenceLines}`;
}

function renderMarkerBlock(m: ClipResult["markers"]): string {
  if ("error" in m) return `- **Identity markers:** vision call failed — ${m.error}`;
  const refList = m.reference_markers_summary.length === 0
    ? "_(none enumerated)_"
    : m.reference_markers_summary.map(e => `\`${e.region}\`: ${e.description}`).join("; ");

  const perFrameLines = m.per_frame
    .map((f, i) => {
      if ("error" in f) return `  - Frame ${i + 1}: ERROR — ${f.error}`;
      const fm = f.frame_markers.length === 0
        ? "_(none)_"
        : f.frame_markers.map(e => `\`${e.region}\`: ${e.description}`).join("; ");
      return `  - Frame ${i + 1} (${f.score}/5): ${fm} — _${f.reasoning}_`;
    })
    .join("\n");

  const disagreementLines = m.all_disagreements.length === 0
    ? "  - _no disagreements_"
    : m.all_disagreements
        .map(d => `  - **[${d.type}]** \`${d.region}\` (frame ${d.frame_index}): ${d.detail}`)
        .join("\n");

  return [
    `- **Identity markers (${m.aggregate_score}/5 — min across 3 frames):**`,
    `  - Reference markers (de-duped): ${refList}`,
    `  - Per-frame audit:`,
    perFrameLines,
    `  - Disagreements:`,
    disagreementLines,
  ].join("\n");
}

function renderDriftSection(d: CrossClipDrift): string {
  const dims = [
    ["Identity drift",   d.identity_drift],
    ["Hair drift",       d.hair_drift],
    ["Background drift", d.background_drift],
    ["Framing drift",    d.framing_drift],
  ] as const;
  const lines = dims.map(([k, v]) => {
    const which = v.which_clips.length === 0 ? "" : ` — clips: ${v.which_clips.join(", ")}`;
    return `- **${k}:** ${v.severity}${which}${v.notes ? ` — ${v.notes}` : ""}`;
  });
  return `${lines.join("\n")}\n\n## Overall verdict: ${d.overall_verdict}\n\nReasoning: ${d.verdict_reasoning}`;
}

function labelize(dim: string): string {
  return dim.split("_").map(p => p[0].toUpperCase() + p.slice(1)).join(" ");
}

function escapeCell(s: string): string { return s.replace(/\|/g, "\\|").replace(/\n/g, " "); }

// ---- Main ----

async function main() {
  const referenceUrl = args.reference!;
  const referencePath = path.join(tmpDir, "reference.png");

  log(`[setup] reference -> ${referencePath}`);
  await downloadFile(referenceUrl, referencePath);
  const refImage = imageFromFile(referencePath);

  log(`[run] processing ${clips.length} clip(s) in parallel`);
  const results = await Promise.all(clips.map(c => processClip(c, refImage)));

  log(`[cross-clip] running drift analysis ...`);
  const drift = await runCrossClip(refImage, results);

  const report = renderReport({
    label: args.label || "(unlabeled)",
    referenceUrl,
    results,
    drift,
  });

  process.stdout.write(report);

  if (args.keepTmp) {
    log(`[cleanup] --keep-tmp set; preserving ${tmpDir}`);
  } else {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    log(`[cleanup] removed ${tmpDir}`);
  }
}

main().catch(e => { console.error(`[fatal] ${e.stack || e.message}`); process.exit(1); });
