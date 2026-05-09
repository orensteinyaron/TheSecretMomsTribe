/**
 * Script validator for Full Avatar pipeline.
 *
 * Hard rule (set 2026-05-09 after the SCENE_3 trailing-silence incident on
 * piece 5ffc20c1): every scene must render to at least MIN_SCENE_DURATION_S
 * of speech. Sub-4s scenes either get padded with dead air by Seedance
 * (which the QA agent then flags as a silence gap) or land as a 1.5s
 * micro-clip that breaks the rhythm of the final mp4.
 *
 * The fix is upstream: reject the script before TTS spend, force the writer
 * (human or LLM) to either merge the short scene with a neighbour or extend
 * the line.
 *
 * This module is the single source of truth for that rule. Imported by the
 * full-avatar skill executor (TS or human-with-Read) at pipeline step 1.
 *
 * Usage as CLI:
 *   npx tsx scripts/validate-script.ts <script.json>
 *   exit 0 = pass, exit 1 = fail (prints actionable violations)
 *
 * Usage as library:
 *   import { validateAvatarScript } from "./validate-script";
 *   const result = validateAvatarScript(script);
 *   if (!result.ok) throw new Error(result.violations.map(...).join("\n"));
 */

import fs from "fs";

/** Words per second for the Rachel voice in eleven_v3 Natural mode. */
const RACHEL_WPS = 2.6;

/** Hard floor — scenes that estimate below this get rejected. */
export const MIN_SCENE_DURATION_S = 4.0;

/** Seedance hard ceiling. Already enforced upstream but checked here too. */
export const MAX_SCENE_DURATION_S = 15.0;

export interface AvatarScene {
  scene_id: string;
  order?: number;
  script: string;
  emotion_tags?: string;
  target_duration_s?: number;
}

export interface AvatarScript {
  title?: string;
  hook_overlay?: string;
  scenes: AvatarScene[];
}

export interface SceneViolation {
  scene_id: string;
  order: number;
  word_count: number;
  estimated_duration_s: number;
  reason: "too_short" | "too_long";
  suggestion: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: SceneViolation[];
  per_scene: Array<{
    scene_id: string;
    order: number;
    word_count: number;
    estimated_duration_s: number;
  }>;
  total_estimated_s: number;
}

/**
 * Strip emotion/expression tags ([thoughtful], [sighs]) before counting words.
 * Tags are not spoken.
 */
function stripTags(text: string): string {
  return text.replace(/\[[\w\s]+\]\s*/g, " ").trim();
}

function wordCount(text: string): number {
  return stripTags(text).split(/\s+/).filter((w) => w.length > 0).length;
}

function estimateDurationSec(text: string): number {
  const w = wordCount(text);
  if (w === 0) return 0;
  return w / RACHEL_WPS;
}

export function validateAvatarScript(script: AvatarScript): ValidationResult {
  const per_scene: ValidationResult["per_scene"] = [];
  const violations: SceneViolation[] = [];

  if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error("script.scenes must be a non-empty array");
  }

  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i];
    const order = s.order ?? i + 1;
    const wc = wordCount(s.script);
    const est = estimateDurationSec(s.script);

    per_scene.push({
      scene_id: s.scene_id,
      order,
      word_count: wc,
      estimated_duration_s: Number(est.toFixed(2)),
    });

    if (est < MIN_SCENE_DURATION_S) {
      const neighbours: string[] = [];
      if (i > 0) neighbours.push(script.scenes[i - 1].scene_id);
      if (i < script.scenes.length - 1) neighbours.push(script.scenes[i + 1].scene_id);
      violations.push({
        scene_id: s.scene_id,
        order,
        word_count: wc,
        estimated_duration_s: Number(est.toFixed(2)),
        reason: "too_short",
        suggestion: neighbours.length > 0
          ? `Merge with ${neighbours.join(" or ")}, or extend to >=${Math.ceil(MIN_SCENE_DURATION_S * RACHEL_WPS)} words.`
          : `Extend to >=${Math.ceil(MIN_SCENE_DURATION_S * RACHEL_WPS)} words.`,
      });
    } else if (est > MAX_SCENE_DURATION_S) {
      violations.push({
        scene_id: s.scene_id,
        order,
        word_count: wc,
        estimated_duration_s: Number(est.toFixed(2)),
        reason: "too_long",
        suggestion: `Split into two scenes; cap is ${MAX_SCENE_DURATION_S}s (~${Math.floor(MAX_SCENE_DURATION_S * RACHEL_WPS)} words).`,
      });
    }
  }

  const total = per_scene.reduce((acc, s) => acc + s.estimated_duration_s, 0);

  return {
    ok: violations.length === 0,
    violations,
    per_scene,
    total_estimated_s: Number(total.toFixed(2)),
  };
}

function formatReport(r: ValidationResult): string {
  const lines: string[] = [];
  lines.push(`scenes: ${r.per_scene.length}`);
  lines.push(`total estimated speech: ${r.total_estimated_s}s`);
  lines.push("");
  lines.push("per-scene estimates:");
  for (const s of r.per_scene) {
    const flag = r.violations.find((v) => v.scene_id === s.scene_id);
    const tag = flag ? ` ❌ ${flag.reason.toUpperCase()}` : "";
    lines.push(`  ${s.scene_id} (order ${s.order}): ${s.word_count} words → ~${s.estimated_duration_s}s${tag}`);
  }
  if (r.violations.length > 0) {
    lines.push("");
    lines.push(`violations (${r.violations.length}):`);
    for (const v of r.violations) {
      lines.push(`  ${v.scene_id}: ${v.reason} (~${v.estimated_duration_s}s) — ${v.suggestion}`);
    }
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scriptPath = process.argv[2];
  if (!scriptPath) {
    console.error("Usage: npx tsx scripts/validate-script.ts <script.json>");
    process.exit(2);
  }
  const raw = fs.readFileSync(scriptPath, "utf-8");
  const script: AvatarScript = JSON.parse(raw);
  const result = validateAvatarScript(script);
  console.log(formatReport(result));
  process.exit(result.ok ? 0 : 1);
}
