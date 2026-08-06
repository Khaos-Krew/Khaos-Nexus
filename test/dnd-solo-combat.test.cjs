'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const solo = require('../shared/dnd-solo-combat.cjs');

function baseState(mode = 'solo_ai_dm') {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [
      { id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true, hp: 20, maxHp: 20, armorClass: 16, initiativeModifier: 2, conditions: [], savingThrows: { constitution: 3 }, spellSlots: { 1: 2 } },
      { id: 'companion', campaignId: 'campaign-1', name: 'Ember', active: true, hp: 14, maxHp: 14, armorClass: 14, initiativeModifier: 1, conditions: [] }
    ],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
  solo.ensureSoloCombatState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, { campaignId: 'campaign-1', enabled: true, mode, pace: 'live', automationLevel: 'automatic_combat' });
  return state;
}

function combatState(rngValues = [0.6, 0.2]) {
  const state = baseState();
  const start = solo.startSoloAdventure(state, { campaignId: 'campaign-1', characterId: 'hero', actorId: 'owner', locationName: 'Forge Gate', publicDescription: 'Ash falls.' });
  const values = [...rngValues];
  const result = solo.startCombat(state, {
    campaignId: 'campaign-1', runId: start.run.id, sceneId: start.scene.id, actorId: 'owner', clientCombatId: 'combat-1',
    combatants: [
      { id: 'hero-c', characterId: 'hero', seatId: start.adventure.playerSeatId, actorType: 'player', name: 'Vorkesh', hp: 20, maxHp: 20, armorClass: 16, initiativeModifier: 2, savingThrows: { constitution: 3 } },
      { id: 'enemy-c', actorType: 'enemy', name: 'Ash Wraith', hp: 12, maxHp: 12, armorClass: 12, initiativeModifier: 0 }
    ]
  }, () => values.shift() ?? 0.5);
  return { state, adventure: start, combat: result.combat };
}

test('solo quick start creates player seat, run, scene, and checkpoint', () => {
  const state = baseState();
  const result = solo.startSoloAdventure(state, {
    campaignId: 'campaign-1', characterId: 'hero', actorId: 'owner',
    locationName: 'Forge Gate', publicDescription: 'Ash falls.',
    companions: [{ characterId: 'companion', displayName: 'Ember', policy: { autonomy: 'tactical_orders', protectPlayer: true } }]
  });
  assert.equal(result.adventure.status, 'active');
  assert.equal(result.scene.locationName, 'Forge Gate');
  assert.equal(result.scene.participantSeatIds.length, 2);
  assert.equal(result.checkpoint.label, 'Solo adventure start');
  assert.equal(state.runtimeGate.releaseAuthorized, false);
});

test('combat start rolls initiative deterministically and prevents duplicates', () => {
  const { state, adventure, combat } = combatState([0.9, 0.1]);
  assert.deepEqual(combat.turnOrder, ['hero-c', 'enemy-c']);
  assert.equal(combat.round, 1);
  const duplicate = solo.startCombat(state, {
    campaignId: 'campaign-1', runId: adventure.run.id, sceneId: adventure.scene.id, clientCombatId: 'combat-1', combatants: []
  });
  assert.equal(duplicate.duplicate, true);
});

test('attack resolution applies character HP event and is idempotent', () => {
  const { state, combat } = combatState([0.9, 0.1]);
  const enemy = state.runtimeCombats[0].combatants.find((item) => item.id === 'enemy-c');
  const first = solo.resolveAttack(state, {
    combatId: combat.id, actorId: 'hero-c', targetId: 'enemy-c', attackModifier: 5,
    damageDiceCount: 1, damageDiceSides: 8, damageModifier: 3, damageType: 'slashing', idempotencyKey: 'attack-1'
  }, (() => { const values = [0.7, 0.5]; return () => values.shift(); })());
  const duplicate = solo.resolveAttack(state, {
    combatId: combat.id, actorId: 'hero-c', targetId: 'enemy-c', attackModifier: 5,
    damageDiceCount: 1, damageDiceSides: 8, damageModifier: 3, idempotencyKey: 'attack-1'
  }, () => 0.99);
  assert.equal(first.result.attack.success, true);
  assert.equal(first.result.damage.total, 8);
  assert.equal(enemy.currentHp, 4);
  assert.equal(duplicate.duplicate, true);
  assert.equal(enemy.currentHp, 4);
});

