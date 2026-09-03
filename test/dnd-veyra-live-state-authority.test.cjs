'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeVeyraLiveState } = require('../shared/dnd-veyra-live-state-authority.cjs');

test('Veyra projects durable currentTurnIndex over stale legacy turnIndex', () => {
  const source = {
    encounters: [{ id: 'enc-1', currentTurnIndex: 2, turnIndex: 0, currentCombatantId: 'combatant-c' }]
  };
  const normalized = normalizeVeyraLiveState(source);
  assert.equal(normalized.encounters[0].currentTurnIndex, 2);
  assert.equal(normalized.encounters[0].turnIndex, 2);
  assert.equal(normalized.encounters[0].currentCombatantId, 'combatant-c');
  assert.equal(source.encounters[0].turnIndex, 0, 'context normalization must not mutate authoritative runtime state');
});

test('Veyra retains legacy turn index compatibility when durable field is absent', () => {
  const normalized = normalizeVeyraLiveState({ encounters: [{ id: 'enc-1', turnIndex: 3 }] });
  assert.equal(normalized.encounters[0].currentTurnIndex, 3);
  assert.equal(normalized.encounters[0].turnIndex, 3);
});

test('desktop installs Veyra live-state authority before Co-DM captures context exports', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const authority = entry.indexOf("require('../shared/dnd-veyra-live-state-authority.cjs').install()");
  const coDm = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  assert.ok(authority >= 0);
  assert.ok(coDm > authority);
});
