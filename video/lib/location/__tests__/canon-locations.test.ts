import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANON_LOCATIONS, CANON_LOCATION_NUMBERS_DEFINED } from '../canon/canon-locations.ts';

test('CANON_LOCATION_NUMBERS_DEFINED contains 1 and 2', () => {
  assert.deepEqual([...CANON_LOCATION_NUMBERS_DEFINED], [1, 2]);
});

test('every defined slot has location_NN key', () => {
  for (const n of CANON_LOCATION_NUMBERS_DEFINED) {
    const key = `location_${String(n).padStart(2, '0')}`;
    assert.ok(CANON_LOCATIONS[key], `missing canon dict entry for ${key}`);
  }
});

test('every defined location has all 8 structured fields populated', () => {
  for (const id of CANON_LOCATION_NUMBERS_DEFINED.map(
    (n) => `location_${String(n).padStart(2, '0')}`,
  )) {
    const loc = CANON_LOCATIONS[id]!;
    assert.ok(loc.name.length > 0, `${id}: name`);
    assert.ok(loc.tier === 'primary' || loc.tier === 'secondary', `${id}: tier`);
    assert.ok(loc.camera_angle.length > 0, `${id}: camera_angle`);
    assert.ok(loc.camera_distance.length > 0, `${id}: camera_distance`);
    assert.ok(loc.rachel_position.length > 0, `${id}: rachel_position`);
    assert.ok(loc.background_composition.length > 0, `${id}: background_composition`);
    assert.ok(loc.lighting_setup.length > 0, `${id}: lighting_setup`);
    assert.ok(Array.isArray(loc.props) && loc.props.length > 0, `${id}: props`);
    assert.ok(loc.wall_color.length > 0, `${id}: wall_color`);
    assert.ok(loc.floor_material.length > 0, `${id}: floor_material`);
    assert.ok(loc.best_for.length > 0, `${id}: best_for`);
  }
});

test('kitchen is location_01 + primary', () => {
  assert.equal(CANON_LOCATIONS.location_01!.name, 'kitchen');
  assert.equal(CANON_LOCATIONS.location_01!.tier, 'primary');
});

test('home_studio is location_02 + primary', () => {
  assert.equal(CANON_LOCATIONS.location_02!.name, 'home_studio');
  assert.equal(CANON_LOCATIONS.location_02!.tier, 'primary');
});

test('rachel_position phrasing reflects the kitchen/studio difference', () => {
  assert.match(CANON_LOCATIONS.location_01!.rachel_position, /kitchen island/);
  assert.match(CANON_LOCATIONS.location_02!.rachel_position, /wooden desk/);
});
