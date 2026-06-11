// Cover fallback-chain runner (services convention:
// gemini_nano_banana → retry-with-adjusted-prompt → higgsfield_soul).
//
// Tiers 1+2 (Gemini, direct API) run here. Tier 3 (Soul 2.0 via Higgsfield)
// is SESSION-scoped — the Node renderer cannot call Higgsfield MCP (same
// constraint as generateAnchoredStill in phaseInit) — so this returns
// NEEDS_SOUL_FALLBACK and --phase=cover surfaces it to the Claude session,
// which generates via MCP and records the result with --phase=cover-record.
//
// All transports are injected so the chain is unit-testable without network.

import type { ImagePart } from "../qa-helpers.js";
import { buildCoverDirective, type BuildDirectiveInput, type BuildDirectiveResult } from "./directive.js";
import { buildCoverPrompt, GEMINI_COST_PER_IMAGE_USD } from "./gemini.js";
import { qaCover } from "./qa.js";
import type {
  CoverAttempt,
  CoverDirective,
  CoverGenerationResult,
  CoverQaReport,
  CoverSource,
  RecentCover,
} from "./types.js";

export interface CoverChainDeps {
  /** Tier 1+2 transport: prompt + reference → raw cover bytes. */
  generateImage(prompt: string, referenceImage: Buffer): Promise<Buffer>;
  /** QA gate (vision). Runs on the RAW cover so the banner never occludes it. */
  qa(coverImage: ImagePart, directive: CoverDirective, previousCover: RecentCover | null): Promise<CoverQaReport>;
  buildDirective(input: BuildDirectiveInput): Promise<BuildDirectiveResult>;
}

export interface CoverChainInput {
  hook: string;
  scriptSummary: string;
  tone?: string | null;
  recentCovers: RecentCover[];
  referenceImage: Buffer;
}

export function productionCoverChainDeps(referenceImage: ImagePart): CoverChainDeps {
  return {
    generateImage: async (prompt, reference) => {
      const { generateGeminiCover } = await import("./gemini.js");
      return generateGeminiCover({ referenceImage: reference, prompt });
    },
    qa: (coverImage, directive, previousCover) =>
      qaCover({ coverImage, referenceImage, directive, previousCover }),
    buildDirective: (input) => buildCoverDirective(input),
  };
}

const TIER_SOURCES: CoverSource[] = ["gemini", "gemini_retry"];

export async function runCoverChain(
  input: CoverChainInput,
  deps: CoverChainDeps,
): Promise<CoverGenerationResult> {
  const { directive, derivedVia, cost_usd: directiveCost } = await deps.buildDirective({
    hook: input.hook,
    scriptSummary: input.scriptSummary,
    tone: input.tone,
    recentCovers: input.recentCovers,
  });
  console.log(
    `[cover] directive via ${derivedVia}: expression="${directive.expression}" framing=${directive.framing} side=${directive.composition_side}`,
  );

  const previousCover = input.recentCovers[0] ?? null;
  const attempts: CoverAttempt[] = [];
  let cost = directiveCost;

  for (let attempt = 1 as 1 | 2; attempt <= 2; attempt = (attempt + 1) as 1 | 2) {
    const tier = TIER_SOURCES[attempt - 1];
    const prompt = buildCoverPrompt(directive, attempt);
    let rawCover: Buffer;
    try {
      rawCover = await deps.generateImage(prompt, input.referenceImage);
    } catch (e) {
      console.error(`[cover] tier ${tier} generation failed: ${(e as Error).message}`);
      continue;
    }
    cost += GEMINI_COST_PER_IMAGE_USD;
    const qa = await deps.qa(
      { mediaType: "image/png", data: rawCover.toString("base64") },
      directive,
      previousCover,
    );
    cost += qa.cost_usd;
    attempts.push({ tier, qa });
    console.log(
      `[cover] tier ${tier}: identity=${qa.identity.score}/${qa.identity.threshold} scene=${qa.scene_continuity.pass ? "ok" : "MISMATCH"} sameness=${qa.sameness.flagged ? "FLAGGED" : "ok"} → ${qa.verdict}`,
    );
    if (qa.verdict === "PASS") {
      return { status: "PASS", source: tier, directive, rawCover, qa, attempts, cost_usd: cost };
    }
  }

  return { status: "NEEDS_SOUL_FALLBACK", directive, attempts, cost_usd: cost };
}
