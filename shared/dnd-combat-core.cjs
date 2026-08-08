'use strict';

const runtime = require('./dnd-campaign-runtime.cjs');

function ensureSoloCombatState(state = {}) {
  runtime.ensureCampaignRuntimeState(state);
  if (!Array.isArray(state.soloAdventures)) state.soloAdventures = [];
  if (!Array.isArray(state.runtimeCombats)) state.runtimeCombats = [];
  if (!Array.isArray(state.runtimeMemories)) state.runtimeMemories = [];
  return state;
}

const cleanNumber = (value, fallback = 0, minimum = -999, maximum = 999) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};
const rollDie = (sides, rng = Math.random) => Math.floor(Math.max(0, Math.min(0.999999999, Number(rng()))) * sides) + 1;
const combatById = (state, combatId) => state.runtimeCombats.find((item) => item.id === combatId);
const combatantById = (combat, combatantId) => combat?.combatants?.find((item) => item.id === combatantId);
const activeCombatant = (combat) => combatantById(combat, combat.turnOrder[combat.currentIndex]);

function normalizeCombatant(state, campaignId, input = {}, rng = Math.random) {
  const characterId = runtime.clean(input.characterId, 100);
  const character = characterId ? (state.characters || []).find((item) => item.id === characterId && item.campaignId === campaignId) : null;
  const maxHp = cleanNumber(input.maxHp ?? character?.maxHp ?? input.hp ?? character?.hp ?? 1, 1, 1, 100000);
  const currentHp = cleanNumber(input.currentHp ?? input.hp ?? character?.hp ?? maxHp, maxHp, 0, maxHp);
  const initiativeModifier = cleanNumber(input.initiativeModifier ?? character?.initiativeModifier ?? 0, 0, -30, 30);
  const initiativeRoll = cleanNumber(input.initiativeRoll, 0, 0, 100) || rollDie(20, rng);
  const speed = cleanNumber(input.speed ?? 30, 30, 0, 500);
  return {
    id: runtime.clean(input.id, 100) || runtime.makeId('combatant'), characterId,
    npcId: runtime.clean(input.npcId, 100), seatId: runtime.clean(input.seatId, 100),
    actorType: ['player', 'companion', 'enemy', 'npc'].includes(input.actorType) ? input.actorType : (character ? 'player' : 'enemy'),
    name: runtime.clean(input.name || character?.name || 'Combatant', 160), currentHp, maxHp,
    armorClass: cleanNumber(input.armorClass ?? character?.armorClass ?? 10, 10, 0, 100),
    initiativeModifier, initiativeRoll, initiative: initiativeRoll + initiativeModifier,
    savingThrows: runtime.clone(input.savingThrows || {}), spellSlots: runtime.clone(input.spellSlots || {}),
    conditions: [...new Set((input.conditions || character?.conditions || []).map((item) => runtime.clean(item, 80)).filter(Boolean))],
    concentration: input.concentration ? runtime.clean(input.concentration, 200) : '',
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    defeated: currentHp <= 0 && !character,
    resources: { action: true, bonusAction: true, reaction: true, movement: speed, baseMovement: speed },
    createdAt: runtime.nowIso(), updatedAt: runtime.nowIso()
  };
}

function startCombat(state, input = {}, rng = Math.random) {
  ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const campaignId = runtime.clean(input.campaignId, 100);
  const run = state.campaignRuns.find((item) => item.id === input.runId && item.campaignId === campaignId && item.status === 'active');
  const scene = state.scenes.find((item) => item.id === input.sceneId && item.campaignId === campaignId && item.status === 'active');
  if (!run || !scene || scene.runId !== run.id) runtime.fail('An active run and scene are required to start combat.', 'DND_COMBAT_SCENE_REQUIRED');
  const clientCombatId = runtime.clean(input.clientCombatId, 120);
  if (clientCombatId) {
    const duplicate = state.runtimeCombats.find((item) => item.campaignId === campaignId && item.clientCombatId === clientCombatId);
    if (duplicate) return { combat: runtime.clone(duplicate), duplicate: true };
  }
  if (state.runtimeCombats.some((item) => item.runId === run.id && item.status === 'active')) runtime.fail('An active combat already exists for this campaign run.', 'DND_COMBAT_ALREADY_ACTIVE');
  const combatants = (input.combatants || []).map((item) => normalizeCombatant(state, campaignId, item, rng));
  if (combatants.length < 2) runtime.fail('Combat requires at least two combatants.', 'DND_COMBAT_PARTICIPANTS_REQUIRED');
  if (new Set(combatants.map((item) => item.id)).size !== combatants.length) runtime.fail('Combatant IDs must be unique.', 'DND_COMBAT_DUPLICATE_COMBATANT');
  const turnOrder = [...combatants].sort((a, b) => b.initiative - a.initiative || b.initiativeModifier - a.initiativeModifier || a.id.localeCompare(b.id)).map((item) => item.id);
  const combat = {
    id: runtime.makeId('combat'), clientCombatId, campaignId, runId: run.id, sceneId: scene.id,
    encounterId: runtime.clean(input.encounterId, 100), status: 'active', round: 1, currentIndex: 0,
    turnNumber: 1, turnOrder, combatants, log: [], startedBy: runtime.clean(input.actorId, 100),
    startedAt: runtime.nowIso(), updatedAt: runtime.nowIso(), endedAt: ''
  };
  state.runtimeCombats.push(combat);
  return { combat: runtime.clone(combat), duplicate: false };
}

function assertActiveActor(combat, actorId) {
  if (!combat || combat.status !== 'active') runtime.fail('Active combat not found.', 'DND_COMBAT_NOT_ACTIVE');
  const actor = combatantById(combat, actorId);
  if (!actor || actor.id !== activeCombatant(combat)?.id) runtime.fail('It is not this combatant’s turn.', 'DND_COMBAT_NOT_ACTOR_TURN');
  if (actor.defeated || actor.deathSaves.dead) runtime.fail('This combatant cannot act.', 'DND_COMBAT_ACTOR_DEFEATED');
  return actor;
}

function appendCombatLog(combat, input = {}) {
  const idempotencyKey = runtime.clean(input.idempotencyKey, 160);
  if (idempotencyKey) {
    const existing = combat.log.find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) return { entry: existing, duplicate: true };
  }
  const entry = { id: runtime.makeId('combat_log'), idempotencyKey, type: runtime.clean(input.type, 100), payload: runtime.clone(input.payload || {}), createdAt: runtime.nowIso() };
  combat.log.push(entry);
  combat.updatedAt = runtime.nowIso();
  return { entry, duplicate: false };
}

function syncCharacterHp(state, combat, target, key) {
  if (!target.characterId) return null;
  return runtime.appendStateEvent(state, {
    campaignId: combat.campaignId, runId: combat.runId, sceneId: combat.sceneId,
    type: 'character.hp.changed', actorType: 'rules_engine', actorId: 'combat',
    idempotencyKey: key, payload: { characterId: target.characterId, value: target.currentHp }
  });
}

module.exports = {
  runtime, ensureSoloCombatState, cleanNumber, rollDie, combatById, combatantById,
  activeCombatant, startCombat, assertActiveActor, appendCombatLog, syncCharacterHp
};
