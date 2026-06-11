// Avatar Full v5 orchestrator CLI.
//
// Hybrid pipeline: the Claude Code session orchestrates by interleaving
// Higgsfield MCP `generate_video` calls with invocations of this CLI for
// the deterministic (non-MCP) phases. State flows between phases via
// workdir/v5-state.json (see video/lib/v5-state.ts).
//
// Usage:
//   render-avatar-full-v5.ts --phase=<name> --workdir=<path> [phase-args]
//
// Phases:
//   init         Loads content_queue row, writes initial v5-state.json
//                Args: --content-id=<uuid>
//   tts          Generates per-clip ElevenLabs MP3s, uploads to Supabase
//   record       Records a Seedance generation result on a specific clip
//                Args: --clip-id=<id> --job-id=<id> --video-url=<url>
//                      --cost-credits=<n> --cost-usd=<n> --mode=<std|fast>
//   verify       Runs Whisper WER + speech-coverage on the recorded clip
//                Args: --clip-id=<id>
//                Exits non-zero if verify_status != PASS
//   face-metrics Extracts start+end frames from each PASS clip, runs the
//                Python sidecar, writes face_metrics into state
//   manifest     Builds the transitions manifest from face_metrics
//   compose      Renders AvatarV5Composition to workdir/final.mp4
//   upload       Uploads final.mp4 to Supabase post-images/avatar-full-v5/
//   qa           Runs avatar-v1 QA agent on final.mp4 (informational)
//   cover        Generates the cover image (Gemini Nano Banana, reference-
//                based on start_image) + persists thumbnail_asset_url and
//                cover_asset_url with a fetchability post-check. Exits 5
//                when the Soul 2.0 fallback is needed (session MCP action).
//   cover-record Records a session-generated Soul 2.0 fallback cover
//                Args: --image-url=<url> [--cost-usd=<n>]
//   summary      Prints the human-review summary including per-bridge
//                timestamps (Phase 9 ear-check requirement)
//
// docs/specs/AVATAR_FULL_V5.md is the authoritative spec for which calls
// the session makes between which phases.

import { config } from "dotenv";
import fs from "node:fs";

// Layered .env loading. Yesterday's worktree convention put OPENAI/SUPABASE/
// etc. in <SMT-root>/.env and ELEVENLABS/HEYGEN/etc. in <SMT-root>/video/.env.
// We honor both by loading every .env we find on the walk-up (override:false
// so the most-local file wins on conflicts).
for (const rel of [
  "../.env",         // <worktree>/video/.env   (symlinked to SMT/video/.env)
  "../../.env",      // <worktree>/.env         (symlinked to SMT/.env)
  "../../../.env",
  "../../../../.env",
  "../../../../../.env",
]) {
  const p = new URL(rel, import.meta.url).pathname;
  if (fs.existsSync(p)) config({ path: p, override: false });
}

import path from "node:path";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { loadState, saveState, initState, statePath, type V5State } from "../lib/v5-state.js";
import { generatePerClipMp3s } from "../lib/elevenlabs-per-clip.js";
import { computeWer, WER_PASS_THRESHOLD } from "../qa/base/helpers/wer.js";
import { whisperTranscribe, extractAudioMp3, downloadFile, probeDurationSeconds, imageFromFile } from "../lib/qa-helpers.js";
import { buildTransitionsManifest } from "../lib/transitions-manifest.js";
import { measureFrames } from "../lib/face-metrics.js";
import { buildPhrases } from "../lib/phrase-grouper.js";
import { buildRenderLifecyclePatch } from "../lib/render-lifecycle-patch.js";
import { AVATAR_V5_FPS, AUDIO_BRIDGE_FRAMES, AVATAR_V5_WIDTH, AVATAR_V5_HEIGHT } from "../src/templates/avatar-v5/types.js";
import { layoutClips } from "../src/templates/avatar-v5/AvatarV5Composition.js";
import { checkAudioBoundaries } from "../lib/audio-boundary-check.js";
import { pickAndPersistCombination, type PickAndPersistDeps } from "../lib/v5-init-combination.js";
import {
  listActiveLooks,
  listActiveStills,
  getRecentLookPicks,
  getRecentLocationPicks,
} from "../lib/wardrobe-rotation/index.js";
import { listActiveLocations } from "../lib/location/index.js";
import {
  buildCoverPrompt,
  composeCoverWithBanner,
  GEMINI_IMAGE_MODEL,
  parseRecentCovers,
  productionCoverChainDeps,
  qaCover,
  runCoverChain,
  type CoverDirective,
  type CoverMetadata,
  type CoverQaReport,
  type CoverSource,
} from "../lib/cover/index.js";

// ─── Arg parsing ─────────────────────────────────────────────────────────

type Args = Record<string, string>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = "true";
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

function requireArg(args: Args, name: string): string {
  const v = args[name];
  if (v === undefined) throw new Error(`--${name}=<value> is required`);
  return v;
}

// ─── Supabase helpers ────────────────────────────────────────────────────

function supa() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key);
}

