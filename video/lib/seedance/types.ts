// Transport-agnostic Seedance generation types.
//
// The SeedanceClient interface is the localized seam for swapping the
// generation backend (Higgsfield MCP today → BytePlus-direct or
// Higgsfield-HTTP in a future spike). Implementations live under
// video/lib/seedance/*; the rest of the v5 pipeline imports only this
// module + ./SeedanceClient.

export type ClipParams = {
  /** Soul-canonical Rachel reference (or other CDN/job URL the model accepts). */
  start_image_url: string;
  /** Per-clip ElevenLabs MP3, publicly fetchable by the generation backend. */
  audio_url: string;
  /** Motion prompt — framing-lock + bounded-motion + register markers, built by motion-prompt-builder. */
  motion_prompt: string;
  /** Always 9:16 for Avatar Full. */
  aspect_ratio: "9:16";
  /** 1080p target for v5. */
  resolution: "1080p";
  /** Per-clip duration. Seedance accepts 4-15 s. */
  duration_s: number;
  /** Seedance generation mode. Retry escalates std → fast → surface-to-human. */
  mode: "std" | "fast";
};

export type ClipResult = {
  /** Backend job identifier (Higgsfield job_id today). */
  job_id: string;
  /** CDN URL of the generated MP4 with embedded audio. */
  video_url: string;
  /** Confirmed clip duration in seconds (may be clamped by the backend). */
  duration_s: number;
  /** Billed credit cost (Higgsfield credits). */
  cost_credits: number;
  /** Approximate USD cost. */
  cost_usd: number;
  /** The mode the backend actually used (= request mode unless server downgraded). */
  mode_used: "std" | "fast";
};

export type SeedanceErrorKind =
  | "hallucinated_audio"
  | "transport"
  | "timeout"
  | "other";

export class SeedanceError extends Error {
  constructor(public readonly kind: SeedanceErrorKind, message: string) {
    super(message);
    this.name = "SeedanceError";
  }
}
