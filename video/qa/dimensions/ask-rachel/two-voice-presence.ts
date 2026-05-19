// two_voice_presence — Ask Rachel format uses two voices: an unseen
// interviewer (from a 2–3-voice ElevenLabs pool per FACE_OF_SMT V1 §6) and
// Rachel (voice_id 9JqF6OmJtGjHTDODKG2c).
//
// The dim verifies that the final audio contains both voices. Two
// implementation paths:
//   - Cheap: cross-check ElevenLabs metadata — at render time, the
//     pipeline tags each audio segment with its voice_id. Dim reads
//     content_queue.metadata.qa_inputs.audio_segments[].voice_id and
//     asserts ≥2 distinct IDs are referenced.
//   - Expensive: speaker diarization via pyannote/AssemblyAI. New
//     dependency. Avoid unless the cheap path is unavailable.
//
// Currently UNMEASURED — the Ask Rachel pipeline hasn't shipped a
// production asset, and the audio_segments metadata isn't persisted.
// Graduates via single SQL UPDATE when both ship.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runTwoVoicePresence(): Promise<DimensionResult> {
  return {
    name: "two_voice_presence",
    status: "UNMEASURED",
    details: "Ask Rachel two-voice presence requires content_queue.metadata.qa_inputs.audio_segments[].voice_id from the render pipeline. The Ask Rachel pipeline has not shipped a production asset yet and the per-segment voice_id metadata is not persisted. Graduates to in_scope via a single SQL UPDATE on render_profiles.qa_rules once both ship. Implementation: assert ≥2 distinct voice_ids in the segment list.",
  };
}
