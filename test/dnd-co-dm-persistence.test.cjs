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
    coDmSettings: { serviceEndpoint: 'http://127.0.0.1:8787', model: 'default', maxOutputCharacters: 40000 },
    coDmDrafts: [{ id: 'd1', campaignId: 'c1', content: 'Draft text', updatedAt: '2026-08-03T05:00:00Z' }],
    coDmServiceBindings: [{ id: 'b1', campaignId: 'c1', endpoint: 'http://127.0.0.1:8787', serviceCampaignId: 'service-c1', contextFingerprint: 'abc123' }]
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
  assert.deepEqual(normalized.coDmServiceBindings, original.coDmServiceBindings);
  assert.equal(normalized.campaigns[0].coDmNotes, 'Protected campaign planning notes.');
  assert.equal('coDmNotes' in normalized.campaigns[1], false);
});

test('captured custom state is detached from the live configuration object', () => {
  const state = {
    campaigns: [{ id: 'c1', coDmNotes: 'Original' }],
    coDmSettings: { model: 'default' },
    coDmDrafts: [{ id: 'd1', content: 'Original draft' }],
    coDmServiceBindings: [{ id: 'b1', serviceCampaignId: 'service-c1' }]
  };
  const captured = captureCustomState(state);
  state.coDmSettings.model = 'changed';
  state.coDmDrafts[0].content = 'changed';
  state.coDmServiceBindings[0].serviceCampaignId = 'changed';
  state.campaigns[0].coDmNotes = 'changed';
  assert.equal(captured.coDmSettings.model, 'default');
  assert.equal(captured.coDmDrafts[0].content, 'Original draft');
  assert.equal(captured.coDmServiceBindings[0].serviceCampaignId, 'service-c1');
  assert.equal(captured.campaignNotes.c1, 'Original');
});

test('external configuration and bot bootstraps exclude Co-DM private text and AI bindings', () => {
  const state = {
    campaigns: [{ id: 'c1', name: 'Emberfall', coDmNotes: 'Private campaign notes' }],
    coDmSettings: { model: 'default', serviceEndpoint: 'http://127.0.0.1:8787' },
    coDmDrafts: [{ id: 'd1', content: 'Private generated draft' }],
    coDmServiceBindings: [{ id: 'b1', serviceCampaignId: 'private-service-campaign-id' }],
    quests: [{ id: 'q1', title: 'Public campaign record' }]
  };
  const sanitized = sanitizeCoDmForExternal(state);
  assert.equal('coDmSettings' in sanitized, false);
  assert.equal('coDmDrafts' in sanitized, false);
  assert.equal('coDmServiceBindings' in sanitized, false);
  assert.equal('coDmNotes' in sanitized.campaigns[0], false);
  assert.equal(sanitized.quests[0].title, 'Public campaign record');
  assert.equal(state.coDmDrafts[0].content, 'Private generated draft');
});

test('persistence extension excludes AI service and legacy provider secrets from backups', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-persistence-extension.cjs'), 'utf8');
  assert.match(source, /delete sanitized\.dndAiServiceToken/);
  assert.match(source, /delete sanitized\.dndCoDmOpenAiKey/);
  assert.match(source, /AI service token is intentionally excluded from backups/);
  assert.match(source, /mutateDnd\(mutator\)/);
  assert.match(source, /restoreCustomState\(this\.config\.dnd, after\)/);
  assert.match(source, /getRuntimeBootstrap\(\)/);
  assert.match(source, /getRegisteredBotBootstraps\(\)/);
});
