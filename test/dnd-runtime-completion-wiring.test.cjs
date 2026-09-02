'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('desktop installs D&D runtime integrity after the campaign config extension', () => {
  const entry = source('main/entry.cjs');
  const campaignIndex = entry.indexOf("require('./dnd-campaign-extension.cjs').install();");
  const integrityIndex = entry.indexOf("require('./dnd-runtime-integrity-extension.cjs').install();");

  assert.ok(campaignIndex >= 0, 'campaign extension must be installed');
  assert.ok(integrityIndex > campaignIndex, 'runtime integrity must patch the campaign-aware ConfigStore export');
});

test('bot installs D&D completion patch before encounter policy modules are loaded', () => {
  const entry = source('bot/entry.cjs');
  const patchIndex = entry.indexOf("require('./dnd-runtime-completion-patch.cjs').install();");
  const policyIndex = entry.indexOf("require('./dnd-encounter-panel-policy.cjs')");

  assert.ok(patchIndex >= 0, 'bot runtime completion patch must be installed');
  assert.ok(policyIndex > patchIndex, 'completion patch must run before D&D policy modules capture runtime exports');
});

test('runtime completion patch keeps initiative identity helpers in the live bot path', () => {
  const patch = source('bot/dnd-runtime-completion-patch.cjs');
  assert.match(patch, /advanceInitiativeByIdentity/);
  assert.match(patch, /currentCombatantId/);
  assert.match(patch, /assertSessionEndable/);
});
