'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TARGET, COMMAND } = require('../src/sentinel/dinodepot-category-probe-runtime.cjs');

test('Dino Depot category probe is hard-coded to a nonexistent Nexus target', () => {
  assert.equal(TARGET, 'NONEXISTENT_NEXUS_PROBE_000');
  assert.equal(COMMAND, 'ScriptCommand SpawnDinoInBall -p=NONEXISTENT_NEXUS_PROBE_000 -t=any -l=200 -i=1 -a=1');
  assert.doesNotMatch(COMMAND, /Khaos|0002/i);
});

test('Dino Depot category probe cannot mutate points or configs', () => {
  assert.doesNotMatch(COMMAND, /ChangePoints|SetPoints|AddPoints|ArkShop\.Reload|SaveWorld|Destroy|Kill|GiveItem/i);
  assert.match(COMMAND, /^ScriptCommand SpawnDinoInBall /);
});