async function uploadToPostImages(bucketPath: string, localPath: string, contentType: string): Promise<string> {
  const buf = fs.readFileSync(localPath);
  const { error } = await supa().storage.from("post-images").upload(bucketPath, buf, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supa().storage.from("post-images").getPublicUrl(bucketPath);
  return data.publicUrl;
}

// ─── Phase: init ─────────────────────────────────────────────────────────

/**
 * Production deps for the wardrobe × location combination resolution. Wraps
 * the skill DB layer + a Supabase merge-update for content_queue.avatar_config.
 *
 * generateAnchoredStill is intentionally a throw — the v5 Node script cannot
 * safely invoke Higgsfield MCP from Node (the playbook owns those calls). If
 * pickCombination returns needs_generation: true, the operator must
 * bootstrap the missing still from the session via the location skill,
 * then re-run --phase=init.
 */
function productionCombinationDeps(): PickAndPersistDeps {
  return {
    listActiveLooks,
    listActiveLocations,
    listActiveStills,
    getRecentLookPicks,
    getRecentLocationPicks,
    generateAnchoredStill: async (look_id, location_id) => {
      throw new Error(
        `pickCombination returned needs_generation: true for look=${look_id}/location=${location_id}, ` +
          `but the v5 Node renderer cannot bootstrap stills (Higgsfield MCP is session-scoped). ` +
          `Run the location skill's generateAnchoredStill flow from the Claude Code session, ` +
          `then re-run --phase=init.`,
      );
    },
    updateAvatarConfig: async (content_id, patch) => {
      const { data: cur, error: selErr } = await supa()
        .from("content_queue")
        .select("avatar_config")
        .eq("id", content_id)
        .single();
      if (selErr || !cur) throw new Error(`updateAvatarConfig: read failed for ${content_id}: ${selErr?.message ?? "no row"}`);
      const merged = { ...((cur.avatar_config as Record<string, unknown> | null) ?? {}), ...patch };
      const { error: updErr } = await supa()
        .from("content_queue")
        .update({ avatar_config: merged })
        .eq("id", content_id);
      if (updErr) throw new Error(`updateAvatarConfig: write failed for ${content_id}: ${updErr.message}`);
    },
    readAvatarConfig: async (content_id) => {
      const { data, error } = await supa()
        .from("content_queue")
        .select("avatar_config")
        .eq("id", content_id)
        .single();
      if (error || !data) throw new Error(`readAvatarConfig: ${content_id}: ${error?.message ?? "no row"}`);
      const cfg = (data.avatar_config as Record<string, unknown> | null) ?? {};
      return {
        look_id: cfg.look_id as string | undefined,
        location_id: cfg.location_id as string | undefined,
        still_id: cfg.still_id as string | undefined,
      };
    },
  };
}

async function phaseInit(args: Args): Promise<void> {
  const contentId = requireArg(args, "content-id");
  const workdir = requireArg(args, "workdir");
  fs.mkdirSync(workdir, { recursive: true });

  const { data: row, error } = await supa()
    .from("content_queue")
    .select("id, hook, caption, content_pillar, avatar_config, metadata")
    .eq("id", contentId)
    .single();
  if (error || !row) throw new Error(`content_queue ${contentId} not found: ${error?.message ?? "no row"}`);

  const avCfg = row.avatar_config as Record<string, any> | null;
  if (!avCfg || !Array.isArray(avCfg.clips) || avCfg.clips.length < 2) {
    throw new Error(`content_queue ${contentId}.avatar_config.clips missing or < 2 entries`);
  }
  const clips = avCfg.clips.map((c: any) => ({
    id: String(c.id),
    expected_script: String(c.expected_script ?? c.script ?? ""),
    duration_target_s: Number(c.duration_target_s ?? c.duration_s ?? 8),
  }));
  for (const c of clips) {
    if (!c.expected_script) throw new Error(`avatar_config.clips[${c.id}].expected_script is empty`);
  }

  // PR-B: pick wardrobe × location combination, materialize start_image, and
  // persist all three IDs back to content_queue.avatar_config with post-write
  // verify (May 2026 "every persistent write needs a post-check" principle).
  const combination = await pickAndPersistCombination(contentId, productionCombinationDeps());
  console.log(
    `[init] picked look=${combination.look_id} location=${combination.location_id} still=${combination.still_id}`,
  );

  const state = initState({
    content_id: contentId,
    workdir,
    hook_text: String(avCfg.hook ?? row.hook ?? ""),
    hook_primary: avCfg.hook_primary ? String(avCfg.hook_primary) : undefined,
    hook_secondary: avCfg.hook_secondary ? String(avCfg.hook_secondary) : undefined,
    register: String(avCfg.register ?? "concerned_insider"),
    clips,
    look_id: combination.look_id,
    location_id: combination.location_id,
    still_id: combination.still_id,
    start_image_url: combination.start_image_url,
    voice_id: avCfg.voice_id ? String(avCfg.voice_id) : undefined,
  });
  saveState(state);
  console.log(`[init] state at ${statePath(workdir)}`);
  console.log(`[init] ${clips.length} clip(s), register=${state.register}, hook="${state.hook_text.slice(0, 60)}…"`);
  console.log(`[init] start_image_url=${combination.start_image_url}`);
}

// ─── Phase: tts ──────────────────────────────────────────────────────────

async function phaseTts(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  const audioDir = path.join(workdir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const mp3s = await generatePerClipMp3s({
    clips: state.clips.map((c) => ({ id: c.id, expected_script: c.expected_script })),
    workdir: audioDir,
    voice_id: state.voice_id,
  });
  for (const m of mp3s) {
    const clip = state.clips.find((c) => c.id === m.clip_id);
    if (!clip) continue;
    clip.mp3_local_path = m.mp3_path;
    const bucketPath = `avatar-full-v5/audio/${state.content_id}/${m.clip_id}-${Date.now()}.mp3`;
    clip.mp3_public_url = await uploadToPostImages(bucketPath, m.mp3_path, "audio/mpeg");
    console.log(`[tts] ${m.clip_id} → ${clip.mp3_public_url}`);
  }
  saveState(state);
}

// ─── Phase: record (called by session after MCP generate_video returns) ──

async function phaseRecord(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const clipId = requireArg(args, "clip-id");
  const state = loadState(workdir);
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`clip ${clipId} not in state`);

  clip.seedance_job_id = requireArg(args, "job-id");
  clip.seedance_video_url = requireArg(args, "video-url");
  clip.seedance_cost_credits = Number(args["cost-credits"] ?? 50);
  clip.seedance_cost_usd = Number(args["cost-usd"] ?? clip.seedance_cost_credits! * 0.013);
  clip.verify_mode_used = (args["mode"] as "std" | "fast") ?? "std";
  clip.verify_attempts = (clip.verify_attempts ?? 0) + 1;

  state.total_higgsfield_credits = (state.total_higgsfield_credits ?? 0) + clip.seedance_cost_credits!;
  state.total_usd = (state.total_usd ?? 0) + clip.seedance_cost_usd!;
  saveState(state);
  console.log(`[record] ${clipId} attempt ${clip.verify_attempts} mode=${clip.verify_mode_used} cost=${clip.seedance_cost_credits}cr cumulative=${state.total_higgsfield_credits}cr`);

  // Hard ceiling sized against ACTUAL observed Phase 9 costs (81cr/clip at
  // 1080p std). 7 × 81 = 567cr for the base render; +153cr for the YAR-137
  // subject-distance-lock spike (clip_02 + clip_05b re-rendered with
  // augmented prompts) → 700cr total. Revisable per-piece. See
  // docs/specs/AVATAR_FULL_V5.md.
  const HARD_CEILING_CREDITS = 700;
  if ((state.total_higgsfield_credits ?? 0) > HARD_CEILING_CREDITS) {
    console.error(`[ABORT] cumulative ${state.total_higgsfield_credits}cr exceeds hard ceiling ${HARD_CEILING_CREDITS}cr. Surface to human.`);
    process.exit(4);
  }
}

// ─── Phase: verify ──────────────────────────────────────────────────────

async function phaseVerify(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const clipId = requireArg(args, "clip-id");
  const state = loadState(workdir);
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`clip ${clipId} not in state`);
  if (!clip.seedance_video_url) throw new Error(`clip ${clipId} has no recorded seedance_video_url — run --phase=record first`);

  const localMp4 = path.join(workdir, "clips", `${clipId}.mp4`);
  fs.mkdirSync(path.dirname(localMp4), { recursive: true });
  await downloadFile(clip.seedance_video_url, localMp4);
  const audioPath = path.join(workdir, "clips", `${clipId}.mp3`);
  extractAudioMp3(localMp4, audioPath);

  const whisper = await whisperTranscribe(audioPath);
  clip.whisper_transcript = whisper.text.trim();
  clip.whisper_duration_s = whisper.duration;
  // Persist word-level timestamps for caption generation (Finding 4 —
  // source is Seedance embedded audio, not the original ElevenLabs MP3).
  clip.whisper_words = whisper.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
  clip.phrases = buildPhrases(clip.whisper_words);

  const wer = computeWer(clip.expected_script, clip.whisper_transcript);
  clip.whisper_wer = wer.wer;

  const coverage = whisper.words.length > 0
    ? (whisper.words[whisper.words.length - 1].end - whisper.words[0].start) / Math.max(clip.duration_target_s, 0.001)
    : 0;
  clip.whisper_speech_coverage = coverage;

  if (wer.wer > WER_PASS_THRESHOLD) clip.verify_status = "FAIL_WER";
  else if (coverage < 0.5) clip.verify_status = "FAIL_COVERAGE";
  else clip.verify_status = "PASS";

  saveState(state);
  console.log(`[verify] ${clipId} WER=${(wer.wer * 100).toFixed(2)}% coverage=${(coverage * 100).toFixed(0)}% → ${clip.verify_status}`);
  if (clip.verify_status !== "PASS") {
    if (clip.verify_attempts === 1 && clip.verify_mode_used === "std") {
      console.log(`[verify] suggest retry: mode=fast`);
      process.exit(2); // signal: retry-needed
    } else {
      clip.surfaced_for_human = true;
      saveState(state);
      console.log(`[verify] surfacing ${clipId} to human (attempts=${clip.verify_attempts})`);
      process.exit(3); // signal: surface-to-human
    }
  }
}

