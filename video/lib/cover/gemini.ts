// Gemini Nano Banana cover generation — DIRECT API call (no Higgsfield).
//
// Strategic constraint: cover generation must not use Higgsfield (cost
// reduction / future migration off Higgsfield). Identity comes from the
// reference image (the render's Soul-locked start_image), passed as
// inline image data — NEVER described in text. The prompt holds the woman,
// room, lighting, and wardrobe to the reference and changes only
// expression / gaze / pose / framing / composition.
//
// Requires GEMINI_API_KEY in .env (flagged to Yaron; services row
// gemini_nano_banana sits at status='no_key' until it lands).

import type { CoverDirective } from "./types.js";

/** Nano Banana — Gemini's image generation/editing model. */
export const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
/** Published per-image price (1290 image-output tokens @ $30/MTok). */
export const GEMINI_COST_PER_IMAGE_USD = 0.039;

const FRAMING_TEXT: Record<CoverDirective["framing"], string> = {
  close_up: "a tight close-up portrait framing (head and shoulders filling the frame)",
  medium: "a medium shot (framed from the waist up)",
  three_quarter: "a three-quarter shot (framed from mid-thigh up, more of the room visible)",
};

function compositionText(side: CoverDirective["composition_side"]): string {
  if (side === "center") return "Compose her centered in the frame.";
  return `Compose her slightly off-center toward the ${side} of the frame, keeping the composition balanced.`;
}

/**
 * Build the generation prompt for a directive. `attempt` 2 = the adjusted
 * retry prompt (stronger identity + scene anchoring) used by fallback tier 2.
 *
 * Identity rule: the prompt must never describe the woman's facial features —
 * "same woman as the reference" is the only identity language allowed.
 */
export function buildCoverPrompt(directive: CoverDirective, attempt: 1 | 2 = 1): string {
  const lines = [
    attempt === 2
      ? "Edit the provided reference photo. It is CRITICAL that the woman's face is IDENTICAL to the reference image — same person, unchanged facial identity. Keep the exact same room, the exact same lighting, and the exact same outfit and hair as the reference."
      : "Edit the provided reference photo: the same woman, in the same room, with the same lighting and the same wardrobe.",
    `Change only her expression, pose, and the camera framing: ${directive.expression}; gaze ${directive.gaze}; ${directive.pose}.`,
    `Use ${FRAMING_TEXT[directive.framing]}.`,
    compositionText(directive.composition_side),
    "Vertical 9:16 portrait photo, photorealistic, natural skin texture, no text or graphics.",
    "Keep her entire face inside the vertical center 3:4 region of the 9:16 frame, and keep the lower quarter of the frame visually simple (a text banner will be placed there).",
  ];
  return lines.join(" ");
}

export interface GeminiCoverInput {
  /** PNG/JPEG bytes of the reference image (the render's Soul still). */
  referenceImage: Buffer;
  referenceMimeType?: "image/png" | "image/jpeg";
  prompt: string;
  apiKey?: string;
}

/**
 * One generateContent call returning the generated image bytes.
 * Throws on HTTP errors or an imageless response — callers own retries.
 */
export async function generateGeminiCover(input: GeminiCoverInput): Promise<Buffer> {
  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY missing — the cover stage's primary tier needs it in .env " +
        "(services.gemini_nano_banana is registered at status='no_key' until it lands).",
    );
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: input.referenceMimeType ?? "image/png",
              data: input.referenceImage.toString("base64"),
            },
          },
          { text: input.prompt },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gemini ${GEMINI_IMAGE_MODEL} ${res.status}: ${text.slice(0, 500)}`);
  }
  const j: any = await res.json();
  const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const b64 = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  if (!b64) {
    const finish = j?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`gemini returned no image (finishReason=${finish})`);
  }
  return Buffer.from(b64, "base64");
}
