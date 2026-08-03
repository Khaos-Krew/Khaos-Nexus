'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_GM_SNAPSHOT,
  buildAiGmSyncPreview,
  normalizeBinding,
  normalizeAiGmSession,
  normalizeTurnResult,
  buildTurnRequest,
  recordPendingTurn,
  completeTurn,
  failTurn,
  resumeAiGmSession,
  bindingIsStale,
  ensureAiGmState,
  campaignPath,
  campaignTurnsPath
} = require('../shared/dnd-ai-gm.cjs');

function baseState() {
  return {
    campaigns: [{
      id: 'campaign-1',
      name: 'Emberforge Rising',
      description: 'A heroic forge campaign.',
      status: 'active',
      ruleset: 'D&D 5e-compatible',
      contentRating: 'teen',
      tone: 'Dark heroic fantasy with hopeful victories.',
      safety: {
        lines: ['Sexual violence'],
        veils: ['Graphic torture'],
        pauseWords: ['pause', 'red card']
      },
      active: true,
      coDmNotes: 'The Ashen Crucible is unstable.'
    }],
    sessions: [{
      id: 'session-1', campaignId: 'campaign-1', title: 'The Ashen Crucible', status: 'planned',
      recapDraft: 'Private local recap.', createdAt: '2026-08-03T00:00:00Z'
    }],
    characters: [{
      id: 'character-internal-1', campaignId: 'campaign-1', name: 'Vorkesh Emberforge',
      playerName: 'Private Player', discordUserId: '123456789012345678', race: 'Dragonborn',
      className: 'Artificer', level: 7, notes: 'Arcane power glows through his scales.', active: true
    }],
    members: [{
      id: 'member-1', campaignId: 'campaign-1', displayName: 'Game Master', role: 'dm',
      userId: 'private-user-1', discordUserId: '234567890123456789', active: true
    }],
    quests: [{ id: 'quest-1', campaignId: 'campaign-1', title: 'Find the Ember Vault', status: 'active', summary: 'Trace unstable runes.', active: true }],
    locations: [{ id: 'location-1', campaignId: 'campaign-1', name: 'Ashen Forge', publicSummary: 'A ruined forge.', gmNotes: 'Hidden lower vault.', revealed: true }],
    factions: [], npcs: [], encounters: [], sources: [], campaignSources: [], homebrew: [], rolls: [
      { id: 'roll-public', campaignId: 'campaign-1', notation: '1d20+5', total: 18, visibility: 'public' },
      { id: 'roll-blind', campaignId: 'campaign-1', notation: '1d20+5', total: 3, blind: true, visibility: 'dm' }
    ],
    bindings: [{ id: 'discord-binding', guildId: '345678901234567890', channelId: '456789012345678901' }],
    grants: [{ id: 'grant-1', userId: 'private-user-1' }],
    audit: [{ id: 'audit-1', metadata: { token: 'secret-value' } }],
    aiMapProposals: [{ id: 'map-private', result: { title: 'Private map' } }],
    aiHomebrewProposals: [{ id: 'brew-private', result: { title: 'Private brew' } }]
  };
}

function serviceTurn(overrides = {}) {
  return {
    result: {
      narration: 'The forge answers with a low metallic groan as the inspected runes begin to glow.',
      spokenDialogue: [{ speaker: 'Forge Warden', text: 'The crucible remembers every hand that shaped it.' }],
      suggestedChecks: [{ character: 'Vorkesh Emberforge', ability: 'Intelligence', skill: 'Arcana', dc: 15, reason: 'Interpret the unstable rune sequence.' }],
      choices: ['Stabilize the runes', 'Trace the power conduit', 'Question the Forge Warden'],
      stateUpdates: {
        currentScene: 'The party stands before the unstable crucible.',
        addWorldFacts: ['The crucible reacts to artificer infusions.'],
        addOpenThreads: ['Who last activated the crucible?'],
        resolveOpenThreads: [],
        addNotes: ['The Forge Warden recognized Vorkesh’s tools.']
      },
      safety: { status: 'ok', reason: '' },
      ...overrides
    },
    meta: { provider: 'mock', model: 'deterministic-local' }
  };
}

function stateWithAiSession() {
  const state = baseState();
  state.aiGmBindings = [normalizeBinding({
    campaignId: 'campaign-1', sessionId: 'session-1', endpoint: 'http://127.0.0.1:8787',
    serviceCampaignId: 'service-campaign-1', contextFingerprint: 'fingerprint-1',
    playerCharacterNames: ['Vorkesh Emberforge']
  })];
  state.aiGmSessions = [normalizeAiGmSession({
    id: 'ai-session-1', campaignId: 'campaign-1', desktopSessionId: 'session-1',
    bindingId: state.aiGmBindings[0].id, mode: 'ready'
  })];
  state.aiGmTurns = [];
  return ensureAiGmState(state);
}