// ─── Phase: face-metrics ────────────────────────────────────────────────

function extractFrameToPng(mp4Path: string, timestampS: number, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-y", "-ss", String(timestampS), "-i", mp4Path, "-frames:v", "1", outPath],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!fs.existsSync(outPath)) throw new Error(`frame extract failed: ${outPath}`);
}

async function phaseFaceMetrics(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  const passClips = state.clips.filter((c) => c.verify_status === "PASS");
  if (passClips.length === 0) throw new Error("no PASS clips to measure. Run --phase=verify on each clip first.");

  const framesDir = path.join(workdir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  const requests: Array<{ id: string; path: string; kind: "start" | "end"; clip_id: string }> = [];

  for (const clip of passClips) {
    const localMp4 = path.join(workdir, "clips", `${clip.id}.mp4`);
    if (!fs.existsSync(localMp4)) {
      // Re-download if --phase=verify cleaned up.
      await downloadFile(clip.seedance_video_url!, localMp4);
    }
    const dur = probeDurationSeconds(localMp4);
    const startPng = path.join(framesDir, `${clip.id}-start.png`);
    const endPng = path.join(framesDir, `${clip.id}-end.png`);
    extractFrameToPng(localMp4, 0.0, startPng);
    extractFrameToPng(localMp4, Math.max(0, dur - 0.1), endPng);
    requests.push({ id: `${clip.id}::start`, path: startPng, kind: "start", clip_id: clip.id });
    requests.push({ id: `${clip.id}::end`,   path: endPng,   kind: "end",   clip_id: clip.id });
  }

  const measurements = await measureFrames({ frames: requests.map((r) => ({ id: r.id, path: r.path })) });
  state.face_metrics = state.face_metrics ?? {};
  for (const r of requests) {
    state.face_metrics[r.clip_id] = state.face_metrics[r.clip_id] ?? {};
    const m = measurements.find((x) => x.id === r.id);
    if (!m) continue;
    if (m.error) {
      state.face_metrics[r.clip_id].errors = [...(state.face_metrics[r.clip_id].errors ?? []), `${r.kind}: ${m.error}`];
      continue;
    }
    state.face_metrics[r.clip_id][r.kind] = {
      eye_y: m.eye_y!, face_x: m.face_x!, face_w: m.face_w!, face_h: m.face_h!,
      img_w: m.img_w!, img_h: m.img_h!,
    };
  }
  saveState(state);
  console.log(`[face-metrics] measured ${passClips.length} clip(s), ${requests.length} frame(s)`);
  for (const clip of passClips) {
    const fm = state.face_metrics[clip.id];
    console.log(`  ${clip.id}: start_eye_y=${fm?.start?.eye_y ?? "—"}, end_eye_y=${fm?.end?.eye_y ?? "—"}, errors=${(fm?.errors ?? []).join("; ") || "none"}`);
  }
}

// ─── Phase: compose ─────────────────────────────────────────────────────

async function phaseCompose(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  const passClips = state.clips.filter((c) => c.verify_status === "PASS");
  if (passClips.length === 0) throw new Error("no PASS clips to compose");
  if (!state.transitions_manifest) throw new Error("transitions_manifest missing — run --phase=manifest first");

  // Serve clip MP4s + watermark assets locally so the headless browser can fetch
  // them via http(s) (Remotion's fetcher rejects file:// URLs).
  const server = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(404).end(); return; }
    const m = /^\/clip\/([^/?]+)$/.exec(req.url);
    if (!m) { res.writeHead(404).end(); return; }
    const local = path.join(workdir, "clips", decodeURIComponent(m[1]));
    if (!fs.existsSync(local)) { res.writeHead(404).end(); return; }
    const stat = statSync(local);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size });
    createReadStream(local).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  try {
    const cropById = new Map(state.transitions_manifest.crops.map((c) => [c.clip_id, c.crop_offset_y]));
    const inputProps = {
      clips: passClips.map((c) => ({
        id: c.id,
        video_url: `http://127.0.0.1:${port}/clip/${c.id}.mp4`,
        duration_s: c.whisper_duration_s ?? c.duration_target_s,
        crop_offset_y: cropById.get(c.id) ?? 0,
        phrases: c.phrases ?? [],
      })),
      transitions: state.transitions_manifest.transitions.map((t) => ({
        cut_index: t.cut_index,
        needs_motion_blur: t.needs_motion_blur,
        bridge_enabled: t.bridge_enabled,
      })),
      hook_primary: state.hook_primary,
      hook_secondary: state.hook_secondary,
    };

    const layout = layoutClips(inputProps, AVATAR_V5_FPS);
    console.log(`[compose] ${inputProps.clips.length} clip(s), total ${layout.total_duration_in_frames} frames (${(layout.total_duration_in_frames / AVATAR_V5_FPS).toFixed(2)}s)`);

    const entryPoint = path.resolve(process.cwd(), "src", "index.ts");
    const bundleLocation = await bundle({ entryPoint });
    const composition = await selectComposition({ serveUrl: bundleLocation, id: "AvatarV5", inputProps });
    composition.durationInFrames = Math.max(1, layout.total_duration_in_frames);

    const outPath = path.join(workdir, "final.mp4");
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
    });
    state.final_local_path = outPath;
    saveState(state);
    console.log(`[compose] rendered ${outPath} (${fs.statSync(outPath).size} bytes)`);

    // Audio-boundary QA gate (2026-06-10): prove every cut is splice-clean.
    // Catches the "chopped word" regression — an un-faded splice spikes the
    // sample-to-sample delta at the cut; a clean cross-fade keeps it ~baseline.
    const pcmPath = path.join(workdir, "final-audio.f32");
    execFileSync("ffmpeg", ["-y", "-i", outPath, "-ac", "1", "-ar", "48000", "-f", "f32le", pcmPath], { stdio: "ignore" });
    const pcmBuf = fs.readFileSync(pcmPath);
    const pcm = new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, Math.floor(pcmBuf.length / 4));
    const cuts = layout.entries.slice(1).map((e, i) => ({
      label: `${passClips[i].id}→${passClips[i + 1].id}`,
      time_s: e.from_frame / AVATAR_V5_FPS,
    }));
    const audioReport = checkAudioBoundaries(pcm, 48000, cuts);
    fs.rmSync(pcmPath, { force: true });
    state.audio_boundary_report = audioReport;
    saveState(state);
    console.log(`[compose] audio-boundary QA: ${audioReport.verdict} (max quiet-region jump threshold ${audioReport.threshold})`);
    for (const b of audioReport.boundaries) {
      console.log(`  ${b.cut_label.padEnd(16)} quiet_jump=${b.max_quiet_jump.toFixed(4)} ${b.ok ? "ok" : "⚠ SPLICE DISCONTINUITY"}`);
    }
    if (audioReport.verdict === "FAIL") {
      console.error(
        `[compose] ⚠ AUDIO-BOUNDARY QA FAILED at ${audioReport.failures.length} cut(s): ` +
          `${audioReport.failures.map((f) => f.cut_label).join(", ")}. ` +
          `Likely an un-faded splice (chopped-word click). Do NOT ship until resolved.`,
      );
    }
  } finally {
    server.close();
  }
}

