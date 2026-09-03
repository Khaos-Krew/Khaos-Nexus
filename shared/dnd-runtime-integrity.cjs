'use strict';

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeDiscordResource(resource = {}) {
  const kind = resource.resourceType === 'voice' || resource.discordResourceKind === 'voice'
    ? 'voice'
    : resource.discordResourceKind || resource.resourceType || 'unknown';
  return {
    ...resource,
    resourceType: kind === 'voice' ? 'channel' : resource.resourceType,
    discordResourceKind: kind
  };
}

function initiativeOrder(combatants = []) {
  return [...(Array.isArray(combatants) ? combatants : [])]
    .filter((item) => item && item.active !== false)
    .sort((a, b) => Number(b.initiative || 0) - Number(a.initiative || 0)
      || Number(b.dexterity || 0) - Number(a.dexterity || 0)
      || String(a.id || '').localeCompare(String(b.id || '')));
}

function clampInitiativeIndex(value, length) {
  if (!length) return 0;
  const numeric = Number(value);
  const index = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  return Math.max(0, Math.min(length - 1, index));
}

function storedInitiativeIndex(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function currentInitiativeState(encounter = {}, combatants = []) {
  const order = initiativeOrder(combatants);
  const round = Math.max(1, Number(encounter.round || 1));
  if (!order.length) {
    return {
      order,
      currentIndex: 0,
      currentCombatant: null,
      currentCombatantId: '',
      round,
      identityMissing: false,
      wrappedFromMissingIdentity: false
    };
  }

  const currentCombatantId = String(encounter.currentCombatantId || '').trim();
  const identityIndex = currentCombatantId
    ? order.findIndex((item) => String(item.id || '') === currentCombatantId)
    : -1;
  const identityMissing = Boolean(currentCombatantId) && identityIndex < 0;
  const storedIndex = storedInitiativeIndex(encounter.currentTurnIndex);
  const wrappedFromMissingIdentity = identityMissing && storedIndex >= order.length;
  const currentIndex = identityIndex >= 0
    ? identityIndex
    : identityMissing
      ? (wrappedFromMissingIdentity ? 0 : storedIndex)
      : clampInitiativeIndex(storedIndex, order.length);
  const currentCombatant = order[currentIndex] || null;

  return {
    order,
    currentIndex,
    currentCombatant,
    currentCombatantId: String(currentCombatant?.id || ''),
    round: wrappedFromMissingIdentity ? round + 1 : round,
    identityMissing,
    wrappedFromMissingIdentity
  };
}

function advanceInitiativeByIdentity(encounter = {}, combatants = []) {
  const snapshot = currentInitiativeState(encounter, combatants);
  if (!snapshot.order.length) throw fail('No active combatants are in initiative.', 'EMPTY_INITIATIVE');

  if (snapshot.identityMissing) {
    return {
      order: snapshot.order,
      currentTurnIndex: snapshot.currentIndex,
      currentCombatantId: snapshot.currentCombatantId,
      round: snapshot.round,
      currentCombatant: snapshot.currentCombatant
    };
  }

  const nextIndex = snapshot.currentIndex + 1 >= snapshot.order.length ? 0 : snapshot.currentIndex + 1;
  const nextRound = nextIndex === 0 ? snapshot.round + 1 : snapshot.round;
  const currentCombatant = snapshot.order[nextIndex];

  return {
    order: snapshot.order,
    currentTurnIndex: nextIndex,
    currentCombatantId: String(currentCombatant?.id || ''),
    round: nextRound,
    currentCombatant
  };
}

function primeEncounterTurn(encounter = {}, combatants = []) {
  const order = initiativeOrder(combatants);
  encounter.currentTurnIndex = 0;
  encounter.currentCombatantId = String(order[0]?.id || '');
  encounter.round = 1;
  return {
    order,
    currentTurnIndex: encounter.currentTurnIndex,
    currentCombatantId: encounter.currentCombatantId,
    round: encounter.round,
    currentCombatant: order[0] || null
  };
}

function replaceInitiativeCombatant(state, input = {}) {
  state.combatants = Array.isArray(state.combatants) ? state.combatants : [];
  const candidate = { ...input };
  state.combatants = state.combatants.filter((item) => {
    if (item.id === candidate.id) return false;
    if (item.encounterId !== candidate.encounterId) return true;
    if (candidate.characterId && item.characterId === candidate.characterId) return false;
    return !(candidate.discordUserId && item.discordUserId === candidate.discordUserId && item.characterId === candidate.characterId);
  });
  state.combatants.push(candidate);
  return candidate;
}

function findSession(state, sessionId) {
  const session = (state.sessions || []).find((item) => item.id === sessionId);
  if (!session) throw fail('Session not found.', 'SESSION_NOT_FOUND');
  return session;
}

function assertSessionStartable(state, sessionId) {
  const session = findSession(state, sessionId);
  if (session.status !== 'planned') {
    throw fail(`Only a planned session can be started. This session is ${session.status || 'unknown'}.`, 'SESSION_NOT_STARTABLE');
  }
  return session;
}

function assertSessionEndable(state, sessionId) {
  const session = findSession(state, sessionId);
  if (session.status !== 'active') {
    throw fail(`Only an active session can be ended. This session is ${session.status || 'unknown'}.`, 'SESSION_NOT_ACTIVE');
  }
  return session;
}

module.exports = {
  normalizeDiscordResource,
  initiativeOrder,
  clampInitiativeIndex,
  currentInitiativeState,
  advanceInitiativeByIdentity,
  primeEncounterTurn,
  replaceInitiativeCombatant,
  assertSessionStartable,
  assertSessionEndable
};
