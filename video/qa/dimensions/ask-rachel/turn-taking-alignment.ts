// turn_taking_alignment — Ask Rachel pieces alternate interviewer (Q) and
// Rachel (A) segments. The dim verifies that question segments use the
// interviewer voice ID and answer segments use Rachel's
// (9JqF6OmJtGjHTDODKG2c) — i.e. the segment role (Q vs A) matches the
// voice_id used.
//
// Implementation path (when metadata ships): read
// content_queue.metadata.qa_inputs.audio_segments[] = [{ role, voice_id }],
// assert role='question' maps only to interviewer pool IDs and
// role='answer' maps to Rachel's ID exclusively. Deterministic, no API.
//
// Currently UNMEASURED for the same reason as two_voice_presence.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runTurnTakingAlignment(): Promise<DimensionResult> {
  return {
    name: "turn_taking_alignment",
    status: "UNMEASURED",
    details: "Ask Rachel turn-taking requires content_queue.metadata.qa_inputs.audio_segments[].role + .voice_id from the render pipeline. Not yet persisted. Graduates with two_voice_presence. Implementation: assert role='question' segments map to interviewer pool voice IDs, role='answer' segments map to Rachel's voice ID (9JqF6OmJtGjHTDODKG2c) exclusively. Deterministic — no API cost.",
  };
}
