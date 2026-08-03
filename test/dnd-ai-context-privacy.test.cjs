'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  install,
  boundedSafetyRecord,
  safetyRecord,
  appendSafetyContext,
  sanitizeLegacyCampaignRequest
} = require('../shared/dnd-ai-context-privacy.cjs');

install();
const { ensureCoDmState, buildCampaignContext } = require('../shared/dnd-co-dm.cjs');
const { buildLegacyCampaignRequest } = require('../shared/dnd-ai-service.cjs');

function state() {
  return ensureCoDmState({
    campaigns: [{
      id: 'c1',
      name: 'Emberfall',
      contentRating: 'mature',
      safety: {
        lines: ['No sexual violence'],
        veils: ['Graphic torture'],
        pauseWords: ['pause']
      },
      active: true
    }],
    characters: [{
      id: 'internal-character-id',
      campaignId: 'c1',
      playerName: 'Private Player',
      name: 'Vorkesh',
      className: 'Artificer',
      level: 7,
      active: true
    }],
    members: [], quests: [], npcs: [], locations: [], factions: [], encounters: [], sessions: [], sources: [], campaignSources: [], homebrew: [], rolls: [], registeredApps: [], bindings: [], panels: [], grants: [], channelContexts: [], audit: [], attendance: [], loot: [], combatants: [], contentEntries: []
  });
}

test('safety settings are explicit previewed context', () => {
  const value = buildCampaignContext(state(), 'c1', { includeCharacterDetails: true });
  assert.match(value.text, /Safety settings/);
  assert.match(value.text, /No sexual violence/);
  assert.match(value.text, /Graphic torture/);
  assert.match(value.text, /"contentRating": "mature"/);
  assert.ok(value.sections.some((item) => item.id === 'safety'));
  assert.ok(value.characters <= value.characterLimit);
});

test('default pause words are represented when a campaign has no explicit safety object', () => {
  const value = safetyRecord({ campaigns: [{ id: 'c1', active: true }] }, 'c1');
  assert.deepEqual(value.pauseWords, ['pause', 'red card']);
  assert.equal(value.contentRating, 'teen');
});

test('legacy compatibility request omits internal character identifiers and player names', () => {
  const campaignState = state();
  const context = buildCampaignContext(campaignState, 'c1', { includeCharacterDetails: true });
  const request = buildLegacyCampaignRequest(campaignState, 'c1', context);
  const serialized = JSON.stringify(request);
  assert.equal(request.playerCharacters[0].name, 'Vorkesh');
  assert.equal('id' in request.playerCharacters[0], false);
  assert.equal('playerName' in request.playerCharacters[0], false);
  assert.doesNotMatch(serialized, /internal-character-id|Private Player/);
  assert.deepEqual(request.safety, safetyRecord(campaignState, 'c1'));
});

test('outgoing safety data is bounded exactly like the preview', () => {
  const long = 'x'.repeat(1500);
  const input = {
    contentRating: 'mature',
    lines: Array.from({ length: 120 }, (_, index) => `${index}-${long}`),
    veils: [long],
    pauseWords: []
  };
  const bounded = boundedSafetyRecord(input);
  const request = sanitizeLegacyCampaignRequest({ contentRating: 'mature', safety: input, playerCharacters: [] });
  assert.equal(bounded.lines.length, 100);
  assert.equal(bounded.lines[0].length, 1000);
  assert.equal(bounded.veils[0].length, 1000);
  assert.deepEqual(bounded.pauseWords, ['pause', 'red card']);
  assert.deepEqual(request.safety, bounded);
});

test('privacy helpers are deterministic and bounded', () => {
  const context = appendSafetyContext({ text: 'Base', preview: 'Base', characterLimit: 8000, sections: [] }, state(), 'c1', 8000);
  assert.ok(context.text.length <= 8000);
  const request = sanitizeLegacyCampaignRequest({ playerCharacters: [{ id: 'id', name: ' Hero ', playerName: 'Person', summary: ' Summary ' }] });
  assert.deepEqual(request.playerCharacters, [{ name: 'Hero', summary: 'Summary' }]);
});

test('entry installs context privacy before the Co-DM extension captures shared functions', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const privacy = entry.indexOf("require('../shared/dnd-ai-context-privacy.cjs').install()");
  const coDm = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  assert.ok(privacy >= 0);
  assert.ok(coDm > privacy);
});
