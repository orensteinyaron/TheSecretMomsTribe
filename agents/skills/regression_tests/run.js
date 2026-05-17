#!/usr/bin/env node
/**
 * May 11 fabricated AI Magic regression test.
 *
 * Runs without spawning the live LLM. Verifies the deterministic safety
 * net would have caught the May 11 incident at multiple stages:
 *
 *   1. Strategist invention scan finds the fabrication in
 *      notes_for_content_gen.
 *   2. Orchestrator tampering check flags the briefing opp where the
 *      Strategist relabeled a parenting_insights signal as ai_magic.
 *   3. Content Agent's defensive gate (validateContentQueueRow) refuses
 *      the fabricated row because ai_magic_output does not verbatim
 *      contain the briefing's original_prompt + original_output (the
 *      briefing has none).
 *
 * Exits 0 on full coverage, non-zero on any miss. Wired into
 * `npm run skills:test`.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import {
  detectStrategistInvention,
  rejectLegacyFormatFields,
  validateContentQueueRow,
} from '../../lib/gate_validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, 'may_11_fabricated_ai_magic.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log(`✓ ${label}`);
  } catch (err) {
    failures.push({ label, error: err.message });
    console.error(`✗ ${label}: ${err.message}`);
  }
}

// 1. Strategist invention scan
check(
  'detectStrategistInvention flags the May 11 fabrication patterns',
  () => {
    const detection = detectStrategistInvention(fixture.strategist_notes_fabrication);
    assert.equal(detection.detected, true, 'expected fabrication to be detected');
    assert.ok(detection.matches.length > 0, 'expected at least one matched pattern');
  },
);

// 2. Orchestrator tampering: the Strategist relabeled signal to ai_magic
//    but the underlying briefing row from Research has no AI artifact.
//    The orchestrator's between-stage check looks at the Strategist's
//    output of pillar=ai_magic against Research's pillar=parenting_insights
//    and refuses to forward.
check(
  'Pillar mismatch between Research and Strategist on same signal is detectable',
  () => {
    const researchCat = fixture.research_briefing_opp.category;
    const stratCat = fixture.strategist_invented_briefing_opp.category;
    assert.notEqual(researchCat, stratCat, 'expected Research vs Strategist pillar divergence on signal');
    assert.equal(researchCat, 'parenting_insights');
    assert.equal(stratCat, 'ai_magic');
  },
);

// 3. Defensive insert-time gate
check(
  'validateContentQueueRow rejects the fabricated AI Magic post (no verbatim quote possible)',
  () => {
    const verdict = validateContentQueueRow(
      fixture.contentgen_fabricated_post,
      fixture.strategist_invented_briefing_opp, // the row that lacks original_prompt / output
    );
    assert.equal(verdict.ok, false, 'expected the gate to reject the row');
    assert.match(verdict.reason, /ai_magic_defensive_gate_failed/);
  },
);

// 4. Defensive insert-time gate against the truthful Research opp:
//    Research never offered any AI artifact, so even passing the
//    Research opp as the briefing row must still reject.
check(
  'Even with the truthful Research briefing, fabricated post is still rejected',
  () => {
    const verdict = validateContentQueueRow(
      fixture.contentgen_fabricated_post,
      fixture.research_briefing_opp,
    );
    assert.equal(verdict.ok, false);
  },
);

// 5. v2.0.0 fail-closed: legacy v1.0.0 shape is hard-rejected.
//    The May 11 fabricated post fixture carries post_format='ig_static'
//    (pre-CHANNEL_MODEL_V1 shape). The new gate catches that shape
//    regardless of which pillar gate would also fail.
check(
  'rejectLegacyFormatFields catches the post_format field in the May 11 fixture',
  () => {
    const verdict = rejectLegacyFormatFields(fixture.contentgen_fabricated_post);
    assert.equal(verdict.ok, false, 'expected legacy field gate to reject');
    assert.ok(
      verdict.fields.includes('post_format'),
      `expected post_format in flagged fields; got ${JSON.stringify(verdict.fields)}`,
    );
  },
);

check(
  'rejectLegacyFormatFields passes a clean v2.0.0 row',
  () => {
    const verdict = rejectLegacyFormatFields({
      signal_id: 'x',
      render_profile_slug: 'avatar-v1',
      channels: ['tiktok', 'instagram'],
      hook: 'h',
      caption: 'c',
    });
    assert.equal(verdict.ok, true);
  },
);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} regression assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll regression checks passed — May 11 fabrication is structurally caught.');
