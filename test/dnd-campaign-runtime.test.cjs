'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');

function state() {
  return {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true, currentLocation: '' }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [{
      id: 'character-1', campaignId: 'campaign-1', name: 'Vorkesh Emberforge', active: true,
      hp: 20, maxHp: 30, armorClass: 16, level: 3, className: 'Artificer', conditions: []
    }],
    quests: [{ id: 'quest-1', campaignId: 'campaign-1', title: 'The Ember Key', status: 'active', stage: 'Find the forge' }],
    loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
}

function readyState() {
  const value = state();
  runtime.ensureCampaignRuntimeState(value);
  runtime.enableOwnerPreview(value, 'owner');
  runtime.upsertPlayProfile(value, {
    campaignId: 'campaign-1',
    enabled: true,
    mode: 'group_ai_dm',
    pace: 'asynchronous',
    automationLevel: 'narration_and_npcs',
    automation: { applyNarrativeEvents: true }
  });
  const seat = runtime.upsertPlayerSeat(value, {
    campaignId: 'campaign-1', memberId: 'member-1', characterId: 'character-1',
    type: 'human_player', displayName: 'Kirito', ready: true
  });
  const run = runtime.startCampaignRun(value, { campaignId: 'campaign-1', actorId: 'owner', worldTime: 'Day 1' });
  const scene = runtime.startScene(value, {
    campaignId: 'campaign-1', runId: run.id, actorId: 'owner', locationName: 'Emberfall Forge',
    publicDescription: 'The forge glows beneath a blackened mountain.', participantSeatIds: [seat.id], worldTime: 'Day 1, dusk'
  });
  return { value, seat, run, scene };
}

test('runtime state initializes behind a development-only gate', () => {
  const value = state();
  runtime.ensureCampaignRuntimeState(value);
  assert.equal(value.runtimeSchemaVersion, 1);
  assert.equal(value.runtimeGate.status, 'development_only');
  assert.equal(value.runtimeGate.releaseAuthorized, false);
  assert.throws(() => runtime.upsertPlayProfile(value, { campaignId: 'campaign-1', enabled: true }), /Owner preview/);
});

test('owner preview enables a solo or group profile without authorizing release', () => {
  const value = state();
  runtime.ensureCampaignRuntimeState(value);
  const gate = runtime.enableOwnerPreview(value, 'owner');
  const profile = runtime.upsertPlayProfile(value, {
    campaignId: 'campaign-1', enabled: true, mode: 'solo_ai_dm', pace: 'live', automationLevel: 'full_ai_dm'
  });
  assert.equal(gate.status, 'owner_preview');
  assert.equal(gate.releaseAuthorized, false);
  assert.equal(profile.mode, 'solo_ai_dm');
  assert.equal(profile.automation.applyMechanicalEvents, false);
  assert.equal(profile.automation.publishDiscord, false);
});

test('player seats prevent duplicate active character ownership', () => {
  const value = state();
  runtime.ensureCampaignRuntimeState(value);
  runtime.enableOwnerPreview(value, 'owner');
  runtime.upsertPlayerSeat(value, { campaignId: 'campaign-1', characterId: 'character-1', type: 'human_player', displayName: 'Player One' });
  assert.throws(() => runtime.upsertPlayerSeat(value, {
    campaignId: 'campaign-1', characterId: 'character-1', type: 'human_player', displayName: 'Player Two'
  }), /already assigned/);
});

test('group turn collection requires locked actions before Veyra resolution', () => {
  const { value, seat, run, scene } = readyState();
  const turn = runtime.openTurnCycle(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id] });
  const submitted = runtime.submitTurnAction(value, {
    turnCycleId: turn.id, seatId: seat.id, characterId: 'character-1', text: 'I examine the rune-covered anvil.', clientActionId: 'action-1'
  });
  assert.equal(submitted.duplicate, false);
  assert.throws(() => runtime.markTurnResolving(value, turn.id), /must be locked/);
  const locked = runtime.lockTurnAction(value, { turnCycleId: turn.id, actionId: submitted.action.id });
  assert.equal(locked.allRequiredActionsLocked, true);
  assert.equal(value.turnCycles.find((item) => item.id === turn.id).status, 'locked');
  const resolving = runtime.markTurnResolving(value, turn.id);
  assert.equal(resolving.status, 'resolving');
});

test('runtime prevents overlapping turns and multiple actions from the same seat', () => {
  const { value, seat, run, scene } = readyState();
  const turn = runtime.openTurnCycle(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id] });
  assert.throws(() => runtime.openTurnCycle(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id }), /active turn/);
  runtime.submitTurnAction(value, { turnCycleId: turn.id, seatId: seat.id, text: 'I inspect the forge.', clientActionId: 'seat-action-1' });
  assert.throws(() => runtime.submitTurnAction(value, { turnCycleId: turn.id, seatId: seat.id, text: 'I also open the vault.', clientActionId: 'seat-action-2' }), /already submitted/);
});

