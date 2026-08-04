'use strict';

const assert = require('node:assert/strict');
const { ensureCoDmState } = require('../shared/dnd-co-dm.cjs');
const { DEFAULT_AI_SERVICE_ENDPOINT, serviceUrl } = require('../shared/dnd-ai-service.cjs');
const {
  AI_GM_SNAPSHOT,
  buildAiGmSyncPreview,
  normalizeBinding,
  normalizeAiGmSession,
  recordPendingTurn,
  completeTurn,
  resumeAiGmSession,
  ensureAiGmState,
  campaignPath,
  campaignTurnsPath
} = require('../shared/dnd-ai-gm.cjs');
const { applySelectedSuggestions } = require('../shared/dnd-ai-gm-actions.cjs');

const endpoint = process.env.KHAOS_AI_ENDPOINT || DEFAULT_AI_SERVICE_ENDPOINT;

async function jsonRequest(pathname, { method = 'GET', body = null } = {}) {
  const response = await fetch(serviceUrl(endpoint, pathname), {
    method,
    headers: {
      accept: 'application/json',
      ...(body === null ? {} : { 'content-type': 'application/json' }),
      'x-khaos-request-id': `ai-gm-integration-${Date.now()}`
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Khaos Nexus AI returned invalid JSON from ${pathname}: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`Khaos Nexus AI returned HTTP ${response.status} from ${pathname}: ${text.slice(0, 500)}`);
  return payload;
}

function integrationState() {
  return ensureAiGmState(ensureCoDmState({
    campaigns: [{
      id: 'ai-gm-integration-campaign',
      name: 'Emberforge AI GM Integration',
      description: 'A private cross-repository validation campaign.',
      ruleset: 'D&D 5e-compatible',
      contentRating: 'teen',
      tone: 'heroic dark fantasy',
      safety: {
        lines: ['No sexual violence'],
        veils: ['Graphic torture'],
        pauseWords: ['pause', 'red card']
      },
      coDmNotes: '',
      status: 'active',
      active: true
    }],
    members: [{ id: 'member-ai-gm', campaignId: 'ai-gm-integration-campaign', displayName: 'Private Owner Name', role: 'dm', active: true }],
    characters: [{
      id: 'character-ai-gm',
      campaignId: 'ai-gm-integration-campaign',
      playerName: 'Private Player Name',
      name: 'Vorkesh Emberforge',
      race: 'Dragonborn',
      className: 'Artificer',
      level: 7,
      notes: 'Arcane power glows through his scales.',
      active: true
    }],
    quests: [{ id: 'quest-ai-gm', campaignId: 'ai-gm-integration-campaign', title: 'Inspect the Ashen Forge', status: 'active', summary: 'Find the source of unstable runes.', active: true }],
    sessions: [{
      id: 'desktop-session-ai-gm',
      campaignId: 'ai-gm-integration-campaign',
      title: 'The Ashen Forge',
      status: 'planned',
      recapDraft: '',
      active: true
    }],
    npcs: [], locations: [], factions: [], encounters: [], sources: [], campaignSources: [], homebrew: [], rolls: [], registeredApps: [], bindings: [], panels: [], grants: [], channelContexts: [], audit: [], attendance: [], loot: [], combatants: [], contentEntries: []
  }));
}

async function main() {
  let state = integrationState();
  const preview = buildAiGmSyncPreview(state, {
    campaignId: 'ai-gm-integration-campaign',
    sessionId: 'desktop-session-ai-gm',
    contextOptions: {
      includeCharacterDetails: true,
      includeEncounterDetails: true,
      includeSessionRecaps: true,
      includeGmNotes: false,
      includeApprovedHomebrew: false,
      includePublicRolls: false
    }
  });

  assert.equal(AI_GM_SNAPSHOT, '5524dcbda06c70a51774bdc843a2f9e739f7ba50');
  assert.equal(preview.request.mode, 'gm');
  assert.equal(preview.disclosure.explicitSynchronizationOnly, true);
  assert.equal(preview.disclosure.automaticDesktopMutation, false);
  assert.equal(preview.disclosure.automaticDiscordPublication, false);
  assert.equal(preview.disclosure.automaticRolls, false);
  const serializedPreview = JSON.stringify(preview);
  assert.doesNotMatch(serializedPreview, /character-ai-gm|member-ai-gm|Private Player Name|Private Owner Name/);
  assert.match(serializedPreview, /Vorkesh Emberforge/);
  assert.match(serializedPreview, /No sexual violence/);

  const createdPayload = await jsonRequest('/api/v1/campaigns', { method: 'POST', body: preview.request });
  const serviceCampaign = createdPayload.campaign;
  assert.match(serviceCampaign.id, /^[0-9a-f-]{36}$/i);
  assert.equal(serviceCampaign.mode, 'gm');
  assert.equal(serviceCampaign.playerCharacters[0].name, 'Vorkesh Emberforge');

  const binding = normalizeBinding({
    campaignId: preview.campaignId,
    sessionId: preview.sessionId,
    endpoint,
    serviceCampaignId: serviceCampaign.id,
    contextFingerprint: preview.contextFingerprint,
    contextOptions: preview.contextOptions,
    playerCharacterNames: preview.playerCharacterNames,
    serviceVersion: '0.1.0',
    provider: 'mock',
    model: 'deterministic-local'
  });
  state.aiGmBindings.push(binding);
  const aiSession = normalizeAiGmSession({
    campaignId: preview.campaignId,
    desktopSessionId: preview.sessionId,
    bindingId: binding.id,
    mode: 'ready'
  });
  state.aiGmSessions.push(aiSession);
  ensureAiGmState(state);

  const desktopCampaignBeforeTurn = JSON.stringify(state.campaigns);
  const desktopSessionsBeforeTurn = JSON.stringify(state.sessions);
  const pending = recordPendingTurn(state, {
    aiGmSessionId: aiSession.id,
    serviceCampaignId: serviceCampaign.id,
    clientTurnId: 'integration-turn-search',
    actor: 'Party',
    message: 'Search the ruined forge for hidden runes.',
    dmGuidance: 'Keep the final outcome unresolved until the table rolls.'
  });
  state = pending.state;
  assert.equal(pending.turn.status, 'pending');
  assert.ok(state.aiGmTurns.some((item) => item.id === pending.turn.id && item.message.includes('hidden runes')));

  const generatedPayload = await jsonRequest(campaignTurnsPath(serviceCampaign.id), { method: 'POST', body: pending.request });
  const completed = completeTurn(state, pending.turn.id, generatedPayload, { playerCharacterNames: preview.playerCharacterNames });
  state = completed.state;
  assert.equal(completed.turn.status, 'completed');
  assert.ok(completed.turn.response.narration.length > 20);
  assert.equal(completed.turn.response.suggestedChecks.length, 1);
  assert.equal(completed.turn.response.suggestedChecks[0].dc, 13);
  assert.ok(completed.turn.response.suggestions.length > 0);
  assert.equal(JSON.stringify(state.campaigns), desktopCampaignBeforeTurn);
  assert.equal(JSON.stringify(state.sessions), desktopSessionsBeforeTurn);

  const suggestionId = completed.turn.response.suggestions[0].id;
  const applied = applySelectedSuggestions(state, {
    turnId: completed.turn.id,
    target: 'campaign_codm_notes',
    suggestionIds: [suggestionId]
  });
  state = applied.state;
  assert.equal(applied.duplicate, false);
  assert.match(state.campaigns[0].coDmNotes, /AI Game Master suggestions/);
  const duplicate = applySelectedSuggestions(state, {
    turnId: completed.turn.id,
    target: 'campaign_codm_notes',
    suggestionIds: [suggestionId]
  });
  assert.equal(duplicate.duplicate, true);

  const pausePending = recordPendingTurn(state, {
    aiGmSessionId: aiSession.id,
    serviceCampaignId: serviceCampaign.id,
    clientTurnId: 'integration-turn-pause',
    actor: 'Party',
    message: 'Pause the scene now.',
    dmGuidance: ''
  });
  state = pausePending.state;
  const pausePayload = await jsonRequest(campaignTurnsPath(serviceCampaign.id), { method: 'POST', body: pausePending.request });
  const paused = completeTurn(state, pausePending.turn.id, pausePayload, { playerCharacterNames: preview.playerCharacterNames });
  state = paused.state;
  const pausedSession = state.aiGmSessions.find((item) => item.id === aiSession.id);
  assert.equal(pausedSession.mode, 'paused');
  assert.equal(pausedSession.safetyLocked, true);
  assert.equal(paused.turn.response.safety.status, 'pause');
  assert.throws(() => recordPendingTurn(state, {
    aiGmSessionId: aiSession.id,
    serviceCampaignId: serviceCampaign.id,
    actor: 'Party',
    message: 'Continue without a resume.'
  }), /safety lock/i);

  const resumed = resumeAiGmSession(state, aiSession.id, 'The table reviewed the pause and explicitly agreed to continue with a different approach.');
  state = resumed.state;
  assert.equal(resumed.session.mode, 'active');
  assert.equal(resumed.session.safetyLocked, false);
  assert.match(resumed.session.safetyReason, /explicitly agreed/);

  const fetchedPayload = await jsonRequest(campaignPath(serviceCampaign.id));
  assert.equal(fetchedPayload.campaign.mode, 'gm');
  assert.equal(fetchedPayload.campaign.transcript.length, 2);
  assert.equal(fetchedPayload.campaign.transcript[1].result.safety.status, 'pause');

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    serviceSnapshot: AI_GM_SNAPSHOT,
    serviceCampaignId: serviceCampaign.id,
    mode: fetchedPayload.campaign.mode,
    provider: generatedPayload.meta?.provider,
    model: generatedPayload.meta?.model,
    persistedBeforeNetwork: true,
    unresolvedChecks: completed.turn.response.suggestedChecks.length,
    explicitSuggestionApplication: applied.applied.length,
    duplicateApplicationBlocked: duplicate.duplicate,
    safetyLockVerified: true,
    explicitResumeVerified: true,
    protectedIdentifiersExcluded: true,
    automaticDesktopMutation: false,
    automaticDiscordPublication: false,
    automaticRolls: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
