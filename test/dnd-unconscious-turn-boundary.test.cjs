'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const solo = require('../shared/dnd-solo-combat.cjs');

function activeUnconsciousTurn() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    characters: [{
      id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true,
      hp: 0, maxHp: 20, armorClass: 16, initiativeModifier: 2,
      conditions: ['unconscious'], spellSlots: { 1: 2 }, savingThrows: { constitution: 4 }
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
    actorId: 'owner', clientCombatId: 'unconscious-turn-boundary',
    combatants: [
      { id: 'hero-c', characterId: 'hero', actorType: 'player', name: 'Vorkesh', initiativeRoll: 20 },
      { id: 'enemy-c', actorType: 'enemy', name: 'Ash Wraith', hp: 12, maxHp: 12, initiativeRoll: 1 }
    ]
  }, () => 0.5).combat;
  return { state, combat };
}

function isIncapacitated(error) {
  return error?.code === 'DND_COMBAT_ACTOR_INCAPACITATED';
}

test('zero-HP unconscious current actor cannot use normal combat actions', () => {
  const { state, combat } = activeUnconsciousTurn();

  assert.throws(() => solo.resolveAttack(state, {
    combatId: combat.id, actorId: 'hero-c', targetId: 'enemy-c', attackModifier: 5,
    damageDiceCount: 1, damageDiceSides: 8, idempotencyKey: 'blocked-attack'
  }, () => 0.9), isIncapacitated);

  assert.throws(() => solo.castSpell(state, {
    combatId: combat.id, actorId: 'hero-c', spellName: 'Fire Bolt', level: 0,
    targetIds: ['enemy-c'], idempotencyKey: 'blocked-spell'
  }), isIncapacitated);

  assert.throws(() => solo.useCombatAction(state, {
    combatId: combat.id, actorId: 'hero-c', action: 'dodge', idempotencyKey: 'blocked-dodge'
  }), isIncapacitated);

  const live = state.runtimeCombats.find((item) => item.id === combat.id);
  assert.equal(live.log.length, 0);
  assert.equal(live.combatants.find((item) => item.id === 'hero-c').spellSlots[1], 2);
});

test('zero-HP unconscious current actor can resolve a death save and end the turn', () => {
  const { state, combat } = activeUnconsciousTurn();

  const deathSave = solo.resolveDeathSave(state, {
    combatId: combat.id, combatantId: 'hero-c', idempotencyKey: 'allowed-death-save'
  }, () => 0.5);
  assert.equal(deathSave.natural, 11);
  assert.equal(deathSave.deathSaves.successes, 1);
  assert.equal(deathSave.currentHp, 0);

  const ended = solo.endTurn(state, {
    combatId: combat.id, actorId: 'hero-c', idempotencyKey: 'allowed-unconscious-end-turn'
  });
  assert.equal(ended.currentActorId, 'enemy-c');

  const live = state.runtimeCombats.find((item) => item.id === combat.id);
  assert.equal(live.log.filter((item) => item.idempotencyKey === 'allowed-death-save').length, 1);
  assert.equal(live.log.filter((item) => item.idempotencyKey === 'allowed-unconscious-end-turn').length, 1);
  assert.equal(solo.activeCombatant(state, combat.id).id, 'enemy-c');
});
