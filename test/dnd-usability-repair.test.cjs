'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseConditions,
  validateCampaignDraft,
  validateCharacterDraft,
  saveCampaignFlow,
  saveCharacterFlow,
  unavailableMessage
} = require('../renderer/dnd-usability-repair.js');

test('campaign creation validates and sends an in-app form payload through existing IPC', async () => {
  const calls = [];
  const result = await saveCampaignFlow({
    invoke: async (channel, payload) => { calls.push({ channel, payload }); return { state: { campaigns: [{ id: 'campaign-1', ...payload }] } }; },
    draft: { name: '  The Long Night  ', ruleset: '5e_2024', status: 'planning', description: ' Session zero ' }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'dnd:campaign-save');
  assert.equal(calls[0].payload.name, 'The Long Night');
  assert.equal(result.state.campaigns[0].id, 'campaign-1');
});

test('campaign validation rejects a blank name visibly before IPC', () => {
  assert.throws(() => validateCampaignDraft({ name: '   ' }), (error) => error.code === 'DND_FORM_VALIDATION' && error.field === 'name');
});

test('character form exposes and normalizes the supported persisted fields', () => {
  const value = validateCharacterDraft({
    campaignId: 'campaign-1', name: 'Vex', ownerUserId: 'owner', discordUserId: '123456789012345678',
    level: '7', className: 'Ranger', hp: '38', maxHp: '42', armorClass: '16', conditions: 'poisoned, prone, poisoned',
    inspiration: true, exhaustion: '1', status: 'active', initiativeModifier: '4', portraitUrl: 'https://example.test/vex.png',
    activeQuestId: 'quest-1', selected: true
  });
  assert.deepEqual(value.conditions, ['poisoned', 'prone']);
  assert.equal(value.level, 7);
  assert.equal(value.hp, 38);
  assert.equal(value.selected, true);
  assert.equal(value.activeQuestId, 'quest-1');
});

test('character create/edit flow unselects only the same owner before selecting a character', async () => {
  const calls = [];
  const invoke = async (channel, payload) => { calls.push({ channel, payload }); return { state: { characters: [] } }; };
  await saveCharacterFlow({
    invoke,
    characters: [
      { id: 'old', campaignId: 'campaign-1', discordUserId: '123456789012345678', name: 'Old', selected: true },
      { id: 'other', campaignId: 'campaign-1', discordUserId: '999999999999999999', name: 'Other', selected: true }
    ],
    draft: {
      id: 'new', campaignId: 'campaign-1', discordUserId: '123456789012345678', name: 'New',
      level: 1, hp: 1, maxHp: 1, armorClass: 10, exhaustion: 0, initiativeModifier: 0, selected: true
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.id, 'old');
  assert.equal(calls[0].payload.selected, false);
  assert.equal(calls[1].payload.id, 'new');
  assert.equal(calls[1].payload.selected, true);
});

test('character validation reports invalid Discord IDs and HP ranges', () => {
  assert.throws(() => validateCharacterDraft({ campaignId: 'c', name: 'Bad', discordUserId: 'abc' }), /Discord user ID/);
  assert.throws(() => validateCharacterDraft({ campaignId: 'c', name: 'Bad', hp: 20, maxHp: 10 }), /Current HP/);
});

test('disabled module errors become a stable non-destructive workspace message', () => {
  assert.match(unavailableMessage({ code: 'MODULE_DISABLED', message: 'module disabled' }), /Enable it in Modules/);
  assert.match(unavailableMessage({ code: 'OWNER_ACCESS_REQUIRED', message: 'owner access' }), /Owner access/);
});

test('condition parsing is stable and deduplicated', () => {
  assert.deepEqual(parseConditions('blinded, prone, blinded'), ['blinded', 'prone']);
});