test('shared Veyra context excludes character-specific secrets', () => {
  const { value, seat, run, scene } = readyState();
  value.knowledgeRecords.push({ id: 'secret-1', campaignId: 'campaign-1', runId: run.id, text: 'The duke is a vampire.', visibility: 'selected_characters', characterIds: ['character-1'] });
  const turn = runtime.openTurnCycle(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id] });
  const action = runtime.submitTurnAction(value, { turnCycleId: turn.id, seatId: seat.id, text: 'I watch the duke.', clientActionId: 'secret-action' });
  runtime.lockTurnAction(value, { turnCycleId: turn.id, actionId: action.action.id });
  const shared = runtime.buildVeyraRuntimeEnvelope(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, turnCycleId: turn.id });
  const privateEnvelope = runtime.buildVeyraRuntimeEnvelope(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, turnCycleId: turn.id, audienceCharacterIds: ['character-1'] });
  assert.doesNotMatch(JSON.stringify(shared), /duke is a vampire/);
  assert.match(JSON.stringify(privateEnvelope), /duke is a vampire/);
});

test('state events are idempotent and deterministic', () => {
  const { value, run, scene } = readyState();
  const first = runtime.appendStateEvent(value, {
    campaignId: 'campaign-1', runId: run.id, sceneId: scene.id,
    type: 'character.hp.changed', actorType: 'rules_engine', idempotencyKey: 'damage-1',
    payload: { characterId: 'character-1', delta: -7 }
  });
  const duplicate = runtime.appendStateEvent(value, {
    campaignId: 'campaign-1', runId: run.id, sceneId: scene.id,
    type: 'character.hp.changed', actorType: 'rules_engine', idempotencyKey: 'damage-1',
    payload: { characterId: 'character-1', delta: -7 }
  });
  assert.equal(first.applied, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(value.characters[0].hp, 13);
});

test('checkpoints restore campaign-scoped runtime and character state', () => {
  const { value, run } = readyState();
  const checkpoint = runtime.createCheckpoint(value, { campaignId: 'campaign-1', runId: run.id, label: 'Before damage', createdBy: 'owner' });
  runtime.appendStateEvent(value, {
    campaignId: 'campaign-1', runId: run.id, type: 'character.hp.changed', actorType: 'rules_engine',
    idempotencyKey: 'damage-after-checkpoint', payload: { characterId: 'character-1', delta: -12 }
  });
  assert.equal(value.characters[0].hp, 8);
  runtime.restoreCheckpoint(value, checkpoint.id, { actorId: 'owner' });
  assert.equal(value.characters[0].hp, 20);
});

test('Veyra context excludes Discord identifiers and preserves player declarations', () => {
  const { value, seat, run, scene } = readyState();
  value.members[0].discordUserId = '123456789012345678';
  const turn = runtime.openTurnCycle(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id] });
  const action = runtime.submitTurnAction(value, { turnCycleId: turn.id, seatId: seat.id, text: 'I inspect the anvil.', clientActionId: 'action-context' });
  runtime.lockTurnAction(value, { turnCycleId: turn.id, actionId: action.action.id });
  const envelope = runtime.buildVeyraRuntimeEnvelope(value, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, turnCycleId: turn.id });
  const serialized = JSON.stringify(envelope);
  assert.match(serialized, /I inspect the anvil/);
  assert.doesNotMatch(serialized, /123456789012345678/);
  assert.equal(envelope.safety.releaseAuthorized, false);
});

test('Veyra proposals reject player dialogue and mechanical state events', () => {
  assert.throws(() => runtime.validateVeyraProposal({
    narration: 'Vorkesh decides to surrender.', npcDialogue: [], proposedChecks: [], proposedEvents: []
  }, { playerCharacters: [{ name: 'Vorkesh' }] }), /attempted to decide/);
  assert.throws(() => runtime.validateVeyraProposal({
    narration: 'The furnace roars.', npcDialogue: [], proposedChecks: [],
    proposedEvents: [{ type: 'character.hp.changed', payload: { characterId: 'character-1', delta: -2 } }]
  }, { playerCharacters: [{ name: 'Vorkesh' }] }), /not allowed/);
});

test('deterministic rules helpers expose all dice and modifiers', () => {
  const values = [0.95, 0.1];
  const result = runtime.resolveAbilityCheck({ modifier: 4, dc: 18, advantage: true }, () => values.shift());
  assert.deepEqual(result.dice, [20, 3]);
  assert.equal(result.natural, 20);
  assert.equal(result.total, 24);
  assert.equal(result.success, true);
  assert.equal(result.critical, true);
});
