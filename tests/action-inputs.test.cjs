'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTION_INPUTS, inputDefinition, actionInputModal, parseActionInputId } = require('../src/sentinel/action-inputs.cjs');

const EXPECTED = [
  'warframe:market', 'warframe:builds',
  'division2:gear', 'division2:builds', 'division2:farming',
  'ark:broadcast', 'palworld:broadcast', 'minecraft:broadcast', 'rust:broadcast'
];

test('all parameterized module actions have Discord modal definitions', () => {
  assert.deepEqual(Object.keys(ACTION_INPUTS).sort(), [...EXPECTED].sort());
  for (const key of EXPECTED) {
    const [moduleId, actionId] = key.split(':');
    const definition = inputDefinition(moduleId, actionId);
    assert.ok(definition);
    assert.ok(definition.label);
    assert.ok(definition.placeholder);
  }
});

test('modal custom ids round-trip module and action safely', () => {
  const modal = actionInputModal('division2', 'gear');
  assert.equal(modal.data.custom_id, 'nexusinput:division2:gear');
  assert.deepEqual(parseActionInputId(modal.data.custom_id), { moduleId: 'division2', actionId: 'gear' });
  assert.equal(parseActionInputId('bad'), null);
});

test('actions without input requirements do not create a modal', () => {
  assert.equal(inputDefinition('warframe', 'fissures'), null);
  assert.equal(actionInputModal('warframe', 'fissures'), null);
});
