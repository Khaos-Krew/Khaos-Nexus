'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  captureCustomState,
  restoreCustomState,
  sanitizeCoDmForExternal
} = require('../main/dnd-co-dm-persistence-extension.cjs');

test('custom Co-DM state survives a legacy D&D normalization boundary', () => {
  const original = {
    campaigns: [
      { id: 'c1', name: 'Emberfall', coDmNotes: 'Protected campaign planning notes.' },
      { id: 'c2', name: 'Second campaign' }
    ],
    coDmSettings: { model: 'gpt-5-mini', maxOutputTokens: 2200 },
    coDmDrafts: [{ id: 'd1', campaignId: 'c1', content: 'Draft text', updatedAt: '2026-08-03T05:00:00Z' }]
  };
  const custom = captureCustomState(original);
  const normalized = {
    campaigns: [
      { id: 'c1', name: 'Emberfall' },
      { id: 'c2', name: 'Second campaign' }
    ]
  };
  restoreCustomState(normalized, custom);
  assert.deepEqual(normalized.coDmSettings, original.coDmSettings);
  assert.deepEqual(normalized.coDmDrafts, original.coDmDrafts);
  assert.equal(normalized.campaigns[0].coDmNotes, 'Protected campaign planning notes.');
  assert.equal('coDmNotes' in normalized.campaigns[1], false);
});

test('captured custom state is detached from the live configuration object', () => {
  const state = {
    campaigns: [{ id: 'c1', coDmNotes: 'Original' }],
    coDmSettings: { model: 'gpt-5-mini' },
    coDmDrafts: [{ id: 'd1', content: 'Original draft' }]
  };
  const captured = captureCustomState(state);
  state.coDmSettings.model = 'changed';
  state.coDmDrafts[0].content = 'changed';
  state.campaigns[0].coDmNotes = 'changed';
  assert.equal(captured.coDmSettings.model, 'gpt-5-mini');
  assert.equal(captured.coDmDrafts[0].content, 'Original draft');
  assert.equal(captured.campaignNotes.c1, 'Original');
});

test('external configuration and bot bootstraps exclude Co-DM private text', () => {
  const state = {
    campaigns: [{ id: 'c1', name: 'Emberfall', coDmNotes: 'Private campaign notes' }],
    coDmSettings: { model: 'gpt-5-mini' },
    coDmDrafts: [{ id: 'd1', content: 'Private generated draft' }],
    quests: [{ id: 'q1', title: 'Public campaign record' }]
  };
  const sanitized = sanitizeCoDmForExternal(state);
  assert.equal('coDmSettings' in sanitized, false);
  assert.equal('coDmDrafts' in sanitized, false);
  assert.equal('coDmNotes' in sanitized.campaigns[0], false);
  assert.equal(sanitized.quests[0].title, 'Public campaign record');
  assert.equal(state.coDmDrafts[0].content, 'Private generated draft');
});

test('persistence extension excludes the provider key from backup payloads', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-persistence-extension.cjs'), 'utf8');
  assert.match(source, /delete sanitized\.dndCoDmOpenAiKey/);
  assert.match(source, /intentionally excluded from backups/);
  assert.match(source, /mutateDnd\(mutator\)/);
  assert.match(source, /restoreCustomState\(this\.config\.dnd, after\)/);
  assert.match(source, /getRuntimeBootstrap\(\)/);
  assert.match(source, /getRegisteredBotBootstraps\(\)/);
});
