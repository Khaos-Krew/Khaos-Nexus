'use strict';

const {
  AI_GM_SUGGESTION_TYPES,
  ensureAiGmState,
  normalizeAiGmSession,
  normalizeSuggestion,
  normalizeTurn,
  stableHash
} = require('./dnd-ai-gm.cjs');
const { assertRequestSize } = require('./dnd-ai-service.cjs');
const { clean, cleanLine, nowIso } = require('./dnd-co-dm.cjs');

const APPLY_TARGETS = Object.freeze(['session_recap', 'campaign_codm_notes']);
const SUGGESTION_LABELS = Object.freeze({
  current_scene: 'Current scene',
  world_fact: 'World fact',
  open_thread: 'Open thread',
  resolve_thread: 'Resolved thread',
  note: 'Note'
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function actionError(message, code = 'DND_AI_GM_ACTION_INVALID', field = '') {
  return Object.assign(new Error(message), { code, field });
}

function retryFailedTurn(stateInput, turnIdInput) {
  const state = ensureAiGmState(stateInput);
  const turnId = cleanLine(turnIdInput, 100);
  const index = state.aiGmTurns.findIndex((item) => item.id === turnId);
  if (index < 0) throw actionError('AI Game Master turn was not found.', 'DND_AI_GM_TURN_NOT_FOUND', 'turnId');
  const turn = state.aiGmTurns[index];
  if (turn.status !== 'failed' || !turn.retryable) {
    throw actionError('Only a failed retryable AI Game Master turn can be retried.', 'DND_AI_GM_TURN_NOT_RETRYABLE', 'turnId');
  }
  const session = state.aiGmSessions.find((item) => item.id === turn.aiGmSessionId);
  if (session?.safetyLocked) {
    throw actionError('AI Game Master generation is paused by a safety lock.', 'DND_AI_GM_SAFETY_LOCKED', 'turnId');
  }
  if (!session || !['ready', 'active'].includes(session.mode)) {
    throw actionError('AI Game Master mode is not ready for this retry.', 'DND_AI_GM_NOT_READY', 'turnId');
  }
  const request = assertRequestSize({ actor: turn.actor, message: turn.message, dmGuidance: turn.dmGuidance });
  const timestamp = nowIso();
  state.aiGmTurns[index] = normalizeTurn({
    ...turn,
    status: 'pending',
    error: '',
    retryable: false,
    submittedAt: timestamp,
    updatedAt: timestamp
  });
  return { state, turn: clone(state.aiGmTurns[index]), request };
}

function selectedSuggestions(turn, suggestionIds) {
  const requested = new Set((Array.isArray(suggestionIds) ? suggestionIds : []).map((item) => cleanLine(item, 100)).filter(Boolean));
  if (!requested.size) throw actionError('Select at least one AI Game Master suggestion to apply.', 'DND_AI_GM_SUGGESTION_REQUIRED', 'suggestionIds');
  const suggestions = Array.isArray(turn.response?.suggestions) ? turn.response.suggestions : [];
  const selected = suggestions.filter((item) => requested.has(item.id));
  if (selected.length !== requested.size) throw actionError('One or more selected suggestions were not found.', 'DND_AI_GM_SUGGESTION_NOT_FOUND', 'suggestionIds');
  return selected;
}

function formattedSuggestionBlock(turn, suggestions) {
  const timestamp = nowIso();
  const lines = suggestions.map((item) => `- ${SUGGESTION_LABELS[item.type] || 'Note'}: ${clean(item.text, 4000)}`);
  return [
    `## AI Game Master suggestions — ${timestamp}`,
    `Source turn: ${cleanLine(turn.actor || 'Party', 100)} — ${clean(turn.message, 500)}`,
    ...lines
  ].join('\n');
}

function appendBounded(existing, addition, maximum, label) {
  const current = String(existing || '').trim();
  const combined = [current, addition].filter(Boolean).join('\n\n');
  if (combined.length > maximum) throw actionError(`${label} would exceed its ${maximum}-character limit. Shorten the existing notes or apply fewer suggestions.`, 'DND_AI_GM_APPLY_TOO_LARGE', label);
  return combined;
}

function applySelectedSuggestions(stateInput, input = {}) {
  const state = ensureAiGmState(stateInput);
  const turnId = cleanLine(input.turnId, 100);
  const target = APPLY_TARGETS.includes(input.target) ? input.target : '';
  if (!target) throw actionError(`Choose an apply target: ${APPLY_TARGETS.join(', ')}.`, 'DND_AI_GM_APPLY_TARGET', 'target');
  const turnIndex = state.aiGmTurns.findIndex((item) => item.id === turnId);
  if (turnIndex < 0) throw actionError('Completed AI Game Master turn was not found.', 'DND_AI_GM_TURN_NOT_FOUND', 'turnId');
  const turn = state.aiGmTurns[turnIndex];
  if (turn.status !== 'completed' || !turn.response) throw actionError('Only a completed AI Game Master turn can apply suggestions.', 'DND_AI_GM_TURN_NOT_COMPLETED', 'turnId');
  const selected = selectedSuggestions(turn, input.suggestionIds);
  const unapplied = selected.filter((item) => !item.appliedAt);
  if (!unapplied.length) {
    return { state, applied: [], duplicate: true, applicationId: stableHash({ turnId, target, suggestions: selected.map((item) => item.id) }) };
  }
  if (unapplied.length !== selected.length) throw actionError('Some selected suggestions were already applied. Refresh and select only unapplied suggestions.', 'DND_AI_GM_SUGGESTION_PARTIAL_DUPLICATE', 'suggestionIds');

  const block = formattedSuggestionBlock(turn, unapplied);
  if (target === 'session_recap') {
    const sessionIndex = (state.sessions || []).findIndex((item) => item.id === turn.desktopSessionId && item.campaignId === turn.campaignId);
    if (sessionIndex < 0) throw actionError('The linked desktop session was not found.', 'DND_AI_GM_DESKTOP_SESSION_NOT_FOUND', 'target');
    state.sessions[sessionIndex] = {
      ...state.sessions[sessionIndex],
      recapDraft: appendBounded(state.sessions[sessionIndex].recapDraft, block, 12000, 'session recap draft'),
      updatedAt: nowIso()
    };
  } else {
    const campaignIndex = (state.campaigns || []).findIndex((item) => item.id === turn.campaignId && item.active !== false);
    if (campaignIndex < 0) throw actionError('The linked campaign was not found.', 'DND_CAMPAIGN_REQUIRED', 'target');
    state.campaigns[campaignIndex] = {
      ...state.campaigns[campaignIndex],
      coDmNotes: appendBounded(state.campaigns[campaignIndex].coDmNotes, block, 12000, 'campaign Co-DM notes'),
      updatedAt: nowIso()
    };
  }

  const appliedAt = nowIso();
  const selectedIds = new Set(unapplied.map((item) => item.id));
  const updatedSuggestions = turn.response.suggestions.map((item, index) => {
    const normalized = normalizeSuggestion(item, index);
    if (!selectedIds.has(normalized.id)) return normalized;
    return { ...normalized, appliedAt, appliedTarget: target };
  });
  state.aiGmTurns[turnIndex] = normalizeTurn({
    ...turn,
    response: { ...turn.response, suggestions: updatedSuggestions },
    updatedAt: appliedAt
  });
  return {
    state,
    applied: unapplied.map((item) => ({ id: item.id, type: AI_GM_SUGGESTION_TYPES.includes(item.type) ? item.type : 'note', target })),
    duplicate: false,
    applicationId: stableHash({ turnId, target, suggestions: unapplied.map((item) => item.id) })
  };
}

function buildAiGmRecapDraft(stateInput, aiGmSessionIdInput) {
  const state = ensureAiGmState(stateInput);
  const sessionId = cleanLine(aiGmSessionIdInput, 100);
  const session = state.aiGmSessions.find((item) => item.id === sessionId);
  if (!session) throw actionError('AI Game Master session was not found.', 'DND_AI_GM_SESSION_NOT_FOUND', 'aiGmSessionId');
  const turns = state.aiGmTurns.filter((item) => item.aiGmSessionId === sessionId && item.status === 'completed' && item.response);
  if (!turns.length) throw actionError('Complete at least one AI Game Master turn before drafting a recap.', 'DND_AI_GM_RECAP_EMPTY', 'aiGmSessionId');
  const sections = turns.map((turn, index) => [
    `### Turn ${index + 1} — ${cleanLine(turn.actor || 'Party', 100)}`,
    `Table input: ${clean(turn.message, 1200)}`,
    `Narration: ${clean(turn.response.narration, 3000)}`,
    ...(turn.response.safety?.status && turn.response.safety.status !== 'ok'
      ? [`Safety: ${cleanLine(turn.response.safety.status, 40)} — ${clean(turn.response.safety.reason, 500)}`]
      : [])
  ].join('\n'));
  return clean([
    '# AI Game Master recap draft',
    'Review this draft before adding it to the desktop session. It is not approved automatically.',
    ...sections
  ].join('\n\n'), 12000);
}

function endAiGmSession(stateInput, sessionIdInput) {
  const state = ensureAiGmState(stateInput);
  const sessionId = cleanLine(sessionIdInput, 100);
  const index = state.aiGmSessions.findIndex((item) => item.id === sessionId);
  if (index < 0) throw actionError('AI Game Master session was not found.', 'DND_AI_GM_SESSION_NOT_FOUND', 'aiGmSessionId');
  const timestamp = nowIso();
  state.aiGmSessions[index] = normalizeAiGmSession({
    ...state.aiGmSessions[index],
    mode: 'ended',
    safetyLocked: false,
    endedAt: timestamp,
    updatedAt: timestamp
  });
  return { state, session: clone(state.aiGmSessions[index]) };
}

module.exports = {
  APPLY_TARGETS,
  SUGGESTION_LABELS,
  retryFailedTurn,
  applySelectedSuggestions,
  buildAiGmRecapDraft,
  endAiGmSession,
  formattedSuggestionBlock
};
