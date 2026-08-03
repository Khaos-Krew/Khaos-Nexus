'use strict';

const crypto = require('node:crypto');
require('./dnd-ai-context-privacy.cjs').install();

const {
  buildCampaignContext,
  normalizeContextOptions,
  clean,
  cleanLine,
  nowIso
} = require('./dnd-co-dm.cjs');
const {
  CAMPAIGNS_PATH,
  assertRequestSize,
  buildLegacyCampaignRequest,
  contextFingerprint,
  normalizeEndpoint
} = require('./dnd-ai-service.cjs');

const AI_GM_SNAPSHOT = '5524dcbda06c70a51774bdc843a2f9e739f7ba50';
const AI_GM_MODES = Object.freeze(['disabled', 'ready', 'active', 'paused', 'ended']);
const AI_GM_TURN_STATUSES = Object.freeze(['pending', 'completed', 'failed']);
const AI_GM_SUGGESTION_TYPES = Object.freeze(['current_scene', 'world_fact', 'open_thread', 'resolve_thread', 'note']);
const MAX_BINDINGS = 100;
const MAX_SESSIONS = 100;
const MAX_TURNS = 500;
const MAX_TURNS_PER_SESSION = 100;
const MAX_SUGGESTIONS = 100;

const AGENCY_VERBS = '(?:thinks|feels|decides|chooses|agrees|refuses|accepts|says|replies|promises|attacks|casts|kills|surrenders|confesses|betrays|forgives|falls in love|takes the deal|leaves the party)';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function id(prefix = 'ai_gm') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function validationError(message, code = 'DND_AI_GM_INVALID', field = '') {
  return Object.assign(new Error(message), { code, field });
}

function requiredLine(value, field, maximum) {
  const result = cleanLine(value, maximum);
  if (!result) throw validationError(`${field} is required.`, 'DND_AI_GM_REQUIRED', field);
  if (String(value ?? '').trim().length > maximum) throw validationError(`${field} must be ${maximum} characters or fewer.`, 'DND_AI_GM_TOO_LONG', field);
  return result;
}

