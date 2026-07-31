'use strict';

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

function assertSessionStartable(state, sessionId) {
  const session = (state.sessions || []).find((item) => item.id === sessionId);
  if (!session) {
    const error = new Error('Session not found.');
    error.code = 'SESSION_NOT_FOUND';
    throw error;
  }
  if (session.status !== 'planned') {
    const error = new Error(`Only a planned session can be started. This session is ${session.status || 'unknown'}.`);
    error.code = 'SESSION_NOT_STARTABLE';
    throw error;
  }
  return session;
}

module.exports = {
  normalizeDiscordResource,
  replaceInitiativeCombatant,
  assertSessionStartable
};