test('AI GM sync preview is explicit, GM-mode, safety-aware, and excludes protected identifiers', () => {
  assert.equal(AI_GM_SNAPSHOT, '5524dcbda06c70a51774bdc843a2f9e739f7ba50');
  const preview = buildAiGmSyncPreview(baseState(), {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    contextOptions: { includeGmNotes: false, includeApprovedHomebrew: false, includePublicRolls: true }
  });
  assert.equal(preview.request.mode, 'gm');
  assert.equal(preview.sessionId, 'session-1');
  assert.match(preview.context.preview, /Safety settings/);
  assert.match(JSON.stringify(preview.request.safety), /Sexual violence|red card/);
  assert.deepEqual(preview.request.playerCharacters[0], {
    name: 'Vorkesh Emberforge',
    summary: 'Dragonborn — Artificer — Level 7 — Arcane power glows through his scales.'
  });
  const serialized = JSON.stringify(preview);
  assert.doesNotMatch(serialized, /character-internal-1|Private Player|123456789012345678|234567890123456789|345678901234567890|456789012345678901|secret-value|roll-blind|map-private|brew-private/);
  assert.equal(preview.disclosure.servicePersistsCampaignCopy, true);
  assert.equal(preview.disclosure.automaticDesktopMutation, false);
  assert.equal(preview.disclosure.discordIdentifiersIncluded, false);
  assert.equal(preview.disclosure.blindRollsIncluded, false);
});

test('sync preview requires a planned or active desktop session in the selected campaign', () => {
  const wrongCampaign = baseState();
  wrongCampaign.sessions[0].campaignId = 'campaign-other';
  assert.throws(() => buildAiGmSyncPreview(wrongCampaign, { campaignId: 'campaign-1', sessionId: 'session-1' }), /belonging to this campaign/i);
  const completed = baseState();
  completed.sessions[0].status = 'completed';
  assert.throws(() => buildAiGmSyncPreview(completed, { campaignId: 'campaign-1', sessionId: 'session-1' }), /planned or active/i);
});

test('binding fingerprint reports stale synchronized campaign copies deterministically', () => {
  const previewA = buildAiGmSyncPreview(baseState(), { campaignId: 'campaign-1', sessionId: 'session-1' });
  const previewB = buildAiGmSyncPreview(baseState(), { campaignId: 'campaign-1', sessionId: 'session-1' });
  assert.equal(previewA.contextFingerprint, previewB.contextFingerprint);
  const binding = normalizeBinding({
    campaignId: 'campaign-1', sessionId: 'session-1', endpoint: 'http://127.0.0.1:8787',
    serviceCampaignId: 'service-1', contextFingerprint: previewA.contextFingerprint
  });
  assert.equal(bindingIsStale(binding, previewA.contextFingerprint), false);
  const changed = baseState();
  changed.quests[0].summary = 'A newly changed quest summary.';
  const previewChanged = buildAiGmSyncPreview(changed, { campaignId: 'campaign-1', sessionId: 'session-1' });
  assert.notEqual(previewA.contextFingerprint, previewChanged.contextFingerprint);
  assert.equal(bindingIsStale(binding, previewChanged.contextFingerprint), true);
});

test('turn request preserves explicit table input and adds non-autonomous policy only', () => {
  const request = buildTurnRequest({
    actor: 'Vorkesh',
    message: 'I inspect the runes without touching the crucible.',
    dmGuidance: 'Foreshadow the lower vault.'
  });
  assert.equal(request.actor, 'Vorkesh');
  assert.equal(request.message, 'I inspect the runes without touching the crucible.');
  assert.match(request.dmGuidance, /Preserve player agency/);
  assert.match(request.dmGuidance, /Do not roll dice/);
  assert.match(request.dmGuidance, /Foreshadow the lower vault/);
});

test('recording a pending turn mutates only private AI GM state and deduplicates client turn IDs', () => {
  const state = stateWithAiSession();
  const campaignBefore = JSON.stringify(state.campaigns);
  const sessionsBefore = JSON.stringify(state.sessions);
  const first = recordPendingTurn(state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    clientTurnId: 'client-turn-1', actor: 'Vorkesh', message: 'I inspect the runes.'
  });
  assert.equal(first.turn.status, 'pending');
  assert.equal(first.duplicate, false);
  const second = recordPendingTurn(first.state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    clientTurnId: 'client-turn-1', actor: 'Vorkesh', message: 'I inspect the runes.'
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.state.aiGmTurns.length, 1);
  assert.equal(JSON.stringify(second.state.campaigns), campaignBefore);
  assert.equal(JSON.stringify(second.state.sessions), sessionsBefore);
});