// ─── Phase: upload ──────────────────────────────────────────────────────

async function phaseUpload(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  if (!state.final_local_path) throw new Error("final_local_path missing — run --phase=compose first");
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const bucketPath = `avatar-full-v5/${state.content_id}/${runTs}/final.mp4`;
  state.final_public_url = await uploadToPostImages(bucketPath, state.final_local_path, "video/mp4");
  const uploadCompletedAt = new Date().toISOString();
  saveState(state);
  console.log(`[upload] ${state.final_public_url}`);

  // YAR-145 L1: close the render lifecycle. The MP4 is uploaded, so mark the
  // row rendered so a later audit never concludes "never rendered" and
  // re-renders a shipped piece. ONLY the three render-lifecycle columns —
  // render_profile_id / metadata.video_url / status stay approval-gated.
  // This runs BEFORE the best-effort metadata persist below (which has
  // warn+return early-exits) so the lifecycle always closes once the MP4 is up.
  const lifecycle = buildRenderLifecyclePatch(state.final_public_url, uploadCompletedAt);
  const lifeUpd = await supa()
    .from("content_queue")
    .update(lifecycle)
    .eq("id", state.content_id);
  if (lifeUpd.error) {
    throw new Error(`[upload] render-lifecycle writeback failed: ${lifeUpd.error.message}`);
  }
  console.log(`[upload] render lifecycle closed: render_status=complete final_asset_url set render_completed_at=${lifecycle.render_completed_at}`);

  // Persist caption + Whisper telemetry to content_queue.metadata so it
  // survives workdir cleanup. Source of truth stays in workdir/v5-state.json
  // until the row is updated; after this write, the row IS the source of
  // truth for downstream consumers (approval UI, caption editor, etc.).
  //
  // Schema (see docs/specs/AVATAR_FULL_V5.md "Upload contract"):
  //   metadata.phrases:       flat array of { clip_id, phrase_text, start_s, end_s }
  //                           clip-local timestamps (start_s 0 = clip start, not composition start)
  //   metadata.whisper_words: per-clip array of { clip_id, duration_s, transcript, words[] }
  //                           each words[] entry = { word, start, end } clip-local
  //
  // Written ABOVE (render lifecycle): render_status / final_asset_url /
  // render_completed_at. NOT touched anywhere here: content_queue.status,
  // render_profile_id, metadata.video_url. Those flip only after human
  // approval (the DB-flip-on-approval invariant).
  const phrases = state.clips
    .filter((c) => c.verify_status === "PASS")
    .flatMap((c) =>
      (c.phrases ?? []).map((p) => ({
        clip_id: c.id,
        phrase_text: p.text,
        start_s: p.start_s,
        end_s: p.end_s,
      })),
    );
  const whisper_words = state.clips
    .filter((c) => c.verify_status === "PASS")
    .map((c) => ({
      clip_id: c.id,
      duration_s: c.whisper_duration_s,
      transcript: c.whisper_transcript,
      words: (c.whisper_words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    }));

  const cur = await supa()
    .from("content_queue")
    .select("metadata")
    .eq("id", state.content_id)
    .single();
  if (cur.error) {
    console.warn(`[upload] could not read current metadata: ${cur.error.message} — skipping metadata persist`);
    return;
  }
  const newMetadata = {
    ...((cur.data?.metadata as Record<string, unknown>) ?? {}),
    phrases,
    whisper_words,
  };
  const upd = await supa()
    .from("content_queue")
    .update({ metadata: newMetadata })
    .eq("id", state.content_id);
  if (upd.error) {
    console.warn(`[upload] metadata persist failed: ${upd.error.message} — final video uploaded, metadata not written`);
    return;
  }
  console.log(`[upload] metadata persisted: ${phrases.length} phrases, ${whisper_words.length} per-clip Whisper entries`);
}

// ─── Phase: qa ──────────────────────────────────────────────────────────

async function phaseQa(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  if (!state.final_local_path) throw new Error("final_local_path missing — run --phase=compose first");

  // Build the metadata.json the existing video/qa/run.ts CLI expects.
  const metadataPath = path.join(workdir, "qa-metadata.json");
  const metadata = {
    asset_id: state.content_id,
    reference_image_url: state.start_image_url,
    clips: state.clips
      .filter((c) => c.verify_status === "PASS")
      .map((c, i, all) => ({
        id: c.id,
        url: c.seedance_video_url,
        local_path: path.join(workdir, "clips", `${c.id}.mp4`),
        expected_script: c.expected_script,
        duration_s: c.whisper_duration_s ?? c.duration_target_s,
        start_offset_in_final_s: all.slice(0, i).reduce((acc, x) => acc + (x.whisper_duration_s ?? x.duration_target_s), 0),
      })),
    hook_overlay_text: { line1: state.hook_text },
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  const qaArgs = [
    path.resolve(process.cwd(), "qa", "run.ts"),
    "--asset", state.final_local_path,
    "--profile", "avatar-v1",
    "--metadata", metadataPath,
    "--variant", "full_avatar",
    "--content-id", state.content_id,
    "--output-dir", path.join(workdir, "qa-report"),
    "--keep-workdir",
  ];
  console.log(`[qa] invoking video/qa/run.ts (informational — does not gate human review)`);
  const r = spawnSync("npx", ["tsx", ...qaArgs], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[qa] WARNING: qa/run.ts exited ${r.status}; continuing — QA is informational.`);
  }
  // Read the latest report file (if produced) to extract verdict + id.
  const reportDir = path.join(workdir, "qa-report");
  if (fs.existsSync(reportDir)) {
    const reports = fs.readdirSync(reportDir).filter((f) => f.endsWith(".json")).sort();
    const last = reports.at(-1);
    if (last) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(reportDir, last), "utf-8"));
        state.qa_report_id = j.asset_id ?? state.content_id;
        state.qa_verdict = j.overall_verdict;
        saveState(state);
        console.log(`[qa] verdict=${j.overall_verdict} unmeasured=[${(j.unmeasured_dimensions ?? []).join(", ")}]`);
      } catch (e) {
        console.error(`[qa] could not parse report JSON: ${(e as Error).message}`);
      }
    }
  }
}

// ─── Phase: cover (+ cover-record) ──────────────────────────────────────
//
// Runs AFTER --phase=upload — the video flow (compose/upload/qa) is already
// complete and untouched; a cover failure never blocks or alters it.
//
// Produces the TWO grid-facing assets of the three-asset contract:
//   thumbnail_asset_url — the video's opening frame + hook banner (extracted
//                         from final.mp4, where SMTHookOverlay is baked into
//                         the first 1.0s). Previously transient; TikTok's
//                         frame-based covers use this path.
//   cover_asset_url     — the purpose-generated cover: Gemini Nano Banana
//                         (direct API, identity from the reference still) →
//                         retry with adjusted prompt → Soul 2.0 via Higgsfield
//                         (session MCP, recorded via --phase=cover-record).
//
// Persistence is a single content_queue update + a hard post-check (re-read
// + HTTP-fetch both URLs). Fails loudly — no silent passes.

/** Build the ≤400-char script summary the directive call uses. */
function scriptSummary(state: V5State): string {
  return state.clips.map((c) => c.expected_script).join(" ").slice(0, 400);
}

async function getRecentCovers(): Promise<ReturnType<typeof parseRecentCovers>> {
  const { data, error } = await supa()
    .from("content_queue")
    .select("metadata")
    .not("metadata->cover", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`[cover] recent-cover query failed: ${error.message}`);
  return parseRecentCovers(data ?? []);
}

async function readToneFromRow(contentId: string): Promise<string | null> {
  const { data, error } = await supa()
    .from("content_queue")
    .select("avatar_config, metadata")
    .eq("id", contentId)
    .single();
  if (error || !data) throw new Error(`[cover] content_queue ${contentId} read failed: ${error?.message ?? "no row"}`);
  const av = (data.avatar_config as Record<string, unknown> | null) ?? {};
  const meta = (data.metadata as Record<string, unknown> | null) ?? {};
  const tone = (av.tone ?? meta.tone) as string | undefined;
  return tone ? String(tone) : null;
}

/**
 * Banner + upload + persist + post-check, shared by --phase=cover (Gemini
 * tiers) and --phase=cover-record (Soul fallback). Throws on any failure.
 */
async function finalizeCoverAndPersist(
  state: V5State,
  rawCover: Buffer,
  directive: CoverDirective,
  source: CoverSource,
  qa: CoverQaReport,
  costUsd: number,
): Promise<void> {
  if (!state.thumbnail_local_path || !fs.existsSync(state.thumbnail_local_path)) {
    throw new Error("[cover] thumbnail_local_path missing — run --phase=cover before cover-record");
  }
  const bannered = await composeCoverWithBanner({
    baseImage: rawCover,
    hookPrimary: state.hook_primary,
    hookSecondary: state.hook_secondary,
  });
  const coverPath = path.join(state.workdir, "cover.png");
  fs.writeFileSync(coverPath, bannered);

  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const thumbnailUrl = await uploadToPostImages(
    `avatar-full-v5/${state.content_id}/${runTs}/thumbnail.png`,
    state.thumbnail_local_path,
    "image/png",
  );
  const coverUrl = await uploadToPostImages(
    `avatar-full-v5/${state.content_id}/${runTs}/cover.png`,
    coverPath,
    "image/png",
  );

  const coverMeta: CoverMetadata = {
    expression: directive.expression,
    gaze: directive.gaze,
    pose: directive.pose,
    framing: directive.framing,
    composition_side: directive.composition_side,
    source,
    model: source === "soul_higgsfield" ? "soul_2" : GEMINI_IMAGE_MODEL,
    qa: {
      verdict: qa.verdict,
      identity_score: qa.identity.score,
      scene_continuity_pass: qa.scene_continuity.pass,
      sameness_flagged: qa.sameness.flagged,
    },
    generated_at: new Date().toISOString(),
    cost_usd: Number(costUsd.toFixed(4)),
  };

  // Single-row update: both asset columns + metadata.cover. Unlike the
  // best-effort caption-telemetry persist in phaseUpload, this write is a
  // HARD gate — any failure throws.
  const cur = await supa().from("content_queue").select("metadata").eq("id", state.content_id).single();
  if (cur.error) throw new Error(`[cover] metadata read failed: ${cur.error.message}`);
  const merged = { ...((cur.data?.metadata as Record<string, unknown>) ?? {}), cover: coverMeta };
  const upd = await supa()
    .from("content_queue")
    .update({ thumbnail_asset_url: thumbnailUrl, cover_asset_url: coverUrl, metadata: merged })
    .eq("id", state.content_id);
  if (upd.error) throw new Error(`[cover] asset persist failed: ${upd.error.message}`);

  // POST-CHECK (fail loudly, no silent passes): re-read the row, assert both
  // URLs landed, then assert both are actually fetchable.
  const chk = await supa()
    .from("content_queue")
    .select("thumbnail_asset_url, cover_asset_url")
    .eq("id", state.content_id)
    .single();
  if (chk.error || !chk.data) throw new Error(`[cover] post-check re-read failed: ${chk.error?.message ?? "no row"}`);
  if (chk.data.thumbnail_asset_url !== thumbnailUrl || chk.data.cover_asset_url !== coverUrl) {
    throw new Error(
      `[cover] post-check MISMATCH: row has thumbnail=${chk.data.thumbnail_asset_url} cover=${chk.data.cover_asset_url}, ` +
        `expected thumbnail=${thumbnailUrl} cover=${coverUrl}`,
    );
  }
  for (const [label, url] of [["thumbnail_asset_url", thumbnailUrl], ["cover_asset_url", coverUrl]] as const) {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) throw new Error(`[cover] post-check: ${label} not fetchable (HTTP ${res.status}): ${url}`);
  }

  state.thumbnail_public_url = thumbnailUrl;
  state.cover = {
    ...(state.cover ?? {}),
    directive,
    source,
    final_local_path: coverPath,
    public_url: coverUrl,
    cost_usd: Number(costUsd.toFixed(4)),
    needs_soul_fallback: false,
  };
  saveState(state);
  console.log(`[cover] PASS post-check — thumbnail=${thumbnailUrl}`);
  console.log(`[cover]                  cover=${coverUrl} (source=${source})`);
}

async function phaseCover(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  if (!state.final_local_path || !fs.existsSync(state.final_local_path)) {
    throw new Error("final.mp4 missing — run --phase=compose first (cover runs after the video flow completes)");
  }
  if (!state.final_public_url) {
    throw new Error("final_public_url missing — run --phase=upload first (cover never blocks or alters the video flow)");
  }

  // 1. Thumbnail: the opening frame at 0.5s — inside SMTHookOverlay's 1.0s
  //    window, so this IS the first-frame + hook-banner visual.
  const thumbPath = path.join(workdir, "thumbnail.png");
  extractFrameToPng(state.final_local_path, 0.5, thumbPath);
  state.thumbnail_local_path = thumbPath;
  saveState(state);
  console.log(`[cover] thumbnail extracted → ${thumbPath}`);

  // 2. Reference still — the SAME Soul-locked start_image the video used
  //    (same look_id, location_id, lighting). Identity comes ONLY from this
  //    image; the prompt never describes Rachel's features.
  const refPath = path.join(workdir, "cover-reference.png");
  await downloadFile(state.start_image_url, refPath);

  // 3. Tone (deterministic directive when the concept brief carries it) +
  //    recent covers for the variance exclusion.
  const tone = await readToneFromRow(state.content_id);
  const recentCovers = await getRecentCovers();
  console.log(`[cover] tone=${tone ?? "(none — Haiku directive)"} recent_covers=${recentCovers.length}`);

  const result = await runCoverChain(
    {
      hook: state.hook_text,
      scriptSummary: scriptSummary(state),
      tone,
      recentCovers,
      referenceImage: fs.readFileSync(refPath),
    },
    productionCoverChainDeps(imageFromFile(refPath)),
  );

  state.cover = {
    directive: result.directive,
    attempts: result.attempts.map((a) => ({ tier: a.tier, verdict: a.qa.verdict })),
    cost_usd: Number(result.cost_usd.toFixed(4)),
  };

  if (result.status === "NEEDS_SOUL_FALLBACK") {
    state.cover.needs_soul_fallback = true;
    state.cover.soul_fallback_prompt = buildCoverPrompt(result.directive, 2);
    saveState(state);
    console.error(
      `[cover] both Gemini tiers failed (${result.attempts.length} QA'd attempt(s)) — Soul 2.0 fallback required.\n` +
        `  From the Claude session: generate via Higgsfield MCP generate_image (model soul_2, Rachel's soul_id,\n` +
        `  the reference still as start frame) using state.cover.soul_fallback_prompt, then run:\n` +
        `    --phase=cover-record --workdir=${workdir} --image-url=<generated-url> [--cost-usd=<n>]`,
    );
    process.exit(5); // signal: soul-fallback-needed (session MCP action)
  }

  const rawPath = path.join(workdir, "cover-raw.png");
  fs.writeFileSync(rawPath, result.rawCover);
  state.cover.raw_local_path = rawPath;
  await finalizeCoverAndPersist(state, result.rawCover, result.directive, result.source, result.qa, result.cost_usd);
}

async function phaseCoverRecord(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const imageUrl = requireArg(args, "image-url");
  const state = loadState(workdir);
  if (!state.cover?.directive) throw new Error("state.cover.directive missing — run --phase=cover first");
  if (!state.cover.needs_soul_fallback) {
    console.warn("[cover-record] state does not flag needs_soul_fallback — recording anyway (manual override)");
  }
  const costUsd = Number(args["cost-usd"] ?? 0.015) + (state.cover.cost_usd ?? 0);

  const rawPath = path.join(workdir, "cover-raw-soul.png");
  await downloadFile(imageUrl, rawPath);
  state.cover.raw_local_path = rawPath;

  // The QA gate is mandatory on every tier. Soul is the LAST tier — a FAIL
  // here has nowhere to fall back to, so it surfaces to human instead of
  // silently passing.
  const refPath = path.join(workdir, "cover-reference.png");
  if (!fs.existsSync(refPath)) await downloadFile(state.start_image_url, refPath);
  const recentCovers = await getRecentCovers();
  const qa = await qaCover({
    coverImage: imageFromFile(rawPath),
    referenceImage: imageFromFile(refPath),
    directive: state.cover.directive,
    previousCover: recentCovers[0] ?? null,
  });
  state.cover.attempts = [...(state.cover.attempts ?? []), { tier: "soul_higgsfield", verdict: qa.verdict }];
  saveState(state);
  console.log(
    `[cover-record] soul tier QA: identity=${qa.identity.score} scene=${qa.scene_continuity.pass ? "ok" : "MISMATCH"} → ${qa.verdict}`,
  );
  if (qa.verdict === "FAIL") {
    console.error("[cover-record] Soul fallback FAILED QA — end of fallback chain. Surfacing to human.");
    process.exit(3); // signal: surface-to-human
  }
  await finalizeCoverAndPersist(state, fs.readFileSync(rawPath), state.cover.directive, "soul_higgsfield", qa, costUsd + qa.cost_usd);
}

// ─── Phase: manifest ────────────────────────────────────────────────────

async function phaseManifest(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  if (!state.face_metrics) throw new Error("face_metrics not populated. Run --phase=face-metrics first.");

  const clipMetrics = state.clips
    .filter((c) => c.verify_status === "PASS")
    .map((c) => {
      const m = state.face_metrics![c.id];
      if (!m?.start || !m?.end) throw new Error(`face_metrics missing for clip ${c.id}`);
      return {
        clip_id: c.id,
        start: { eye_y: m.start.eye_y, face_x: m.start.face_x },
        end: { eye_y: m.end.eye_y, face_x: m.end.face_x },
      };
    });

  const built = buildTransitionsManifest({ clips: clipMetrics, frame_width: 1080 });
  state.transitions_manifest = {
    transitions: built.transitions.map((t) => ({ ...t, bridge_enabled: true })),
    crops: built.crops,
    median_start_eye_y: built.median_start_eye_y,
  };
  saveState(state);
  console.log(`[manifest] ${built.transitions.length} transition(s) — motion-blur on cuts: ${built.transitions.filter(t => t.needs_motion_blur).map(t => t.cut_index).join(", ") || "none"}`);
  console.log(`[manifest] median_start_eye_y=${built.median_start_eye_y}px crop_offsets=${built.crops.map(c => `${c.clip_id}:${c.crop_offset_y > 0 ? "+" : ""}${c.crop_offset_y}`).join(" ")}`);
}

// ─── Phase: summary ─────────────────────────────────────────────────────

async function phaseSummary(args: Args): Promise<void> {
  const workdir = requireArg(args, "workdir");
  const state = loadState(workdir);
  const passClips = state.clips.filter((c) => c.verify_status === "PASS");

  // Compute bridge timestamps deterministically from the same layout math
  // AvatarV5Composition uses. clip[i].from_frame is the moment clip i
  // becomes visible; for i >= 1 with bridge_enabled, clip[i].from_frame is
  // AUDIO_BRIDGE_FRAMES before clip[i-1].end. That's the "bridge moment".
  const fps = AVATAR_V5_FPS;
  const transitions = state.transitions_manifest?.transitions ?? [];
  type BridgeInfo = { cut_index: number; from_clip_id: string; to_clip_id: string; bridge_t_s: number; bridge_enabled: boolean; needs_motion_blur: boolean };
  const bridges: BridgeInfo[] = [];
  let cursor = 0;
  for (let i = 0; i < passClips.length; i++) {
    const c = passClips[i];
    const dur = Math.max(1, Math.round((c.whisper_duration_s ?? c.duration_target_s) * fps));
    const incoming = i > 0 ? transitions[i - 1] : undefined;
    if (incoming) {
      const bridgeEnabled = incoming.bridge_enabled ?? true;
      const bridgeOffset = bridgeEnabled ? AUDIO_BRIDGE_FRAMES : 0;
      const fromFrame = Math.max(0, cursor - bridgeOffset);
      bridges.push({
        cut_index: incoming.cut_index,
        from_clip_id: incoming.from_clip_id,
        to_clip_id: incoming.to_clip_id,
        bridge_t_s: fromFrame / fps,
        bridge_enabled: bridgeEnabled,
        needs_motion_blur: incoming.needs_motion_blur,
      });
      cursor = fromFrame + dur;
    } else {
      cursor = dur;
    }
  }

  // ── Output the human-review summary ──
  const totalCr = state.total_higgsfield_credits ?? 0;
  const totalUsd = state.total_usd ?? 0;
  const motionBlurCuts = bridges.filter((b) => b.needs_motion_blur).map((b) => `cut-${b.cut_index}`);
  const hardCuts = bridges.filter((b) => !b.needs_motion_blur).map((b) => `cut-${b.cut_index}`);

  console.log("\n=== AVATAR FULL V5 — READY FOR HUMAN REVIEW ===");
  console.log(`content_id        : ${state.content_id}`);
  console.log(`final video       : ${state.final_public_url ?? "(not uploaded)"}`);
  console.log(`hook              : "${state.hook_text}"`);
  console.log(`register          : ${state.register}`);
  console.log(`clips             : ${passClips.length} (std=${state.clips.filter(c => c.verify_mode_used === "std").length}, fast=${state.clips.filter(c => c.verify_mode_used === "fast").length}, surfaced=${state.clips.filter(c => c.surfaced_for_human).length})`);
  console.log(`per-clip WER      : ${passClips.map(c => `${c.id}=${((c.whisper_wer ?? 0) * 100).toFixed(1)}%`).join(", ")}`);
  console.log("");
  console.log("audio-bridge ear-check (Phase 9 ask: ear-check each cut individually):");
  for (const b of bridges) {
    const label = b.bridge_enabled ? "BRIDGE" : "HARD CUT";
    console.log(`  ${b.from_clip_id} → ${b.to_clip_id}  at t=${b.bridge_t_s.toFixed(3)}s  [${label}]${b.needs_motion_blur ? "  + motion blur" : ""}`);
  }
  console.log("");
  console.log(`motion-blur cuts  : ${motionBlurCuts.length > 0 ? motionBlurCuts.join(", ") : "none"}`);
  console.log(`hard cuts         : ${hardCuts.length > 0 ? hardCuts.join(", ") : "none"}`);
  console.log(`total cost        : $${totalUsd.toFixed(2)} (${totalCr} Higgsfield credits)`);
  if (state.qa_verdict) console.log(`avatar-v1 QA      : ${state.qa_verdict} (report ${state.qa_report_id ?? "n/a"}, informational only)`);
  console.log(`thumbnail         : ${state.thumbnail_public_url ?? "(not generated — run --phase=cover)"}`);
  console.log(
    `cover             : ${state.cover?.public_url ?? (state.cover?.needs_soul_fallback ? "(NEEDS Soul fallback — see --phase=cover output)" : "(not generated — run --phase=cover)")}` +
      (state.cover?.source ? `  [source=${state.cover.source}, $${(state.cover.cost_usd ?? 0).toFixed(2)}]` : ""),
  );
  console.log("");
  console.log("To disable a specific bridge that sounds rough:");
  console.log("  edit workdir/v5-state.json, set transitions_manifest.transitions[i].bridge_enabled=false");
  console.log("  rerun --phase=compose --phase=upload --phase=summary");
  console.log("================================================\n");
}

// ─── Dispatch ────────────────────────────────────────────────────────────

const PHASES: Record<string, (args: Args) => Promise<void>> = {
  init: phaseInit,
  tts: phaseTts,
  record: phaseRecord,
  verify: phaseVerify,
  "face-metrics": phaseFaceMetrics,
  manifest: phaseManifest,
  compose: phaseCompose,
  upload: phaseUpload,
  qa: phaseQa,
  cover: phaseCover,
  "cover-record": phaseCoverRecord,
  summary: phaseSummary,
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const phase = args["phase"];
  if (!phase) {
    console.error("Usage: render-avatar-full-v5.ts --phase=<name> --workdir=<path> [args]");
    console.error(`Phases: ${Object.keys(PHASES).join(", ")}`);
    process.exit(2);
  }
  const fn = PHASES[phase];
  if (!fn) {
    console.error(`Unknown --phase=${phase}. Available: ${Object.keys(PHASES).join(", ")}`);
    process.exit(2);
  }
  await fn(args);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
