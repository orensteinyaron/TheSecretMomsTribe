// Motion-prompt builder for Avatar Full v5 Seedance clips.
//
// Bakes the YAR-129 session-learnings into every clip prompt:
//   - Finding 2: framing-lock language (camera position locked, no zoom,
//                no pan, medium close-up holds throughout)
//   - Finding 3: bounded-motion language (subtle natural motion within a
//                small envelope) — NOT pose-lock / torso-lock, which
//                over-corrected in v4 and made Rachel read as frozen/AI
//
// Per-register visual markers come from YAR-129 Gap 1 (Face of SMT V1.2
// register table). The deepfakes piece uses `concerned_insider`.

export type Register =
  | "neutral_warm"
  | "concerned_insider"
  | "excited_discovery"
  | "dry_reflective";

const FRAMING_LOCK = [
  "Medium close-up framing held throughout — the woman's head and shoulders fill the upper two-thirds of the frame, her upper body visible in the lower third.",
  "Camera position is locked, no zoom in or out, no pan.",
].join(" ");

const BOUNDED_MOTION =
  "Subtle natural motion within a small envelope, not large posture shifts. She breathes, leans slightly, gestures with her hands — but stays within a defined range so position drift between clip start and clip end is minimal.";

const REGISTER_MARKERS: Record<Register, string> = {
  neutral_warm:
    "Open posture, hands relaxed, soft eye contact. Half-smile at rest. Speaks at natural pace with occasional contractions.",
  concerned_insider:
    "Lean-in framing with slight forward upper-body tilt, eyes locked into camera. Hands visible and moving naturally but controlled and close to body — NOT declarative, NOT pointing. Brow slightly furrowed at the hook, softening by the CTA. Lowered voice register, slower pace. The friend in the group chat telling you something important specifically because she trusts you to act on it.",
  excited_discovery:
    "Animated hands, broader gestures, eyebrows up. Half-smile breaking into full at payoff. Faster pace.",
  dry_reflective:
    "Stiller body, hand near face or temple is fine, softer eye contact with occasional look-off, no smile. Slower, sparser, longer pauses.",
};

export type BuildMotionPromptOpts = {
  register: Register;
  /** Verbatim line being spoken in this clip. Wrapped in double-quotes inside the prompt. */
  script_excerpt: string;
};

function escapeForPromptQuote(text: string): string {
  // Replace inner double-quotes with single quotes so the wrapping quotes
  // remain grammatically clean. Trim trailing whitespace.
  return text.replace(/"/g, "'").trim();
}

export function buildMotionPrompt(opts: BuildMotionPromptOpts): string {
  const excerpt = escapeForPromptQuote(opts.script_excerpt);
  return [
    FRAMING_LOCK,
    REGISTER_MARKERS[opts.register],
    BOUNDED_MOTION,
    `She is speaking the line: "${excerpt}".`,
  ].join(" ");
}