test('completed turns retain structured review suggestions without mutating desktop campaign state', () => {
  const state = stateWithAiSession();
  const campaignBefore = JSON.stringify(state.campaigns);
  const sessionsBefore = JSON.stringify(state.sessions);
  const pending = recordPendingTurn(state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    clientTurnId: 'client-turn-2', actor: 'Vorkesh', message: 'I inspect the runes.'
  });
  const completed = completeTurn(pending.state, pending.turn.id, serviceTurn(), { playerCharacterNames: ['Vorkesh Emberforge'] });
  assert.equal(completed.turn.status, 'completed');
  assert.equal(completed.turn.response.safety.status, 'ok');
  assert.equal(completed.turn.response.suggestions.length, 4);
  assert.equal(completed.state.aiGmSessions[0].mode, 'active');
  assert.equal(JSON.stringify(completed.state.campaigns), campaignBefore);
  assert.equal(JSON.stringify(completed.state.sessions), sessionsBefore);
  assert.equal(completed.turn.response.suggestedChecks[0].dc, 15);
});

test('player agency guard rejects generated player dialogue and invented irreversible actions', () => {
  assert.throws(() => normalizeTurnResult(serviceTurn({
    spokenDialogue: [{ speaker: 'Vorkesh Emberforge', text: 'I accept the bargain.' }]
  }), { playerCharacterNames: ['Vorkesh Emberforge'] }), /write dialogue for player character/i);
  assert.throws(() => normalizeTurnResult(serviceTurn({
    narration: 'Vorkesh Emberforge decides to betray the party and accepts the bargain.'
  }), { playerCharacterNames: ['Vorkesh Emberforge'] }), /decide an action/i);
});

test('safety pause locks all further generation until an explicit reasoned resume', () => {
  const state = stateWithAiSession();
  const pending = recordPendingTurn(state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    clientTurnId: 'client-turn-pause', actor: 'Player', message: 'Red card. Stop this scene.'
  });
  const paused = completeTurn(pending.state, pending.turn.id, serviceTurn({
    safety: { status: 'pause', reason: 'A configured pause word was used.' },
    stateUpdates: { currentScene: '', addWorldFacts: [], addOpenThreads: [], resolveOpenThreads: [], addNotes: [] }
  }), { playerCharacterNames: ['Vorkesh Emberforge'] });
  assert.equal(paused.state.aiGmSessions[0].mode, 'paused');
  assert.equal(paused.state.aiGmSessions[0].safetyLocked, true);
  assert.throws(() => recordPendingTurn(paused.state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    actor: 'Party', message: 'Continue.'
  }), /paused by a safety lock/i);
  assert.throws(() => resumeAiGmSession(paused.state, 'ai-session-1', ''), /resumeReason is required/i);
  const resumed = resumeAiGmSession(paused.state, 'ai-session-1', 'The table changed the scene and confirmed readiness to continue.');
  assert.equal(resumed.session.mode, 'active');
  assert.equal(resumed.session.safetyLocked, false);
});

test('service failures preserve retryable local input and do not delete the turn', () => {
  const state = stateWithAiSession();
  const pending = recordPendingTurn(state, {
    aiGmSessionId: 'ai-session-1', serviceCampaignId: 'service-campaign-1',
    clientTurnId: 'client-turn-failure', actor: 'Vorkesh', message: 'I inspect the runes.',
    dmGuidance: 'Keep the scene unresolved.'
  });
  const failed = failTurn(pending.state, pending.turn.id, { message: 'Service unavailable.', retryable: true });
  assert.equal(failed.turn.status, 'failed');
  assert.equal(failed.turn.retryable, true);
  assert.equal(failed.turn.message, 'I inspect the runes.');
  assert.match(failed.turn.dmGuidance, /Keep the scene unresolved/);
  assert.equal(failed.turn.retryCount, 1);
});

test('service campaign routes are encoded and bounded', () => {
  assert.equal(campaignPath('campaign id/unsafe'), '/api/v1/campaigns/campaign%20id%2Funsafe');
  assert.equal(campaignTurnsPath('campaign id/unsafe'), '/api/v1/campaigns/campaign%20id%2Funsafe/turns');
});
