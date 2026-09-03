'use strict';

const {
  currentInitiativeState,
  advanceInitiativeByIdentity,
  primeEncounterTurn,
  assertSessionStartable,
  assertSessionEndable
} = require('../shared/dnd-runtime-integrity.cjs');

let installed = false;

function activeCombatants(state, encounterId) {
  return (state?.combatants || []).filter((item) => item.encounterId === encounterId && item.active !== false);
}

function alignEncounterPointers(state) {
  if (!state || !Array.isArray(state.encounters)) return state;

  for (const encounter of state.encounters) {
    if (encounter?.status !== 'active') continue;
    const snapshot = currentInitiativeState(encounter, activeCombatants(state, encounter.id));
    encounter.currentTurnIndex = snapshot.currentIndex;
    encounter.currentCombatantId = snapshot.currentCombatantId;
    encounter.round = snapshot.round;
  }
  return state;
}

function patchDiscordCore() {
  const core = require('../shared/dnd-discord.cjs');
  if (core.__khaosDndRuntimeCompletionPatched) return;

  const originalStartSession = core.startSession;
  const originalEndSession = core.endSession;

  core.advanceInitiative = function identityAwareAdvanceInitiative(encounter, combatants) {
    const result = advanceInitiativeByIdentity(encounter, combatants);
    encounter.currentTurnIndex = result.currentTurnIndex;
    encounter.currentCombatantId = result.currentCombatantId;
    encounter.round = result.round;
    return result;
  };

  core.startSession = function guardedStartSession(state, sessionId, options = {}) {
    const session = assertSessionStartable(state, sessionId);
    const result = originalStartSession(state, sessionId, options);
    if (options.resetInitiative) {
      for (const encounter of (state.encounters || []).filter((item) => item.campaignId === session.campaignId && item.status === 'active')) {
        primeEncounterTurn(encounter, activeCombatants(state, encounter.id));
      }
    }
    return result;
  };

  core.endSession = function guardedEndSession(state, sessionId) {
    assertSessionEndable(state, sessionId);
    return originalEndSession(state, sessionId);
  };

  Object.defineProperty(core, '__khaosDndRuntimeCompletionPatched', { value: true });
}

function withAlignedEncounter(state, encounterId, callback) {
  const encounter = (state?.encounters || []).find((item) => item.id === encounterId);
  if (!encounter) return callback();

  const previousIndex = encounter.currentTurnIndex;
  const previousId = encounter.currentCombatantId;
  const previousRound = encounter.round;
  const snapshot = currentInitiativeState(encounter, activeCombatants(state, encounterId));
  encounter.currentTurnIndex = snapshot.currentIndex;
  encounter.currentCombatantId = snapshot.currentCombatantId;
  encounter.round = snapshot.round;

  try {
    return callback();
  } finally {
    encounter.currentTurnIndex = previousIndex;
    encounter.currentCombatantId = previousId;
    encounter.round = previousRound;
  }
}

function patchEncounterPanels() {
  const panels = require('../shared/dnd-encounter-panels.cjs');
  if (panels.__khaosDndRuntimeCompletionPatched) return;

  const originalCurrentEncounterState = panels.currentEncounterState;
  const originalPanelPayload = panels.panelPayload;
  const originalValidateButtonExecution = panels.validateButtonExecution;

  panels.currentEncounterState = function identityAwareEncounterState(state, encounterId) {
    return withAlignedEncounter(state, encounterId, () => originalCurrentEncounterState(state, encounterId));
  };

  panels.panelPayload = function identityAwarePanelPayload(state, panel) {
    return withAlignedEncounter(state, panel?.encounterId, () => originalPanelPayload(state, panel));
  };

  panels.validateButtonExecution = function identityAwareButtonValidation(state, input = {}) {
    const parsed = panels.parseButtonId(input.customId);
    const panel = parsed
      ? (state?.encounterPanels || []).find((item) => item.panelToken === parsed.panelToken && item.status === 'active')
      : null;
    return withAlignedEncounter(state, panel?.encounterId, () => originalValidateButtonExecution(state, input));
  };

  Object.defineProperty(panels, '__khaosDndRuntimeCompletionPatched', { value: true });
}

function patchBotRuntime() {
  const runtimeModule = require('./dnd-runtime.cjs');
  if (runtimeModule.__khaosDndRuntimeCompletionPatched) return;

  const originalHandleDndInteraction = runtimeModule.handleDndInteraction;
  runtimeModule.handleDndInteraction = async function completionAwareDndInteraction(interaction, runtime) {
    const state = runtime?.getBootstrap?.()?.config?.dnd || null;
    alignEncounterPointers(state);
    const result = await originalHandleDndInteraction.call(this, interaction, runtime);
    alignEncounterPointers(state);
    return result;
  };

  Object.defineProperty(runtimeModule, '__khaosDndRuntimeCompletionPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchDiscordCore();
  patchEncounterPanels();
  patchBotRuntime();
}

module.exports = {
  install,
  alignEncounterPointers,
  activeCombatants,
  withAlignedEncounter
};