function optionalText(value, maximum) {
  const source = String(value ?? '').replace(/\u0000/g, '').trim();
  return source.slice(0, maximum);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function normalizeContextSelection(input = {}) {
  const defaults = normalizeContextOptions(input);
  return {
    ...defaults,
    includePublicRolls: false,
    includeSessionRecaps: input.includeSessionRecaps !== false,
    includeEncounterDetails: input.includeEncounterDetails !== false,
    includeCharacterDetails: input.includeCharacterDetails !== false,
    includeApprovedHomebrew: input.includeApprovedHomebrew === true,
    includeGmNotes: input.includeGmNotes === true
  };
}

function findCampaign(state, campaignId) {
  return (state.campaigns || []).find((item) => item.id === campaignId && item.active !== false) || null;
}

function findDesktopSession(state, sessionId) {
  return (state.sessions || []).find((item) => item.id === sessionId) || null;
}

function assertEligibleDesktopSession(state, campaignId, sessionId) {
  const session = findDesktopSession(state, sessionId);
  if (!session || session.campaignId !== campaignId) {
    throw validationError('Select a D&D session belonging to this campaign.', 'DND_AI_GM_SESSION_REQUIRED', 'sessionId');
  }
  if (!['planned', 'active'].includes(session.status)) {
    throw validationError('AI Game Master mode can attach only to a planned or active desktop session.', 'DND_AI_GM_SESSION_STATUS', 'sessionId');
  }
  return session;
}

function playerCharacterNames(state, campaignId) {
  return [...new Set((state.characters || [])
    .filter((item) => item.campaignId === campaignId && item.active !== false && item.status !== 'inactive')
    .map((item) => cleanLine(item.name, 100))
    .filter(Boolean))].slice(0, 20);
}

function buildAiGmSyncPreview(stateInput, input = {}) {
  const state = clone(stateInput || {});
  const campaignId = requiredLine(input.campaignId, 'campaignId', 100);
  const sessionId = requiredLine(input.sessionId, 'sessionId', 100);
  const campaign = findCampaign(state, campaignId);
  if (!campaign) throw validationError('Select an active campaign before preparing AI Game Master mode.', 'DND_CAMPAIGN_REQUIRED', 'campaignId');
  const session = assertEligibleDesktopSession(state, campaignId, sessionId);
  const contextOptions = normalizeContextSelection(input.contextOptions || {});
  const context = buildCampaignContext(state, campaignId, contextOptions, input.settings || {});
  const request = buildLegacyCampaignRequest(state, campaignId, context);
  request.mode = 'gm';
  request.name = cleanLine(`${campaign.name || 'Campaign'} — AI GM — ${session.title || 'Session'}`, 120);
  request.rulesNotes = [
    ...(request.rulesNotes || []),
    'Preserve player agency. Never invent a player character’s thoughts, dialogue, consent, choice, or irreversible action.',
    'Suggested checks are unresolved proposals. Never roll dice or claim a check succeeded or failed.',
    'Return proposed campaign updates only. The Khaos Nexus desktop applies nothing automatically.',
    'If a configured pause word is used or a safety boundary is approached, return safety status pause or redirect.'
  ].slice(0, 100);
  assertRequestSize(request);
  const fingerprint = contextFingerprint(context);
  return {
    campaignId,
    sessionId,
    campaignName: cleanLine(campaign.name, 120),
    sessionTitle: cleanLine(session.title, 160),
    contextOptions,
    contextFingerprint: fingerprint,
    context: {
      characters: context.characters,
      characterLimit: context.characterLimit,
      sections: clone(context.sections),
      preview: context.preview
    },
    request,
    playerCharacterNames: playerCharacterNames(state, campaignId),
    disclosure: {
      serviceRepository: 'Khaos-Krew/Khaos-Nexus-AI',
      serviceSnapshot: AI_GM_SNAPSHOT,
      servicePersistsCampaignCopy: true,
      explicitSynchronizationOnly: true,
      providerStorageAllowed: false,
      automaticDesktopMutation: false,
      automaticDiscordPublication: false,
      automaticRolls: false,
      protectedFilesIncluded: false,
      discordIdentifiersIncluded: false,
      blindRollsIncluded: false,
      unprovidedLicensedFullTextIncluded: false
    }
  };
}

function normalizeBinding(input = {}) {
  const createdAt = input.createdAt || nowIso();
  return {
    id: cleanLine(input.id, 100) || id('ai_gm_binding'),
    campaignId: cleanLine(input.campaignId, 100),
    sessionId: cleanLine(input.sessionId, 100),
    endpoint: normalizeEndpoint(input.endpoint),
    serviceCampaignId: cleanLine(input.serviceCampaignId, 100),
    contextFingerprint: cleanLine(input.contextFingerprint, 128),
    contextOptions: normalizeContextSelection(input.contextOptions || {}),
    playerCharacterNames: [...new Set((Array.isArray(input.playerCharacterNames) ? input.playerCharacterNames : []).map((item) => cleanLine(item, 100)).filter(Boolean))].slice(0, 20),
    serviceVersion: cleanLine(input.serviceVersion, 80),
    provider: cleanLine(input.provider, 80),
    model: cleanLine(input.model, 120),
    syncedAt: input.syncedAt || createdAt,
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
}

function normalizeAiGmSession(input = {}) {
  const createdAt = input.createdAt || nowIso();
  const mode = AI_GM_MODES.includes(input.mode) ? input.mode : 'disabled';
  return {
    id: cleanLine(input.id, 100) || id('ai_gm_session'),
    campaignId: cleanLine(input.campaignId, 100),
    desktopSessionId: cleanLine(input.desktopSessionId, 100),
    bindingId: cleanLine(input.bindingId, 100),
    mode,
    safetyLocked: mode === 'paused' || input.safetyLocked === true,
    safetyStatus: ['ok', 'pause', 'redirect'].includes(input.safetyStatus) ? input.safetyStatus : 'ok',
    safetyReason: clean(input.safetyReason, 1000),
    pausedAt: input.pausedAt || '',
    resumedAt: input.resumedAt || '',
    endedAt: input.endedAt || '',
    lastTurnAt: input.lastTurnAt || '',
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
}

function normalizeSuggestion(input = {}, index = 0) {
  const type = AI_GM_SUGGESTION_TYPES.includes(input.type) ? input.type : 'note';
  const text = clean(input.text, 4000);
  if (!text) throw validationError('AI Game Master suggestions require text.', 'DND_AI_GM_SUGGESTION_INVALID', `suggestions.${index}`);
  return {
    id: cleanLine(input.id, 100) || `suggestion_${stableHash({ type, text, index })}`,
    type,
    text,
    appliedAt: input.appliedAt || '',
    appliedTarget: cleanLine(input.appliedTarget, 100)
  };
}

function suggestionsFromStateUpdates(updates = {}) {
  const suggestions = [];
  if (clean(updates.currentScene, 4000)) suggestions.push({ type: 'current_scene', text: clean(updates.currentScene, 4000) });
  for (const item of Array.isArray(updates.addWorldFacts) ? updates.addWorldFacts : []) suggestions.push({ type: 'world_fact', text: clean(item, 4000) });
  for (const item of Array.isArray(updates.addOpenThreads) ? updates.addOpenThreads : []) suggestions.push({ type: 'open_thread', text: clean(item, 4000) });
  for (const item of Array.isArray(updates.resolveOpenThreads) ? updates.resolveOpenThreads : []) suggestions.push({ type: 'resolve_thread', text: clean(item, 4000) });
  for (const item of Array.isArray(updates.addNotes) ? updates.addNotes : []) suggestions.push({ type: 'note', text: clean(item, 4000) });
  return suggestions.filter((item) => item.text).slice(0, MAX_SUGGESTIONS).map(normalizeSuggestion);
}

function normalizeTurnResult(payload = {}, options = {}) {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw validationError('Khaos Nexus AI returned an invalid turn result.', 'DND_AI_GM_TURN_INVALID', 'result');
  }
  const narration = clean(result.narration, 12000);
  if (!narration) throw validationError('Khaos Nexus AI returned no narration.', 'DND_AI_GM_TURN_EMPTY', 'result.narration');
  const dialogue = Array.isArray(result.spokenDialogue) ? result.spokenDialogue.slice(0, 50).map((item, index) => ({
    speaker: requiredLine(item?.speaker, `spokenDialogue.${index}.speaker`, 120),
    text: requiredLine(item?.text, `spokenDialogue.${index}.text`, 4000)
  })) : [];
  const checks = Array.isArray(result.suggestedChecks) ? result.suggestedChecks.slice(0, 30).map((item, index) => {
    const dc = Number(item?.dc);
    if (!Number.isInteger(dc) || dc < 1 || dc > 40) throw validationError(`suggestedChecks.${index}.dc must be an integer from 1 to 40.`, 'DND_AI_GM_CHECK_INVALID', `suggestedChecks.${index}.dc`);
    return {
      character: requiredLine(item?.character, `suggestedChecks.${index}.character`, 120),
      ability: requiredLine(item?.ability, `suggestedChecks.${index}.ability`, 80),
      skill: requiredLine(item?.skill, `suggestedChecks.${index}.skill`, 80),
      dc,
      reason: requiredLine(item?.reason, `suggestedChecks.${index}.reason`, 1000)
    };
  }) : [];
  const choices = (Array.isArray(result.choices) ? result.choices : []).slice(0, 6).map((item, index) => requiredLine(item, `choices.${index}`, 2000));
  const safetyInput = result.safety && typeof result.safety === 'object' ? result.safety : {};
  const safetyStatus = ['ok', 'pause', 'redirect'].includes(safetyInput.status) ? safetyInput.status : 'ok';
  const normalized = {
    narration,
    spokenDialogue: dialogue,
    suggestedChecks: checks,
    choices,
    stateUpdates: {
      currentScene: optionalText(result.stateUpdates?.currentScene, 4000),
      addWorldFacts: (Array.isArray(result.stateUpdates?.addWorldFacts) ? result.stateUpdates.addWorldFacts : []).slice(0, 50).map((item) => clean(item, 4000)).filter(Boolean),
      addOpenThreads: (Array.isArray(result.stateUpdates?.addOpenThreads) ? result.stateUpdates.addOpenThreads : []).slice(0, 50).map((item) => clean(item, 4000)).filter(Boolean),
      resolveOpenThreads: (Array.isArray(result.stateUpdates?.resolveOpenThreads) ? result.stateUpdates.resolveOpenThreads : []).slice(0, 50).map((item) => clean(item, 4000)).filter(Boolean),
      addNotes: (Array.isArray(result.stateUpdates?.addNotes) ? result.stateUpdates.addNotes : []).slice(0, 50).map((item) => clean(item, 4000)).filter(Boolean)
    },
    safety: {
      status: safetyStatus,
      reason: optionalText(safetyInput.reason, 1000)
    },
    suggestions: []
  };
  normalized.suggestions = suggestionsFromStateUpdates(normalized.stateUpdates);
  assertPlayerAgency(normalized, options.playerCharacterNames || []);
  return normalized;
}

function assertPlayerAgency(result = {}, names = []) {
  const playerNames = [...new Set((Array.isArray(names) ? names : []).map((item) => cleanLine(item, 100)).filter(Boolean))];
  const dialogueSpeakers = new Set((result.spokenDialogue || []).map((item) => cleanLine(item.speaker, 100).toLowerCase()));
  for (const name of playerNames) {
    if (dialogueSpeakers.has(name.toLowerCase())) {
      throw validationError(`Khaos Nexus AI attempted to write dialogue for player character ${name}.`, 'DND_AI_GM_AGENCY_VIOLATION', 'result.spokenDialogue');
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b.{0,32}\\b${AGENCY_VERBS}\\b`, 'i');
    if (pattern.test(result.narration || '')) {
      throw validationError(`Khaos Nexus AI attempted to decide an action, thought, or dialogue for player character ${name}.`, 'DND_AI_GM_AGENCY_VIOLATION', 'result.narration');
    }
  }
  return true;
}

function normalizeTurn(input = {}) {
  const createdAt = input.createdAt || nowIso();
  const status = AI_GM_TURN_STATUSES.includes(input.status) ? input.status : 'pending';
  return {
    id: cleanLine(input.id, 100) || id('ai_gm_turn'),
    clientTurnId: cleanLine(input.clientTurnId, 100) || crypto.randomUUID(),
    aiGmSessionId: cleanLine(input.aiGmSessionId, 100),
    campaignId: cleanLine(input.campaignId, 100),
    desktopSessionId: cleanLine(input.desktopSessionId, 100),
    serviceCampaignId: cleanLine(input.serviceCampaignId, 100),
    actor: cleanLine(input.actor || 'Party', 100),
    message: clean(input.message, 12000),
    dmGuidance: clean(input.dmGuidance, 4000),
    requestFingerprint: cleanLine(input.requestFingerprint, 128),
    status,
    response: input.response && typeof input.response === 'object' ? clone(input.response) : null,
    error: clean(input.error, 1200),
    retryable: input.retryable === true,
    retryCount: Math.max(0, Math.min(20, Number(input.retryCount || 0))),
    createdAt,
    submittedAt: input.submittedAt || '',
    completedAt: input.completedAt || '',
    updatedAt: input.updatedAt || createdAt
  };
}

function buildTurnRequest(input = {}) {
  const actor = requiredLine(input.actor || 'Party', 'actor', 100);
  const message = optionalText(input.message, 12000);
  if (!message) throw validationError('Enter the table action or statement for this turn.', 'DND_AI_GM_MESSAGE_REQUIRED', 'message');
  if (String(input.message ?? '').trim().length > 12000) throw validationError('Turn messages must be 12,000 characters or fewer.', 'DND_AI_GM_TOO_LONG', 'message');
  const dmGuidance = optionalText(input.dmGuidance, 4000);
  if (String(input.dmGuidance ?? '').trim().length > 4000) throw validationError('DM guidance must be 4,000 characters or fewer.', 'DND_AI_GM_TOO_LONG', 'dmGuidance');
  return assertRequestSize({
    actor,
    message,
    dmGuidance: clean([
      dmGuidance,
      'Preserve player agency. Do not invent a player character’s thoughts, dialogue, consent, choice, or irreversible action.',
      'Do not roll dice or resolve suggested checks. Return checks as unresolved suggestions only.',
      'Return proposed state updates only; do not claim any desktop or Discord state changed.'
    ].filter(Boolean).join(' '), 4000)
  });
}

function recordPendingTurn(stateInput, input = {}) {
  const state = ensureAiGmState(stateInput);
  const session = state.aiGmSessions.find((item) => item.id === input.aiGmSessionId);
  if (!session || !['ready', 'active'].includes(session.mode)) throw validationError('AI Game Master mode is not ready for this session.', 'DND_AI_GM_NOT_READY', 'aiGmSessionId');
  if (session.safetyLocked) throw validationError('AI Game Master generation is paused by a safety lock. Resume explicitly before another turn.', 'DND_AI_GM_SAFETY_LOCKED', 'aiGmSessionId');
  const request = buildTurnRequest(input);
  const clientTurnId = cleanLine(input.clientTurnId, 100) || crypto.randomUUID();
  const existing = state.aiGmTurns.find((item) => item.clientTurnId === clientTurnId);
  if (existing) return { state, turn: clone(existing), request, duplicate: true };
  const turn = normalizeTurn({
    clientTurnId,
    aiGmSessionId: session.id,
    campaignId: session.campaignId,
    desktopSessionId: session.desktopSessionId,
    serviceCampaignId: input.serviceCampaignId,
    actor: request.actor,
    message: request.message,
    dmGuidance: request.dmGuidance,
    requestFingerprint: stableHash(request),
    status: 'pending'
  });
  state.aiGmTurns.push(turn);
  state.aiGmTurns = state.aiGmTurns.slice(-MAX_TURNS);
  return { state, turn: clone(turn), request, duplicate: false };
}

function completeTurn(stateInput, turnId, payload = {}, options = {}) {
  const state = ensureAiGmState(stateInput);
  const index = state.aiGmTurns.findIndex((item) => item.id === turnId);
  if (index < 0) throw validationError('Pending AI Game Master turn was not found.', 'DND_AI_GM_TURN_NOT_FOUND', 'turnId');
  const turn = state.aiGmTurns[index];
  if (turn.status === 'completed') return { state, turn: clone(turn), duplicate: true };
  const sessionIndex = state.aiGmSessions.findIndex((item) => item.id === turn.aiGmSessionId);
  if (sessionIndex < 0) throw validationError('AI Game Master session was not found.', 'DND_AI_GM_SESSION_NOT_FOUND', 'aiGmSessionId');
  const response = normalizeTurnResult(payload, options);
  const timestamp = nowIso();
  const completed = normalizeTurn({
    ...turn,
    status: 'completed',
    response,
    completedAt: timestamp,
    updatedAt: timestamp,
    error: '',
    retryable: false
  });
  state.aiGmTurns[index] = completed;
  const currentSession = state.aiGmSessions[sessionIndex];
  const paused = ['pause', 'redirect'].includes(response.safety.status);
  state.aiGmSessions[sessionIndex] = normalizeAiGmSession({
    ...currentSession,
    mode: paused ? 'paused' : 'active',
    safetyLocked: paused,
    safetyStatus: response.safety.status,
    safetyReason: response.safety.reason,
    pausedAt: paused ? timestamp : currentSession.pausedAt,
    lastTurnAt: timestamp,
    updatedAt: timestamp
  });
  return { state, turn: clone(completed), duplicate: false };
}

function failTurn(stateInput, turnId, error = {}) {
  const state = ensureAiGmState(stateInput);
  const index = state.aiGmTurns.findIndex((item) => item.id === turnId);
  if (index < 0) throw validationError('Pending AI Game Master turn was not found.', 'DND_AI_GM_TURN_NOT_FOUND', 'turnId');
  const current = state.aiGmTurns[index];
  state.aiGmTurns[index] = normalizeTurn({
    ...current,
    status: 'failed',
    error: clean(error.message || error, 1200),
    retryable: error.retryable === true,
    retryCount: Number(current.retryCount || 0) + 1,
    updatedAt: nowIso()
  });
  return { state, turn: clone(state.aiGmTurns[index]) };
}

function resumeAiGmSession(stateInput, sessionId, reason) {
  const state = ensureAiGmState(stateInput);
  const index = state.aiGmSessions.findIndex((item) => item.id === sessionId);
  if (index < 0) throw validationError('AI Game Master session was not found.', 'DND_AI_GM_SESSION_NOT_FOUND', 'sessionId');
  const explanation = requiredLine(reason, 'resumeReason', 1000);
  const timestamp = nowIso();
  state.aiGmSessions[index] = normalizeAiGmSession({
    ...state.aiGmSessions[index],
    mode: 'active',
    safetyLocked: false,
    safetyStatus: 'ok',
    safetyReason: explanation,
    resumedAt: timestamp,
    updatedAt: timestamp
  });
  return { state, session: clone(state.aiGmSessions[index]) };
}

function bindingIsStale(bindingInput, currentFingerprint) {
  const binding = normalizeBinding(bindingInput);
  return !binding.contextFingerprint || binding.contextFingerprint !== cleanLine(currentFingerprint, 128);
}

function ensureAiGmState(state) {
  if (!state || typeof state !== 'object') throw new Error('D&D state is unavailable.');
  if (!Array.isArray(state.aiGmBindings)) state.aiGmBindings = [];
  state.aiGmBindings = state.aiGmBindings.map((item) => { try { return normalizeBinding(item); } catch { return null; } }).filter(Boolean).slice(-MAX_BINDINGS);
  if (!Array.isArray(state.aiGmSessions)) state.aiGmSessions = [];
  state.aiGmSessions = state.aiGmSessions.map((item) => { try { return normalizeAiGmSession(item); } catch { return null; } }).filter(Boolean).slice(-MAX_SESSIONS);
  if (!Array.isArray(state.aiGmTurns)) state.aiGmTurns = [];
  state.aiGmTurns = state.aiGmTurns.map((item) => { try { return normalizeTurn(item); } catch { return null; } }).filter(Boolean).slice(-MAX_TURNS);
  const allowedSessionIds = new Set(state.aiGmSessions.map((item) => item.id));
  state.aiGmTurns = state.aiGmTurns.filter((item) => allowedSessionIds.has(item.aiGmSessionId));
  for (const session of state.aiGmSessions) {
    const indexes = state.aiGmTurns.map((item, index) => item.aiGmSessionId === session.id ? index : -1).filter((index) => index >= 0);
    for (const index of indexes.slice(0, Math.max(0, indexes.length - MAX_TURNS_PER_SESSION))) state.aiGmTurns[index] = null;
  }
  state.aiGmTurns = state.aiGmTurns.filter(Boolean);
  return state;
}

function campaignPath(serviceCampaignId) {
  return `${CAMPAIGNS_PATH}/${encodeURIComponent(requiredLine(serviceCampaignId, 'serviceCampaignId', 100))}`;
}

function campaignTurnsPath(serviceCampaignId) {
  return `${campaignPath(serviceCampaignId)}/turns`;
}

module.exports = {
  AI_GM_SNAPSHOT,
  AI_GM_MODES,
  AI_GM_TURN_STATUSES,
  AI_GM_SUGGESTION_TYPES,
  MAX_BINDINGS,
  MAX_SESSIONS,
  MAX_TURNS,
  normalizeContextSelection,
  buildAiGmSyncPreview,
  normalizeBinding,
  normalizeAiGmSession,
  normalizeSuggestion,
  suggestionsFromStateUpdates,
  normalizeTurnResult,
  assertPlayerAgency,
  normalizeTurn,
  buildTurnRequest,
  recordPendingTurn,
  completeTurn,
  failTurn,
  resumeAiGmSession,
  bindingIsStale,
  ensureAiGmState,
  playerCharacterNames,
  campaignPath,
  campaignTurnsPath,
  stableHash
};
