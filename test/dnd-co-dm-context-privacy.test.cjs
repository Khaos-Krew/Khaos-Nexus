'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureCoDmState,
  buildCampaignContext,
  normalizeDraft
} = require('../shared/dnd-co-dm.cjs');

function stateWithPrivateNotes() {
  return ensureCoDmState({
    campaigns: [{ id: 'c1', name: 'Emberfall', description: 'Public description', coDmNotes: 'Private campaign Co-DM notes', active: true }],
    members: [], characters: [], quests: [], npcs: [], locations: [], factions: [], encounters: [], sessions: [], sources: [], campaignSources: [], homebrew: [], rolls: [], registeredApps: [], bindings: [], panels: [], grants: [], channelContexts: [], audit: [], attendance: [], loot: [], combatants: [], contentEntries: []
  });
}

test('campaign Co-DM notes require the explicit GM-notes option', () => {
  const hidden = buildCampaignContext(stateWithPrivateNotes(), 'c1', { includeGmNotes: false });
  const included = buildCampaignContext(stateWithPrivateNotes(), 'c1', { includeGmNotes: true });
  assert.match(hidden.text, /Public description/);
  assert.doesNotMatch(hidden.text, /Private campaign Co-DM notes/);
  assert.match(included.text, /Private campaign Co-DM notes/);
});

test('normalizing an existing draft preserves its timestamps', () => {
  const draft = normalizeDraft({
    id: 'd1', campaignId: 'c1', workflow: 'session_prep', title: 'Plan', content: 'Draft content',
    createdAt: '2026-08-03T04:00:00.000Z', updatedAt: '2026-08-03T04:30:00.000Z'
  });
  assert.equal(draft.createdAt, '2026-08-03T04:00:00.000Z');
  assert.equal(draft.updatedAt, '2026-08-03T04:30:00.000Z');
});
