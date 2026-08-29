'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { APEX_TRIBUTE_SELLS, sellEntry, validateCatalog } = require('../src/sentinel/arkshop-nexus-launch-v9-apex-tribute-sell-startup.cjs');

test('v9 defines thirteen apex and tribute sell entries', () => {
  assert.equal(Object.keys(APEX_TRIBUTE_SELLS).length, 13);
  assert.equal(validateCatalog(), true);
  assert.equal(APEX_TRIBUTE_SELLS.alpha_raptor_claw[1], 25);
  assert.equal(APEX_TRIBUTE_SELLS.alpha_rex_tooth[1], 75);
  assert.equal(APEX_TRIBUTE_SELLS.basilo_blubber[1], 30);
});

test('v9 sells use exact vanilla ApexDrop single-item schema', () => {
  const entry = sellEntry(APEX_TRIBUTE_SELLS.argentavis_talon);
  assert.deepEqual(entry, {
    Type: 'item', Description: 'Argentavis Talon', Price: 15, Amount: 1,
    Blueprint: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_ApexDrop_Argentavis.PrimalItemResource_ApexDrop_Argentavis'"
  });
});

test('v9 paths are not guessed TG Stack child paths', () => {
  for (const spec of Object.values(APEX_TRIBUTE_SELLS)) {
    assert.match(spec[2], /^Blueprint'\/Game\/PrimalEarth\/CoreBlueprints\/Resources\/PrimalItemResource_ApexDrop_/);
    assert.doesNotMatch(spec[2], /TG_Stack_10000_90/);
  }
});
