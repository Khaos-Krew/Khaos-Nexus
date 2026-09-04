'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');

const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'dnd-campaign-runtime-extension.cjs'), 'utf8');

function readyState() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true, discordUserId: '123456789012345678' }],
    characters: [{
      id: 'character-1', campaignId: 'campaign-1', name: 'Vorkesh Emberforge', active: true,
      hp: 20, maxHp: 30, armorClass: 16, level: 3, className: 'Artificer', conditions: []
    }],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
  runtime.ensureCampaignRuntimeState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, {
    campaignId: 'campaign-1', enabled: true, mode: 'group_ai_dm', pace: 'live',
    automationLevel: 'narration_and_npcs', automation: { applyNarrativeEvents: true }
  });
  const seat = runtime.upsertPlayerSeat(state, {
    campaignId: 'campaign-1', memberId: 'member-1', characterId: 'character-1',
    type: 'human_player', displayName: 'Kirito', ready: true
  });
  const run = runtime.startCampaignRun(state, { campaignId: 'campaign-1', actorId: 'owner', worldTime: 'Day 1' });
  const scene = runtime.startScene(state, {
    campaignId: 'campaign-1', runId: run.id, actorId: 'owner', locationName: 'Emberfall Forge',
    publicDescription: 'The forge glows beneath a blackened mountain.', participantSeatIds: [seat.id], worldTime: 'Day 1, dusk'
  });
  state.knowledgeRecords.push({
    id: 'party-fact', campaignId: 'campaign-1', runId: run.id,
    text: 'The Ember Key opens the lower vault.', visibility: 'party', characterIds: []
  });
  state.knowledgeRecords.push({
    id: 'private-fact', campaignId: 'campaign-1', runId: run.id,
    text: 'The duke is a vampire.', visibility: 'selected_characters', characterIds: ['character-1']
  });
  const turn = runtime.openTurnCycle(state, {
    campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id]
  });
  const action = runtime.submitTurnAction(state, {
    turnCycleId: turn.id, seatId: seat.id, characterId: 'character-1',
    text: 'I inspect the rune-covered anvil.', clientActionId: 'veyra-context-action'
  });
  runtime.lockTurnAction(state, { turnCycleId: turn.id, actionId: action.action.id });
  return { state, run, scene, turn };
}

test('runtime sends Veyra the canonical hydrated envelope instead of a scene/action fragment', () => {
  assert.match(extensionSource, /message:\s*JSON\.stringify\(envelope\)/);
  assert.doesNotMatch(extensionSource, /JSON\.stringify\(\{\s*scene:\s*envelope\.scene,\s*actions:\s*envelope\.actions\s*\}\)/);
});

test('canonical Veyra envelope hydrates campaign state while preserving privacy boundaries', () => {
  const { state, run, scene, turn } = readyState();
  const envelope = runtime.buildVeyraRuntimeEnvelope(state, {
    campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, turnCycleId: turn.id
  });
  const serialized = JSON.stringify(envelope);

  assert.equal(envelope.schema, 'khaos-nexus.dnd-runtime.v1');
  assert.equal(envelope.campaign.name, 'Emberfall');
  assert.equal(envelope.profile.mode, 'group_ai_dm');
  assert.equal(envelope.run.worldTime, 'Day 1');
  assert.equal(envelope.scene.locationName, 'Emberfall Forge');
  assert.equal(envelope.characters[0].name, 'Vorkesh Emberforge');
  assert.equal(envelope.actions[0].declaration, 'I inspect the rune-covered anvil.');
  assert.match(serialized, /Ember Key opens the lower vault/);
  assert.doesNotMatch(serialized, /duke is a vampire/);
  assert.doesNotMatch(serialized, /123456789012345678/);
  assert.deepEqual(envelope.safety, {
    preservePlayerAgency: true,
    mechanicalEventsRequireRulesEngine: true,
    publishDiscord: false,
    releaseAuthorized: true
  });
});
