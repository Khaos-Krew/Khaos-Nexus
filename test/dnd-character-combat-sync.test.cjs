'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const solo = require('../shared/dnd-solo-combat.cjs');

function activeCombatState() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [{
      id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true,
      hp: 20, maxHp: 20, armorClass: 16, initiativeModifier: 2, conditions: []
    }],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
  solo.ensureSoloCombatState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, {
    campaignId: 'campaign-1', enabled: true, mode: 'solo_ai_dm', pace: 'live', automationLevel: 'automatic_combat'
  });
  const adventure = solo.startSoloAdventure(state, {
    campaignId: 'campaign-1', characterId: 'hero', actorId: 'owner',
    locationName: 'Forge Gate', publicDescription: 'Ash falls.'
  });
  const combat = solo.startCombat(state, {
    campaignId: 'campaign-1', runId: adventure.run.id, sceneId: adventure.scene.id,
    actorId: 'owner', clientCombatId: 'character-sync-combat',
    combatants: [
      { id: 'hero-c', characterId: 'hero', actorType: 'player', name: 'Vorkesh', hp: 20, maxHp: 20, initiativeRoll: 20 },
      { id: 'enemy-c', actorType: 'enemy', name: 'Ash Wraith', hp: 12, maxHp: 12, initiativeRoll: 1 }
    ]
  }, () => 0.5).combat;
  return { state, combat };
}

test('natural twenty death save synchronizes revived HP and consciousness to the canonical character', () => {
  const { state, combat } = activeCombatState();
  const persistedCombat = state.runtimeCombats.find((item) => item.id === combat.id);
  const combatant = persistedCombat.combatants.find((item) => item.id === 'hero-c');
  const character = state.characters.find((item) => item.id === 'hero');

  combatant.currentHp = 0;
  combatant.conditions.push('unconscious');
  character.hp = 0;
  character.conditions.push('unconscious');

  const result = solo.resolveDeathSave(state, {
    combatId: combat.id, combatantId: 'hero-c', idempotencyKey: 'natural-20-recovery'
  }, () => 0.999999);

  assert.equal(result.natural, 20);
  assert.equal(combatant.currentHp, 1);
  assert.equal(character.hp, 1);
  assert.equal(combatant.conditions.includes('unconscious'), false);
  assert.equal(character.conditions.includes('unconscious'), false);
  assert.equal(state.stateEvents.filter((item) => item.idempotencyKey === 'natural-20-recovery:revive').length, 1);
  assert.equal(state.stateEvents.filter((item) => item.idempotencyKey === 'natural-20-recovery:conscious').length, 1);

  const duplicate = solo.resolveDeathSave(state, {
    combatId: combat.id, combatantId: 'hero-c', idempotencyKey: 'natural-20-recovery'
  }, () => 0);
  assert.equal(duplicate.natural, 20);
  assert.equal(character.hp, 1);
  assert.equal(character.conditions.includes('unconscious'), false);
  assert.equal(state.stateEvents.filter((item) => item.idempotencyKey === 'natural-20-recovery:conscious').length, 1);
});
