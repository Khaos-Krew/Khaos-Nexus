'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeVeyraLiveState,
  liveTurnProjection,
  appendLiveTurnContext
} = require('../shared/dnd-veyra-live-state-authority.cjs');

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

test('Veyra live projection hydrates active session and current combatant identity', () => {
  const state = normalizeVeyraLiveState({
    sessions: [
      { id: 'session-old', campaignId: 'campaign-1', status: 'completed' },
      { id: 'session-live', campaignId: 'campaign-1', title: 'Live session', status: 'active', startsAt: '2026-09-03T12:00:00Z' }
    ],
    encounters: [
      { id: 'enc-old', campaignId: 'campaign-1', status: 'completed', currentTurnIndex: 0 },
      { id: 'enc-live', campaignId: 'campaign-1', name: 'Bridge Fight', status: 'active', currentTurnIndex: 2, turnIndex: 0, currentCombatantId: 'combatant-c', round: 4 }
    ]
  });
  const live = liveTurnProjection(state, 'campaign-1');
  assert.equal(live.session.id, 'session-live');
  assert.equal(live.encounter.id, 'enc-live');
  assert.equal(live.encounter.currentTurnIndex, 2);
  assert.equal(live.encounter.currentCombatantId, 'combatant-c');
  assert.equal(live.encounter.round, 4);
});

test('Veyra appends authoritative live state without mutating runtime records', () => {
  const source = {
    sessions: [{ id: 'session-live', campaignId: 'campaign-1', status: 'active' }],
    encounters: [{ id: 'enc-live', campaignId: 'campaign-1', status: 'active', currentTurnIndex: 1, turnIndex: 7, currentCombatantId: 'combatant-b', round: 2 }]
  };
  const normalized = normalizeVeyraLiveState(source);
  const context = appendLiveTurnContext({
    text: 'KHAOS NEXUS CAMPAIGN CONTEXT',
    preview: 'KHAOS NEXUS CAMPAIGN CONTEXT',
    characterLimit: 48000,
    characters: 28,
    sections: []
  }, normalized, 'campaign-1');
  assert.equal(context.liveState.encounter.currentCombatantId, 'combatant-b');
  assert.match(context.text, /Authoritative live session \/ encounter state/);
  assert.match(context.text, /combatant-b/);
  assert.equal(source.encounters[0].turnIndex, 7, 'AI context projection must not mutate authoritative runtime state');
});

test('Veyra live-state projection respects the configured context character limit', () => {
  const state = normalizeVeyraLiveState({
    encounters: [{ id: 'enc-live', campaignId: 'campaign-1', status: 'active', currentTurnIndex: 1, currentCombatantId: 'combatant-b', round: 2 }]
  });
  const context = appendLiveTurnContext({
    text: '1234567890',
    preview: '1234567890',
    characterLimit: 20,
    characters: 10,
    sections: []
  }, state, 'campaign-1');
  assert.ok(context.text.length <= 20);
  assert.equal(context.sections.at(-1).reason, 'truncated by context character limit');
});

test('desktop installs Veyra live-state authority before Co-DM captures context exports', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const authority = entry.indexOf("require('../shared/dnd-veyra-live-state-authority.cjs').install()");
  const coDm = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  assert.ok(authority >= 0);
  assert.ok(coDm > authority);
});
