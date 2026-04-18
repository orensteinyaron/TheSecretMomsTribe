/**
 * Tests for image-diversity axes + batch audit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  AXES,
  pickRachelMode,
  normalizeAxisValue,
  readAxes,
  auditBatchDiversity,
  suggestUntakenAxes,
  buildImagePromptGuidelines,
} = await import('../image-diversity.js');

test('AXES: every axis has at least 2 options', () => {
  for (const axis of Object.keys(AXES)) {
    assert.ok(Array.isArray(AXES[axis]) && AXES[axis].length >= 2, `${axis} has options`);
  }
});

test('pickRachelMode: avatar formats → rachel_in_frame', () => {
  assert.equal(pickRachelMode('tiktok_avatar'), 'rachel_in_frame');
  assert.equal(pickRachelMode('tiktok_avatar_visual'), 'rachel_in_frame');
});

test('pickRachelMode: non-avatar formats → broll', () => {
  assert.equal(pickRachelMode('ig_static'), 'broll');
  assert.equal(pickRachelMode('tiktok_slideshow'), 'broll');
  assert.equal(pickRachelMode('ig_carousel'), 'broll');
});

test('normalizeAxisValue: slugifies free-form', () => {
  assert.equal(normalizeAxisValue('Warm Golden Hour'), 'warm_golden_hour');
  assert.equal(normalizeAxisValue('  POV First-Person  '), 'pov_first_person');
  assert.equal(normalizeAxisValue('amber/cream'), 'amber_cream');
  assert.equal(normalizeAxisValue(null), null);
  assert.equal(normalizeAxisValue(''), null);
});

test('readAxes: returns all six axes, missing ones nulled', () => {
  const post = { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } };
  const axes = readAxes(post);
  assert.equal(axes.shot_type, 'close_up');
  assert.equal(axes.lighting, 'warm_golden_hour');
  assert.equal(axes.palette, null);
  assert.equal(axes.rachel_mode, null);
  assert.equal(Object.keys(axes).length, 6);
});

test('readAxes: falls back to metadata.image_axes', () => {
  const post = { metadata: { image_axes: { shot_type: 'macro' } } };
  assert.equal(readAxes(post).shot_type, 'macro');
});

test('auditBatchDiversity: three identical combos → two violations, not diverse', () => {
  const batch = [
    { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } },
    { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } },
    { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } },
  ];
  const audit = auditBatchDiversity(batch);
  assert.equal(audit.violations.length, 2);
  assert.equal(audit.isDiverse, false);
});

test('auditBatchDiversity: four distinct shot+lighting combos → diverse', () => {
  const batch = [
    { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } },
    { image_axes: { shot_type: 'wide_environmental', lighting: 'overcast_diffuse' } },
    { image_axes: { shot_type: 'overhead_flat_lay', lighting: 'cool_blue_morning' } },
    { image_axes: { shot_type: 'macro', lighting: 'lamp_artificial_warm' } },
  ];
  const audit = auditBatchDiversity(batch);
  assert.equal(audit.violations.length, 0);
  assert.equal(audit.shotTypeCount, 4);
  assert.equal(audit.isDiverse, true);
});

test('auditBatchDiversity: same shot but different lighting → no violation', () => {
  const batch = [
    { image_axes: { shot_type: 'close_up', lighting: 'warm_golden_hour' } },
    { image_axes: { shot_type: 'close_up', lighting: 'cool_blue_morning' } },
  ];
  const audit = auditBatchDiversity(batch);
  assert.equal(audit.violations.length, 0);
});

test('suggestUntakenAxes: returns pair not in taken set', () => {
  const taken = [
    { shot_type: 'close_up', lighting: 'warm_golden_hour' },
    { shot_type: 'macro', lighting: 'warm_golden_hour' },
  ];
  const out = suggestUntakenAxes(taken);
  const key = `${out.shot_type}|${out.lighting}`;
  assert.ok(!taken.some((t) => `${t.shot_type}|${t.lighting}` === key));
});

test('buildImagePromptGuidelines: rachel_in_frame includes location list', () => {
  const text = buildImagePromptGuidelines('rachel_in_frame');
  assert.match(text, /kitchen/);
  assert.match(text, /bathroom/);
  assert.match(text, /rachel_in_frame/);
});

test('buildImagePromptGuidelines: broll mode unrestricted', () => {
  const text = buildImagePromptGuidelines('broll');
  assert.match(text, /B-roll/);
  assert.match(text, /NOT limited/);
});
