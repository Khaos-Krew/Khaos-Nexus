'use strict';

const core = require('./dnd-combat-core.cjs');
const { runtime } = core;

const ACTIONS = Object.freeze(['attack', 'cast_spell', 'dash', 'disengage', 'dodge', 'help', 'use_item']);

function resolveAttack(state, input = {}, rng = Math.random) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  const key = runtime.clean(input.idempotencyKey, 160) || runtime.makeId('attack');
  const duplicate = combat?.log.find((item) => item.idempotencyKey === key);
  if (duplicate) return { result: runtime.clone(duplicate.payload), duplicate: true };
  const actor = core.assertActiveActor(combat, input.actorId);
  const target = core.combatantById(combat, input.targetId);
  if (!target || target.defeated || target.deathSaves.dead) runtime.fail('Choose an active target.', 'DND_COMBAT_TARGET_INVALID');
  const actionResource = input.actionResource === 'bonusAction' ? 'bonusAction' : 'action';
  if (!actor.resources[actionResource]) runtime.fail(`The combatant has already used its ${actionResource}.`, 'DND_COMBAT_ACTION_SPENT');
  const hasDisadvantage = input.disadvantage === true || target.conditions.includes('dodging');
  const cancelAdvantage = input.advantage === true && hasDisadvantage;
  const attack = runtime.resolveAbilityCheck({
    modifier: core.cleanNumber(input.attackModifier, 0, -50, 100), dc: target.armorClass,
    advantage: input.advantage === true && !cancelAdvantage,
    disadvantage: hasDisadvantage && !cancelAdvantage
  }, rng);
  attack.success = attack.critical || (!attack.fumble && attack.total >= attack.dc);
  let damage = { dice: [], modifier: 0, total: 0, damageType: runtime.clean(input.damageType, 80) };
  let concentration = null;
  if (attack.success) {
    const count = Math.max(1, core.cleanNumber(input.damageDiceCount, 1, 1, 20)) * (attack.critical ? 2 : 1);
    damage = runtime.resolveDamage({
      count, sides: core.cleanNumber(input.damageDiceSides, 6, 2, 100),
      modifier: core.cleanNumber(input.damageModifier, 0, -100, 100), damageType: input.damageType
    }, rng);
    target.currentHp = Math.max(0, target.currentHp - damage.total);
    target.updatedAt = runtime.nowIso();
    core.syncCharacterHp(state, combat, target, `${key}:hp`);
    if (target.concentration && damage.total > 0) {
      const dc = Math.max(10, Math.floor(damage.total / 2));
      const save = runtime.resolveAbilityCheck({ modifier: core.cleanNumber(target.savingThrows?.constitution, 0, -30, 50), dc }, rng);
      concentration = { spell: target.concentration, dc, save, maintained: save.success };
      if (!save.success) target.concentration = '';
    }
    if (target.currentHp === 0) {
      if (target.characterId) {
        if (!target.conditions.includes('unconscious')) target.conditions.push('unconscious');
        runtime.appendStateEvent(state, {
          campaignId: combat.campaignId, runId: combat.runId, sceneId: combat.sceneId,
          type: 'character.condition.applied', actorType: 'rules_engine', actorId: 'combat',
          idempotencyKey: `${key}:unconscious`, payload: { characterId: target.characterId, condition: 'unconscious' }
        });
      } else target.defeated = true;
    }
  }
  actor.resources[actionResource] = false;
  actor.updatedAt = runtime.nowIso();
  const result = { actorId: actor.id, targetId: target.id, attack, damage, concentration, targetHp: target.currentHp, targetDefeated: target.defeated };
  core.appendCombatLog(combat, { idempotencyKey: key, type: 'attack', payload: result });
  return { result: runtime.clone(result), duplicate: false };
}

function useCombatAction(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  const key = runtime.clean(input.idempotencyKey, 160) || runtime.makeId('action');
  const duplicate = combat?.log.find((item) => item.idempotencyKey === key);
  if (duplicate) return runtime.clone(duplicate.payload);
  const actor = core.assertActiveActor(combat, input.actorId);
  const action = ACTIONS.includes(input.action) ? input.action : '';
  if (!action || action === 'attack' || action === 'cast_spell') runtime.fail('Use the dedicated attack or spell resolver for this action.', 'DND_COMBAT_ACTION_INVALID');
  if (!actor.resources.action) runtime.fail('The combatant has already used its action.', 'DND_COMBAT_ACTION_SPENT');
  actor.resources.action = false;
  if (action === 'dash') actor.resources.movement *= 2;
  if (action === 'dodge' && !actor.conditions.includes('dodging')) actor.conditions.push('dodging');
  if (action === 'disengage' && !actor.conditions.includes('disengaging')) actor.conditions.push('disengaging');
  actor.updatedAt = runtime.nowIso();
  const result = { actorId: actor.id, action, targetId: runtime.clean(input.targetId, 100) };
  core.appendCombatLog(combat, { idempotencyKey: key, type: 'action', payload: result });
  return runtime.clone(result);
}

function castSpell(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const combat = core.combatById(state, input.combatId);
  const key = runtime.clean(input.idempotencyKey, 160) || runtime.makeId('spell');
  const duplicate = combat?.log.find((item) => item.idempotencyKey === key);
  if (duplicate) return runtime.clone(duplicate.payload);
  const actor = core.assertActiveActor(combat, input.actorId);
  const actionResource = input.actionResource === 'bonusAction' ? 'bonusAction' : 'action';
  if (!actor.resources[actionResource]) runtime.fail(`The combatant has already used its ${actionResource}.`, 'DND_COMBAT_ACTION_SPENT');
  const level = core.cleanNumber(input.level, 0, 0, 9);
  if (level > 0) {
    const remaining = core.cleanNumber(actor.spellSlots[level] ?? actor.spellSlots[String(level)], 0, 0, 99);
    if (remaining < 1) runtime.fail(`No level ${level} spell slots remain.`, 'DND_COMBAT_NO_SPELL_SLOT');
    actor.spellSlots[level] = remaining - 1;
    if (actor.characterId) {
      runtime.appendStateEvent(state, {
        campaignId: combat.campaignId, runId: combat.runId, sceneId: combat.sceneId,
        type: 'character.spell_slots.changed', actorType: 'rules_engine', actorId: 'combat',
        idempotencyKey: `${key}:slot:${level}`,
        payload: { characterId: actor.characterId, level, value: actor.spellSlots[level] }
      });
    }
  }
  actor.resources[actionResource] = false;
  if (input.concentration === true) actor.concentration = runtime.clean(input.spellName, 200);
  const result = {
    actorId: actor.id, spellName: runtime.clean(input.spellName, 200), level,
    concentration: actor.concentration,
    targetIds: (input.targetIds || []).map((item) => runtime.clean(item, 100)).filter(Boolean)
  };
  core.appendCombatLog(combat, { idempotencyKey: key, type: 'spell', payload: result });
  return runtime.clone(result);
}

module.exports = { ACTIONS, resolveAttack, useCombatAction, castSpell };