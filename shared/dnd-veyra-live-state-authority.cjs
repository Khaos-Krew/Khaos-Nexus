'use strict';

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeVeyraLiveState(stateInput = {}) {
  const state = clone(stateInput || {});
  if (!Array.isArray(state.encounters)) state.encounters = [];

  for (const encounter of state.encounters) {
    if (!encounter || typeof encounter !== 'object') continue;

    // Veyra/Co-DM historically consumed `turnIndex`, while the durable runtime
    // stores `currentTurnIndex`. Live runtime state must win over stale legacy
    // projection data whenever both are present.
    if (encounter.currentTurnIndex !== undefined && encounter.currentTurnIndex !== null) {
      encounter.turnIndex = Math.max(0, integer(encounter.currentTurnIndex, 0));
    } else if (encounter.turnIndex !== undefined && encounter.turnIndex !== null) {
      encounter.currentTurnIndex = Math.max(0, integer(encounter.turnIndex, 0));
      encounter.turnIndex = encounter.currentTurnIndex;
    }
  }

  return state;
}

function install() {
  if (installed) return;
  installed = true;

  const target = require('./dnd-co-dm.cjs');
  if (!target || target.__khaosVeyraLiveStateAuthority) return;
  const originalBuildCampaignContext = target.buildCampaignContext;
  const originalBuildReadiness = target.buildReadiness;

  if (typeof originalBuildCampaignContext === 'function') {
    target.buildCampaignContext = function buildCampaignContextWithLiveAuthority(state, ...args) {
      return originalBuildCampaignContext(normalizeVeyraLiveState(state), ...args);
    };
  }

  if (typeof originalBuildReadiness === 'function') {
    target.buildReadiness = function buildReadinessWithLiveAuthority(state, ...args) {
      return originalBuildReadiness(normalizeVeyraLiveState(state), ...args);
    };
  }

  Object.defineProperty(target, '__khaosVeyraLiveStateAuthority', { value: true });
}

module.exports = {
  install,
  normalizeVeyraLiveState
};