test('natural one always misses and natural twenty always hits', () => {
  const missState = combatState([0.9, 0.1]);
  const miss = solo.resolveAttack(missState.state, { combatId: missState.combat.id, actorId: 'hero-c', targetId: 'enemy-c', attackModifier: 100, damageDiceCount: 1, damageDiceSides: 6, idempotencyKey: 'nat-1' }, () => 0);
  assert.equal(miss.result.attack.fumble, true);
  assert.equal(miss.result.attack.success, false);

  const hitState = combatState([0.9, 0.1]);
  hitState.state.runtimeCombats[0].combatants.find((item) => item.id === 'enemy-c').armorClass = 99;
  const values = [0.999, 0.4, 0.4];
  const hit = solo.resolveAttack(hitState.state, { combatId: hitState.combat.id, actorId: 'hero-c', targetId: 'enemy-c', attackModifier: -20, damageDiceCount: 1, damageDiceSides: 6, idempotencyKey: 'nat-20' }, () => values.shift());
  assert.equal(hit.result.attack.critical, true);
  assert.equal(hit.result.attack.success, true);
  assert.equal(hit.result.damage.dice.length, 2);
});

test('action economy and turn ownership are enforced', () => {
  const { state, combat } = combatState([0.9, 0.1]);
  assert.throws(() => solo.useCombatAction(state, { combatId: combat.id, actorId: 'enemy-c', action: 'dodge' }), /not this combatant/);
  solo.useCombatAction(state, { combatId: combat.id, actorId: 'hero-c', action: 'dodge', idempotencyKey: 'dodge-1' });
  assert.throws(() => solo.useCombatAction(state, { combatId: combat.id, actorId: 'hero-c', action: 'dash', idempotencyKey: 'dash-1' }), /already used/);
  const turn = solo.endTurn(state, { combatId: combat.id, actorId: 'hero-c', idempotencyKey: 'end-1' });
  assert.equal(turn.currentActorId, 'enemy-c');
  const duplicate = solo.endTurn(state, { combatId: combat.id, actorId: 'hero-c', idempotencyKey: 'end-1' });
  assert.equal(duplicate.currentActorId, 'enemy-c');
});

test('damage can break concentration with a deterministic save', () => {
  const { state, combat } = combatState([0.1, 0.9]);
  const enemy = state.runtimeCombats[0].combatants.find((item) => item.id === 'enemy-c');
  const hero = state.runtimeCombats[0].combatants.find((item) => item.id === 'hero-c');
  enemy.initiative = 30;
  hero.initiative = 1;
  state.runtimeCombats[0].turnOrder = ['enemy-c', 'hero-c'];
  hero.concentration = 'Faerie Fire';
  const values = [0.7, 0.9, 0.1];
  const result = solo.resolveAttack(state, { combatId: combat.id, actorId: 'enemy-c', targetId: 'hero-c', attackModifier: 5, damageDiceCount: 1, damageDiceSides: 12, damageModifier: 0, idempotencyKey: 'concentration' }, () => values.shift());
  assert.equal(result.result.damage.total, 11);
  assert.equal(result.result.concentration.dc, 10);
  assert.equal(result.result.concentration.maintained, false);
  assert.equal(hero.concentration, '');
});

test('death saves are deterministic and duplicate-safe', () => {
  const { state, combat } = combatState([0.9, 0.1]);
  const hero = state.runtimeCombats[0].combatants.find((item) => item.id === 'hero-c');
  hero.currentHp = 0;
  hero.conditions.push('unconscious');
  const first = solo.resolveDeathSave(state, { combatId: combat.id, combatantId: 'hero-c', idempotencyKey: 'save-1' }, () => 0.5);
  const duplicate = solo.resolveDeathSave(state, { combatId: combat.id, combatantId: 'hero-c', idempotencyKey: 'save-1' }, () => 0);
  assert.equal(first.deathSaves.successes, 1);
  assert.equal(duplicate.deathSaves.successes, 1);
});

test('ending combat creates a checkpoint that includes combat state', () => {
  const { state, combat } = combatState([0.9, 0.1]);
  const ended = solo.endCombat(state, { combatId: combat.id, actorId: 'owner', outcome: 'victory' });
  assert.equal(ended.combat.status, 'completed');
  assert.equal(ended.checkpoint.snapshot.runtimeCombats.length, 1);
  assert.equal(ended.checkpoint.snapshot.runtimeCombats[0].outcome, 'victory');
});

test('memory ledger preserves explicit audience and correction status', () => {
  const state = baseState();
  const memory = solo.recordMemory(state, { campaignId: 'campaign-1', text: 'The duke is a vampire.', visibility: 'selected_characters', characterIds: ['hero'], status: 'correct' });
  const corrected = solo.recordMemory(state, { id: memory.id, campaignId: 'campaign-1', text: 'The duke is not a vampire.', visibility: 'selected_characters', characterIds: ['hero'], status: 'incorrect' });
  assert.equal(state.runtimeMemories.length, 1);
  assert.equal(corrected.status, 'incorrect');
});
