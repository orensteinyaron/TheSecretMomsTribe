// Motion-prompt builder for Avatar Full v5 Seedance clips.
//
// Bakes the session-learnings into every clip prompt:
//   - YAR-129 Finding 2: framing-lock language (camera position locked, no
//                zoom, no pan, medium close-up holds throughout)
//   - 2026-06-23 (Yaron): an explicit ALIVENESS layer so Rachel reads as a
//                real woman talking heart-to-heart — natural blinking,
//                expressive eyebrows, a warm smile that comes and goes, and
//                natural hand gestures. The default `neutral_warm` register +
//                a "subtle motion within a small envelope" instruction made
//                her read as a frozen/AI talking photo; this fixes that.
//   - 2026-06-23 (Yaron): subject-DISTANCE lock — she stays the same size in
//                frame across the clip. Seedance drifts subject distance per
//                clip from the same start image (one clip came out noticeably
//                more zoomed-in); locking distance in-prompt counters it.
//   - Position-stability language (replaces the old over-cautious
//                "bounded motion") keeps her overall body position from
//                drifting clip-start→clip-end so clip normalization stays
//                cheap — WITHOUT suppressing the expressive motion above.
//
// Per-register visual markers come from YAR-129 Gap 1 (Face of SMT V1.2
// register table) and layer tonal nuance on top of the aliveness floor.

export type Register =
  | "neutral_warm"
  | "concerned_insider"
  | "excited_discovery"
  | "dry_reflective";

const FRAMING_LOCK = [
  "Medium close-up framing held throughout — the woman's head and shoulders fill the upper two-thirds of the frame, her upper body visible in the lower third.",
  "Camera position is locked, no zoom in or out, no pan, no push-in.",
  "She stays the same distance from the camera and the same size in frame from the first frame to the last.",
].join(" ");

// ALIVENESS floor — applies to EVERY register, so it must be TONE-SAFE: no
// mandated smile or hand choreography (those would contradict dry_reflective /
// urgent). It locks the universal signs of life that v1 lacked — blinking,
// engaged eyes, an expressive (not slack) face, small natural head movement.
// Register markers layer smile/hands/energy on top. Avoids the word "frozen"
// by design (don't negate-prime it); uses "stiff or wooden" instead.
const ALIVENESS =
  "She is genuinely alive and present, like a real woman mid-conversation, not a still photo. She blinks naturally at a normal human rhythm, her eyes stay engaged, and her face moves expressively with her words through natural micro-expressions and small head movements. Her motion is fluid and human throughout, never stiff or wooden.";

// Position-stability for cheap normalization: bound POSITION DRIFT, not
// expressiveness. Her gestures and head movement are free; her overall
// placement in frame just shouldn't wander between the first and last frame.
const POSITION_STABILITY =
  "Her gestures and head movement stay within a small range so her overall body position barely drifts between the first and last frame of the clip.";

const REGISTER_MARKERS: Record<Register, string> = {
  neutral_warm:
    "Open posture, warm and engaged. She gestures naturally and gently with her hands near her chest as she speaks, eyebrows moving with her words, a genuine smile coming and going. Soft eye contact, natural pace with occasional contractions.",
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
    ALIVENESS,
    POSITION_STABILITY,
    `She is speaking, with genuine feeling, the line: "${excerpt}".`,
  ].join(" ");
}
