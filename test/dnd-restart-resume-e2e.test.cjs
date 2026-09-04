'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const solo = require('../shared/dnd-solo-combat.cjs');

function sequenceRng(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function createActiveState() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [{
      id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true,
      hp: 20, maxHp: 20, armorClass: 16, initiativeModifier: 2,
      conditions: [], spellSlots: { 1: 2 }, savingThrows: { constitution: 4 }
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
    locationName: 'Forge Gate', publicDescription: 'Ash falls over the road.'
  });

  const combat = solo.startCombat(state, {
    campaignId: 'campaign-1', runId: adventure.run.id, sceneId: adventure.scene.id,
    actorId: 'owner', clientCombatId: 'restart-resume-combat',
    combatants: [
      { id: 'hero-c', characterId: 'hero', actorType: 'player', name: 'Vorkesh', initiativeRoll: 20 },
      { id: 'enemy-c', actorType: 'enemy', name: 'Ash Wraith', hp: 12, maxHp: 12, initiativeRoll: 1 }
    ]
  }, () => 0.5).combat;

  return { state, adventure, combat };
}

test('active campaign, scene, combat turn identity, HP, and spell resources survive restart together', () => {
  const { state, adventure, combat } = createActiveState();

  const cast = solo.castSpell(state, {
    combatId: combat.id, actorId: 'hero-c', spellName: 'Ember Ward', level: 1,
    idempotencyKey: 'e2e-cast'
  });
  assert.equal(cast.level, 1);

  solo.endTurn(state, {
    combatId: combat.id, actorId: 'hero-c', idempotencyKey: 'e2e-hero-end-turn'
  });

  const attack = solo.resolveAttack(state, {
    combatId: combat.id, actorId: 'enemy-c', targetId: 'hero-c', attackModifier: 5,
    damageDiceCount: 1, damageDiceSides: 6, idempotencyKey: 'e2e-enemy-attack'
  }, sequenceRng([0.7, 0.5]));
  assert.equal(attack.result.hit, true);

  const beforeRestartCombat = state.runtimeCombats.find((item) => item.id === combat.id);
  const beforeRestartHero = state.characters.find((item) => item.id === 'hero');
  const beforeRestartHeroCombatant = beforeRestartCombat.combatants.find((item) => item.id === 'hero-c');
  const beforeRestartRun = state.campaignRuns.find((item) => item.id === adventure.run.id);

  assert.equal(beforeRestartRun.currentSceneId, adventure.scene.id);
  assert.equal(solo.activeCombatant(state, combat.id).id, 'enemy-c');
  assert.equal(beforeRestartHero.spellSlots[1], 1);
  assert.equal(beforeRestartHeroCombatant.spellSlots[1], 1);
  assert.equal(beforeRestartHero.hp, beforeRestartHeroCombatant.currentHp);

  const persisted = JSON.stringify(state);
  const reloaded = JSON.parse(persisted);
  runtime.ensureCampaignRuntimeState(reloaded);
  solo.ensureSoloCombatState(reloaded);

  const restoredRun = reloaded.campaignRuns.find((item) => item.id === adventure.run.id);
  const restoredScene = reloaded.scenes.find((item) => item.id === adventure.scene.id);
  const restoredCombat = reloaded.runtimeCombats.find((item) => item.id === combat.id);
  const restoredHero = reloaded.characters.find((item) => item.id === 'hero');
  const restoredHeroCombatant = restoredCombat.combatants.find((item) => item.id === 'hero-c');

  assert.equal(restoredRun.status, 'active');
  assert.equal(restoredRun.currentSceneId, restoredScene.id);
  assert.equal(restoredScene.status, 'active');
  assert.equal(restoredCombat.status, 'active');
  assert.equal(solo.activeCombatant(reloaded, combat.id).id, 'enemy-c');
  assert.equal(restoredHero.spellSlots[1], 1);
  assert.equal(restoredHeroCombatant.spellSlots[1], 1);
  assert.equal(restoredHero.hp, restoredHeroCombatant.currentHp);
  assert.equal(reloaded.stateEvents.filter((item) => item.idempotencyKey === 'e2e-cast:slot:1').length, 1);
  assert.equal(reloaded.stateEvents.filter((item) => item.idempotencyKey === 'e2e-enemy-attack:hp').length, 1);

  const duplicateCast = solo.castSpell(reloaded, {
    combatId: combat.id, actorId: 'hero-c', spellName: 'Ember Ward', level: 1,
    idempotencyKey: 'e2e-cast'
  });
  assert.equal(duplicateCast.level, 1);
  assert.equal(restoredHero.spellSlots[1], 1);
  assert.equal(restoredHeroCombatant.spellSlots[1], 1);
  assert.equal(reloaded.stateEvents.filter((item) => item.idempotencyKey === 'e2e-cast:slot:1').length, 1);
});
