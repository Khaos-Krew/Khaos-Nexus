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

function activeSessionForCampaign(state, campaignId) {
  return (state.sessions || []).find((session) => session && session.campaignId === campaignId && session.status === 'active') || null;
}

function activeEncounterForCampaign(state, campaignId) {
  const active = (state.encounters || []).filter((encounter) => encounter && encounter.campaignId === campaignId && encounter.active !== false && encounter.status === 'active');
  if (!active.length) return null;
  return active.find((encounter) => encounter.currentCombatantId) || active[0];
}

function liveTurnProjection(state, campaignId) {
  const encounter = activeEncounterForCampaign(state, campaignId);
  const session = activeSessionForCampaign(state, campaignId);
  if (!encounter && !session) return null;

  return {
    session: session ? {
      id: session.id || '',
      title: session.title || '',
      status: session.status || 'active',
      startsAt: session.startsAt || ''
    } : null,
    encounter: encounter ? {
      id: encounter.id || '',
      name: encounter.name || encounter.title || '',
      status: encounter.status || 'active',
      round: Math.max(1, integer(encounter.round, 1)),
      currentTurnIndex: Math.max(0, integer(encounter.currentTurnIndex ?? encounter.turnIndex, 0)),
      currentCombatantId: String(encounter.currentCombatantId || '')
    } : null
  };
}

function appendLiveTurnContext(contextInput, state, campaignId) {
  const context = contextInput && typeof contextInput === 'object' ? contextInput : {};
  const live = liveTurnProjection(state, campaignId);
  if (!live) return context;

  const text = `Authoritative live session / encounter state:\n${JSON.stringify(live, null, 2)}`;
  const existingText = String(context.text || '');
  const characterLimit = Math.max(0, integer(context.characterLimit, 0));
  const separator = existingText ? '\n\n' : '';
  const available = characterLimit > 0 ? Math.max(0, characterLimit - existingText.length - separator.length) : text.length;
  const includedText = text.slice(0, available);

  context.liveState = clone(live);
  if (!Array.isArray(context.sections)) context.sections = [];
  context.sections.push({
    id: 'live-state',
    label: 'Authoritative live session / encounter state',
    reason: includedText.length < text.length ? 'truncated by context character limit' : 'included',
    count: (live.session ? 1 : 0) + (live.encounter ? 1 : 0),
    characters: text.length,
    includedCharacters: includedText.length
  });
  if (includedText) context.text = `${existingText}${separator}${includedText}`;
  context.characters = String(context.text || '').length;
  context.preview = String(context.text || '').slice(0, 8000);
  return context;
}

function install() {
  if (installed) return;
  installed = true;

  const target = require('./dnd-co-dm.cjs');
  if (!target || target.__khaosVeyraLiveStateAuthority) return;
  const originalBuildCampaignContext = target.buildCampaignContext;
  const originalBuildReadiness = target.buildReadiness;

  if (typeof originalBuildCampaignContext === 'function') {
    target.buildCampaignContext = function buildCampaignContextWithLiveAuthority(state, campaignId, ...args) {
      const normalized = normalizeVeyraLiveState(state);
      const context = originalBuildCampaignContext(normalized, campaignId, ...args);
      return appendLiveTurnContext(context, normalized, campaignId);
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
  normalizeVeyraLiveState,
  activeSessionForCampaign,
  activeEncounterForCampaign,
  liveTurnProjection,
  appendLiveTurnContext
};
