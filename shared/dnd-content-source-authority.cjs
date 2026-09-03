'use strict';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function activeSourceIds(state = {}) {
  return new Set((state.sources || [])
    .filter((source) => source && source.id && source.active !== false && source.enabled !== false)
    .map((source) => source.id));
}

function filterCampaignSourceState(stateInput = {}) {
  const state = clone(stateInput) || {};
  const activeIds = activeSourceIds(state);
  if (Array.isArray(state.campaignSources)) {
    state.campaignSources = state.campaignSources.filter((selection) =>
      selection && selection.enabled !== false && activeIds.has(selection.sourceId));
  }
  return state;
}

function install() {
  const target = require('./dnd-co-dm.cjs');
  if (target.__khaosContentSourceAuthorityInstalled) return;

  const originalBuildCampaignContext = target.buildCampaignContext;
  const originalBuildReadiness = target.buildReadiness;

  target.buildCampaignContext = function buildCampaignContextWithSourceAuthority(state, campaignId, ...args) {
    return originalBuildCampaignContext(filterCampaignSourceState(state), campaignId, ...args);
  };

  target.buildReadiness = function buildReadinessWithSourceAuthority(state, campaignId, ...args) {
    return originalBuildReadiness(filterCampaignSourceState(state), campaignId, ...args);
  };

  Object.defineProperty(target, '__khaosContentSourceAuthorityInstalled', { value: true });
}

module.exports = {
  activeSourceIds,
  filterCampaignSourceState,
  install
};
