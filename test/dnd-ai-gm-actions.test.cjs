'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAiGmSession,
  normalizeBinding,
  normalizeTurn,
  ensureAiGmState
} = require('../shared/dnd-ai-gm.cjs');
const {
  retryFailedTurn,
  applySelectedSuggestions,
  buildAiGmRecapDraft,
  endAiGmSession
} = require('../shared/dnd-ai-gm-actions.cjs');

function completedState() {
  const binding = normalizeBinding({
    id: 'binding-1', campaignId: 'campaign-1', sessionId: 'session-1', endpoint: 'http://127.0.0.1:8787',
    serviceCampaignId: 'service-campaign-1', contextFingerprint: 'fingerprint-1'
  });
  const aiSession = normalizeAiGmSession({
    id: 'ai-session-1', campaignId: 'campaign-1', desktopSessionId: 'session-1', bindingId: binding.id, mode: 'active'
  });
  const turn = normalizeTurn({
    id: 'turn-1', clientTurnId: 'client-1', aiGmSessionId: aiSession.id,
    campaignId: 'campaign-1', desktopSessionId: 'session-1', serviceCampaignId: 'service-campaign-1',
    actor: 'Vorkesh', message: 'I inspect the runes.', dmGuidance: 'Preserve player agency.', status: 'completed',
    response: {
      narration: 'The runes flare with controlled heat.',
      spokenDialogue: [], suggestedChecks: [], choices: [],
      stateUpdates: {
        currentScene: 'The party stands before the crucible.',
        addWorldFacts: ['The crucible reacts to artificer infusions.'],
        addOpenThreads: ['Who last activated the crucible?'],
        resolveOpenThreads: [], addNotes: ['The runes match Vorkesh’s tools.']
      },
      safety: { status: 'ok', reason: '' },
      suggestions: [
        { id: 'suggestion-scene', type: 'current_scene', text: 'The party stands before the crucible.', appliedAt: '', appliedTarget: '' },
        { id: 'suggestion-fact', type: 'world_fact', text: 'The crucible reacts to artificer infusions.', appliedAt: '', appliedTarget: '' },
        { id: 'suggestion-thread', type: 'open_thread', text: 'Who last activated the crucible?', appliedAt: '', appliedTarget: '' },
        { id: 'suggestion-note', type: 'note', text: 'The runes match Vorkesh’s tools.', appliedAt: '', appliedTarget: '' }
      ]
    }
  });
  return ensureAiGmState({
    campaigns: [{ id: 'campaign-1', name: 'Emberforge Rising', active: true, coDmNotes: '' }],
    sessions: [{ id: 'session-1', campaignId: 'campaign-1', title: 'The Ashen Crucible', status: 'active', recapDraft: '' }],
    aiGmBindings: [binding], aiGmSessions: [aiSession], aiGmTurns: [turn]
  });
}

