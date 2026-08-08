'use strict';

const core = require('./dnd-combat-core.cjs');
const { runtime } = core;

function endTurn(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  const key = runtime.clean(input.idempotencyKey, 160) || runtime.makeId('end_turn');
  const duplicate = combat?.log.find((item) => item.idempotencyKey === key);
  if (duplicate) return runtime.clone(duplicate.payload);
  const actor = core.assertActiveActor(combat, input.actorId);
  actor.conditions = actor.conditions.filter((item) => !['dodging', 'disengaging'].includes(item));
  const eligible = combat.combatants.filter((item) => !item.defeated && !item.deathSaves.dead);
  if (eligible.length === 0) {
    combat.status = 'completed';
    combat.endedAt = runtime.nowIso();
    return { combatId: combat.id, actorId: actor.id, round: combat.round, currentActorId: '' };
  }
  let nextIndex = combat.currentIndex;
  let loops = 0;
  do {
    nextIndex = (nextIndex + 1) % combat.turnOrder.length;
    if (nextIndex === 0) combat.round += 1;
    loops += 1;
  } while (loops <= combat.turnOrder.length && (() => {
    const candidate = core.combatantById(combat, combat.turnOrder[nextIndex]);
    return !candidate || candidate.defeated || candidate.deathSaves.dead;
  })());
  combat.currentIndex = nextIndex;
  combat.turnNumber += 1;
  const next = core.activeCombatant(combat);
  if (next) {
    const movement = core.cleanNumber(next.resources?.baseMovement ?? 30, 30, 0, 500);
    next.resources = { action: true, bonusAction: true, reaction: true, movement, baseMovement: movement };
  }
  const result = { combatId: combat.id, actorId: actor.id, round: combat.round, currentActorId: next?.id || '' };
  core.appendCombatLog(combat, { idempotencyKey: key, type: 'turn-ended', payload: result });
  return result;
}

function resolveDeathSave(state, input = {}, rng = Math.random) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  const key = runtime.clean(input.idempotencyKey, 160) || runtime.makeId('death_save');
  const duplicate = combat?.log.find((item) => item.idempotencyKey === key);
  if (duplicate) return runtime.clone(duplicate.payload);
  const actor = core.assertActiveActor(combat, input.combatantId);
  if (!actor.characterId || actor.currentHp > 0 || actor.deathSaves.stable || actor.deathSaves.dead) runtime.fail('This combatant is not eligible for a death save.', 'DND_COMBAT_DEATH_SAVE_INVALID');
  const natural = core.rollDie(20, rng);
  if (natural === 20) {
    actor.currentHp = 1;
    actor.deathSaves = { successes: 0, failures: 0, stable: false, dead: false };
    actor.conditions = actor.conditions.filter((item) => item !== 'unconscious');
    core.syncCharacterHp(state, combat, actor, `${key}:revive`);
  } else if (natural === 1) actor.deathSaves.failures += 2;
  else if (natural >= 10) actor.deathSaves.successes += 1;
  else actor.deathSaves.failures += 1;
  if (actor.deathSaves.successes >= 3) actor.deathSaves.stable = true;
  if (actor.deathSaves.failures >= 3) actor.deathSaves.dead = true;
  actor.resources.action = false;
  const result = { combatantId: actor.id, natural, deathSaves: runtime.clone(actor.deathSaves), currentHp: actor.currentHp };
  core.appendCombatLog(combat, { idempotencyKey: key, type: 'death-save', payload: result });
  return result;
}

function endCombat(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  if (!combat || combat.status !== 'active') runtime.fail('Active combat not found.', 'DND_COMBAT_NOT_ACTIVE');
  combat.status = 'completed';
  combat.outcome = runtime.clean(input.outcome || 'resolved', 200);
  combat.endedAt = runtime.nowIso();
  combat.updatedAt = runtime.nowIso();
  const checkpoint = runtime.createCheckpoint(state, {
    campaignId: combat.campaignId, runId: combat.runId,
    label: input.checkpointLabel || `After combat ${combat.id}`, createdBy: input.actorId || 'owner'
  });
  return { combat: runtime.clone(combat), checkpoint };
}

module.exports = { endTurn, resolveDeathSave, endCombat };
