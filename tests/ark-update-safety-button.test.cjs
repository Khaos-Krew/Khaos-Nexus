'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTON_UPDATE_SAFETY, buildInfoButtons } = require('../src/sentinel/ark-cluster-panel.cjs');
const { isHealthInteraction } = require('../src/sentinel/ark-update-safety-extension.cjs');

test('ARK cluster panel exposes the Update Safety button', () => {
  const row = buildInfoButtons().toJSON();
  const safety = row.components.find((component) => component.custom_id === BUTTON_UPDATE_SAFETY);
  assert.ok(safety);
  assert.equal(safety.label, 'Update Safety');
});

test('update safety extension recognizes both slash command and panel button', () => {
  assert.equal(isHealthInteraction({ isChatInputCommand: () => true, commandName: 'ark-health', isButton: () => false }), true);
  assert.equal(isHealthInteraction({ isChatInputCommand: () => false, isButton: () => true, customId: BUTTON_UPDATE_SAFETY }), true);
  assert.equal(isHealthInteraction({ isChatInputCommand: () => false, isButton: () => true, customId: 'other' }), false);
});
