'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureCoDmState, buildCampaignContext } = require('../shared/dnd-co-dm.cjs');
const { normalizeHealth, buildLegacyCampaignRequest } = require('../shared/dnd-ai-service.cjs');

function state() {
  return ensureCoDmState({
    campaigns: [{ id: 'c1', name: 'Emberfall', description: 'Public campaign description.', active: true }],
    characters: [{ id: 'character-1', campaignId: 'c1', name: 'Private Character Name', notes: 'Private character notes.', active: true }],
    members: [], quests: [], npcs: [], locations: [], factions: [], encounters: [], sessions: [], sources: [], campaignSources: [], homebrew: [], rolls: [], registeredApps: [], bindings: [], panels: [], grants: [], channelContexts: [], audit: [], attendance: [], loot: [], combatants: [], contentEntries: []
  });
}

test('legacy AI synchronization omits character records when character context is disabled', () => {
  const campaignState = state();
  const context = buildCampaignContext(campaignState, 'c1', { includeCharacterDetails: false });
  const request = buildLegacyCampaignRequest(campaignState, 'c1', context);
  assert.deepEqual(request.playerCharacters, []);
  assert.doesNotMatch(JSON.stringify(request), /Private Character Name|Private character notes/);
});

test('explicit dedicated-only capabilities are not reclassified as legacy campaign turns', () => {
  const health = normalizeHealth({
    status: 'ok',
    service: 'khaos-nexus-ai',
    apiVersion: '1',
    capabilities: ['dnd.co-dm.draft']
  });
  assert.equal(health.dedicatedDrafts, true);
  assert.equal(health.legacyCampaignTurns, false);
  assert.deepEqual(health.capabilities, ['dnd.co-dm.draft']);
});
