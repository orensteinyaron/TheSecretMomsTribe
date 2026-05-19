// phrase_caption_timing — UNMEASURED for PR 2.
//
// The dimension requires OCR on the caption region at sampled timestamps,
// then verifying OCR-extracted text appears in the Whisper word timeline
// within a 100ms tolerance window. OCR helper (tesseract subprocess or
// equivalent) is deferred to PR 2.1 or PR 3 to keep PR 2's scope at the
// "3-day" estimate.
//
// Graduates from UNMEASURED to in_scope via a single SQL UPDATE on
// render_profiles.qa_rules once the OCR helper lands.

import type { DimensionResult } from "../../schemas/qa-dimension.js";

export async function runPhraseCaptionTiming(): Promise<DimensionResult> {
  return {
    name: "phrase_caption_timing",
    status: "UNMEASURED",
    details: "OCR helper for caption region extraction is not yet implemented. The dimension's check (Whisper word timestamps vs caption render timestamps within 100ms tolerance) requires reading the on-screen caption text at sampled timestamps. Tracked for a follow-up PR; graduates from UNMEASURED via a single SQL UPDATE on render_profiles.qa_rules once OCR helper ships.",
  };
}
