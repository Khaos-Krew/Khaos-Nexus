'use strict';

const core = require('./dnd-combat-core.cjs');
const adventure = require('./dnd-solo-adventure.cjs');
const actions = require('./dnd-combat-actions.cjs');
const turns = require('./dnd-combat-turns.cjs');

const CONDITIONS = Object.freeze(['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious']);

module.exports = {
  ACTIONS: actions.ACTIONS,
  CONDITIONS,
  ensureSoloCombatState: core.ensureSoloCombatState,
  startSoloAdventure: adventure.startSoloAdventure,
  recordMemory: adventure.recordMemory,
  startCombat: core.startCombat,
  resolveAttack: actions.resolveAttack,
  useCombatAction: actions.useCombatAction,
  castSpell: actions.castSpell,
  endTurn: turns.endTurn,
  resolveDeathSave: turns.resolveDeathSave,
  endCombat: turns.endCombat,
  activeCombatant: (state, combatId) => core.runtime.clone(core.activeCombatant(core.combatById(state, combatId)) || null)
};