test('explicit selected suggestion application appends only to the chosen existing draft target', () => {
  const state = completedState();
  const campaignBefore = JSON.stringify(state.campaigns);
  const result = applySelectedSuggestions(state, {
    turnId: 'turn-1', suggestionIds: ['suggestion-scene', 'suggestion-note'], target: 'session_recap'
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.applied.length, 2);
  assert.match(result.state.sessions[0].recapDraft, /Current scene: The party stands before the crucible/);
  assert.match(result.state.sessions[0].recapDraft, /Note: The runes match Vorkesh’s tools/);
  assert.doesNotMatch(result.state.sessions[0].recapDraft, /Who last activated/);
  assert.equal(JSON.stringify(result.state.campaigns), campaignBefore);
  const applied = result.state.aiGmTurns[0].response.suggestions.filter((item) => item.appliedAt);
  assert.equal(applied.length, 2);
  assert.ok(applied.every((item) => item.appliedTarget === 'session_recap'));
});

test('campaign Co-DM notes require a separate explicit target and preserve the session recap', () => {
  const state = completedState();
  const sessionBefore = JSON.stringify(state.sessions);
  const result = applySelectedSuggestions(state, {
    turnId: 'turn-1', suggestionIds: ['suggestion-fact', 'suggestion-thread'], target: 'campaign_codm_notes'
  });
  assert.match(result.state.campaigns[0].coDmNotes, /World fact: The crucible reacts/);
  assert.match(result.state.campaigns[0].coDmNotes, /Open thread: Who last activated/);
  assert.equal(JSON.stringify(result.state.sessions), sessionBefore);
});

test('applied suggestions are idempotent and partial duplicate selections are rejected', () => {
  const first = applySelectedSuggestions(completedState(), {
    turnId: 'turn-1', suggestionIds: ['suggestion-scene'], target: 'session_recap'
  });
  const duplicate = applySelectedSuggestions(first.state, {
    turnId: 'turn-1', suggestionIds: ['suggestion-scene'], target: 'session_recap'
  });
  assert.equal(duplicate.duplicate, true);
  const occurrences = duplicate.state.sessions[0].recapDraft.match(/Current scene:/g) || [];
  assert.equal(occurrences.length, 1);
  assert.throws(() => applySelectedSuggestions(first.state, {
    turnId: 'turn-1', suggestionIds: ['suggestion-scene', 'suggestion-fact'], target: 'session_recap'
  }), /already applied/i);
});

test('failed retryable turns return to pending without losing or duplicating input', () => {
  const state = completedState();
  state.aiGmTurns = [normalizeTurn({
    id: 'failed-turn', clientTurnId: 'failed-client', aiGmSessionId: 'ai-session-1',
    campaignId: 'campaign-1', desktopSessionId: 'session-1', serviceCampaignId: 'service-campaign-1',
    actor: 'Vorkesh', message: 'I inspect the runes.', dmGuidance: 'Keep the scene unresolved. Preserve player agency.',
    status: 'failed', error: 'Service unavailable.', retryable: true, retryCount: 1
  })];
  const result = retryFailedTurn(state, 'failed-turn');
  assert.equal(result.turn.status, 'pending');
  assert.equal(result.turn.message, 'I inspect the runes.');
  assert.equal(result.request.dmGuidance, 'Keep the scene unresolved. Preserve player agency.');
  assert.equal(result.state.aiGmTurns.length, 1);
});

test('retry is blocked by safety lock and non-retryable failures', () => {
  const state = completedState();
  state.aiGmTurns = [normalizeTurn({
    id: 'failed-turn', clientTurnId: 'failed-client', aiGmSessionId: 'ai-session-1',
    campaignId: 'campaign-1', desktopSessionId: 'session-1', serviceCampaignId: 'service-campaign-1',
    actor: 'Party', message: 'Continue.', dmGuidance: '', status: 'failed', retryable: true
  })];
  state.aiGmSessions[0] = normalizeAiGmSession({ ...state.aiGmSessions[0], mode: 'paused', safetyLocked: true });
  assert.throws(() => retryFailedTurn(state, 'failed-turn'), /safety lock/i);
  state.aiGmSessions[0] = normalizeAiGmSession({ ...state.aiGmSessions[0], mode: 'active', safetyLocked: false });
  state.aiGmTurns[0] = normalizeTurn({ ...state.aiGmTurns[0], retryable: false });
  assert.throws(() => retryFailedTurn(state, 'failed-turn'), /failed retryable/i);
});

test('recap drafting is review-only and ending AI mode does not complete the desktop session', () => {
  const state = completedState();
  const desktopBefore = JSON.stringify(state.sessions);
  const recap = buildAiGmRecapDraft(state, 'ai-session-1');
  assert.match(recap, /AI Game Master recap draft/);
  assert.match(recap, /Table input: I inspect the runes/);
  assert.match(recap, /Narration: The runes flare/);
  assert.equal(JSON.stringify(state.sessions), desktopBefore);
  const ended = endAiGmSession(state, 'ai-session-1');
  assert.equal(ended.session.mode, 'ended');
  assert.equal(JSON.stringify(ended.state.sessions), desktopBefore);
});
