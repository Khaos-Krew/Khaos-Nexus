'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CO_DM_WORKFLOWS,
  ensureCoDmState,
  buildCampaignContext,
  buildReadiness,
  normalizeDraft
} = require('../shared/dnd-co-dm.cjs');
const {
  DEFAULT_AI_SERVICE_ENDPOINT,
  normalizeEndpoint,
  normalizeHealth,
  contextFingerprint,
  buildDedicatedDraftRequest,
  buildLegacyCampaignRequest,
  buildLegacyTurnRequest,
  parseDedicatedDraftResponse,
  parseLegacyCampaignResponse,
  parseLegacyTurnResponse,
  sanitizeServiceError
} = require('../shared/dnd-ai-service.cjs');
const { callAiService } = require('../main/dnd-co-dm-extension.cjs');

function campaignState() {
  return ensureCoDmState({
    campaigns: [{ id: 'c1', name: 'Emberfall', description: 'A city threatened by ash storms.', status: 'active', ruleset: '5.5e', active: true }],
    members: [{ id: 'm1', campaignId: 'c1', userId: '1234567890', discordId: '987654321', displayName: 'Game Master', role: 'dm', active: true }],
    characters: [{ id: 'ch1', campaignId: 'c1', name: 'Vorkesh', race: 'Dragonborn', className: 'Artificer', level: 7, hp: 48, maxHp: 52, armorClass: 18, discordUserId: 'private-id', active: true }],
    quests: [{ id: 'q1', campaignId: 'c1', title: 'Find the Ember Forge', status: 'active', summary: 'Locate the lost forge.', gmNotes: 'The patron is secretly the villain.', active: true }],
    npcs: [{ id: 'n1', campaignId: 'c1', name: 'Mara', publicSummary: 'A guarded smith.', gmNotes: 'Mara knows the hidden route.', archived: false }],
    locations: [{ id: 'l1', campaignId: 'c1', name: 'Ash Market', publicSummary: 'A crowded bazaar.', gmNotes: 'Smugglers meet below.', archived: false }],
    factions: [],
    encounters: [{ id: 'e1', campaignId: 'c1', name: 'Forge Guardians', status: 'planned', difficulty: 'hard', active: true }],
    sessions: [{ id: 's1', campaignId: 'c1', title: 'Session 4', status: 'planned', startsAt: '2026-08-10T00:00:00Z', recapDraft: 'The party reached the market.' }],
    sources: [{ id: 'src1', name: 'Core Rules', edition: '2024', licenseType: 'licensed', metadataOnly: true, fullText: 'COPYRIGHTED FULL BOOK TEXT', enabled: true }],
    campaignSources: [{ id: 'cs1', campaignId: 'c1', sourceId: 'src1', enabled: true }],
    homebrew: [{ id: 'h1', campaignId: 'c1', title: 'Ember Infusion', status: 'approved', body: 'A local approved infusion rule.' }],
    rolls: [
      { id: 'r1', campaignId: 'c1', notation: '1d20+5', total: 18, blind: false, visibility: 'public' },
      { id: 'r2', campaignId: 'c1', notation: '1d20+9', total: 27, blind: true, visibility: 'dm', secretToken: 'never-include' }
    ],
    registeredApps: [{ id: 'nexus-bot', name: 'Nexus Bot', enabled: true, modules: ['dnd-workspace'], applicationId: 'private-app-id' }],
    bindings: [{ id: 'b1', campaignId: 'c1', active: true, guildId: 'private-guild', channelId: 'private-channel' }],
    panels: [{ id: 'p1', bindingId: 'b1', active: true, messageId: 'private-message' }],
    grants: [{ id: 'g1', campaignId: 'c1', guildId: 'private-guild' }],
    channelContexts: [],
    audit: [{ id: 'a1', action: 'secret-audit', metadata: { token: 'never-include' } }],
    attendance: [],
    loot: [],
    combatants: [],
    contentEntries: []
  });
}

test('Co-DM context excludes infrastructure IDs, blind rolls, audits, and licensed full text', () => {
  const context = buildCampaignContext(campaignState(), 'c1', {
    includeGmNotes: false,
    includeApprovedHomebrew: false,
    includePublicRolls: true
  });
  assert.match(context.text, /Vorkesh/);
  assert.match(context.text, /1d20\+5/);
  assert.doesNotMatch(context.text, /1d20\+9/);
  assert.doesNotMatch(context.text, /private-guild|private-channel|private-message|private-app-id|private-id/);
  assert.doesNotMatch(context.text, /secret-audit|never-include/);
  assert.doesNotMatch(context.text, /COPYRIGHTED FULL BOOK TEXT/);
  assert.doesNotMatch(context.text, /patron is secretly|hidden route|Smugglers meet/);
  assert.ok(context.characters <= context.characterLimit);
});

test('GM notes and approved homebrew require explicit inclusion', () => {
  const context = buildCampaignContext(campaignState(), 'c1', { includeGmNotes: true, includeApprovedHomebrew: true });
  assert.match(context.text, /patron is secretly the villain/);
  assert.match(context.text, /Mara knows the hidden route/);
  assert.match(context.text, /Ember Infusion/);
  assert.match(context.text, /local approved infusion rule/);
});

test('AI service endpoints allow loopback HTTP and require HTTPS remotely', () => {
  assert.equal(normalizeEndpoint('http://127.0.0.1:8787/'), DEFAULT_AI_SERVICE_ENDPOINT);
  assert.equal(normalizeEndpoint('https://ai.khaos.example/api/'), 'https://ai.khaos.example/api');
  assert.throws(() => normalizeEndpoint('http://ai.khaos.example'), /must use HTTPS/i);
  assert.throws(() => normalizeEndpoint('https://user:pass@ai.khaos.example'), /cannot contain credentials/i);
});

test('current Khaos Nexus AI health contract is recognized as campaign-turn compatibility', () => {
  const value = normalizeHealth({ status: 'ok', service: 'khaos-nexus-ai', provider: 'mock', model: 'deterministic-mock' }, DEFAULT_AI_SERVICE_ENDPOINT);
  assert.equal(value.reachable, true);
  assert.equal(value.legacyCampaignTurns, true);
  assert.equal(value.dedicatedDrafts, false);
  assert.ok(value.capabilities.includes('dnd.campaign.turn'));
});

test('dedicated Co-DM request contains bounded context and prohibits autonomous behavior', () => {
  const state = campaignState();
  const context = buildCampaignContext(state, 'c1');
  const request = buildDedicatedDraftRequest(state.coDmSettings, { campaignId: 'c1', workflow: 'session_prep', prompt: 'Prepare the next session.' }, context);
  assert.equal(request.apiVersion, '1');
  assert.equal(request.workflow, 'session_prep');
  assert.equal(request.policy.explicitUserAction, true);
  assert.equal(request.policy.autonomousActionsAllowed, false);
  assert.equal(request.policy.providerStorageAllowed, false);
  assert.equal(request.policy.toolsAllowed, false);
  assert.match(request.context.text, /Vorkesh/);
  assert.doesNotMatch(JSON.stringify(request), /private-guild|COPYRIGHTED FULL BOOK TEXT/);
});

test('legacy AI campaign adapter matches the current service MVP without provider credentials', () => {
  const state = campaignState();
  const context = buildCampaignContext(state, 'c1');
  const request = buildLegacyCampaignRequest(state, 'c1', context);
  assert.equal(request.mode, 'co-dm');
  assert.equal(request.name, 'Emberfall — Khaos Nexus Desktop');
  assert.equal(request.playerCharacters[0].name, 'Vorkesh');
  assert.ok(request.lore.length > 0);
  assert.doesNotMatch(JSON.stringify(request), /private-guild|private-channel|COPYRIGHTED FULL BOOK TEXT/);
  assert.equal('apiKey' in request, false);
  assert.equal('provider' in request, false);
});

test('legacy turn adapter and structured result formatter create a reviewable local draft', () => {
  const turn = buildLegacyTurnRequest(CO_DM_WORKFLOWS.session_prep, { prompt: 'Prepare the next session.' });
  assert.equal(turn.actor, 'Khaos Nexus Owner');
  assert.match(turn.dmGuidance, /reviewable material only/i);
  const parsed = parseLegacyTurnResponse({
    result: {
      narration: 'The party arrives at the Ash Market.',
      spokenDialogue: [{ speaker: 'Mara', text: 'The forge is not what it seems.' }],
      suggestedChecks: [{ character: 'Vorkesh', ability: 'Intelligence', skill: 'Arcana', dc: 15, reason: 'Read the runes.' }],
      choices: ['Inspect the forge', 'Question Mara'],
      stateUpdates: { currentScene: 'Ash Market', addWorldFacts: ['The runes are draconic.'], addOpenThreads: [], resolveOpenThreads: [], addNotes: [] },
      safety: { status: 'ok', reason: '' }
    },
    meta: { provider: 'mock', model: 'deterministic-mock' }
  });
  assert.match(parsed.content, /Ash Market/);
  assert.match(parsed.content, /## Dialogue/);
  assert.match(parsed.content, /## Suggested Checks/);
  assert.match(parsed.content, /## Suggested Campaign Updates/);
  assert.equal(parsed.provider, 'mock');
});

test('dedicated and legacy service responses require valid draft and campaign IDs', () => {
  assert.equal(parseDedicatedDraftResponse({ draft: { content: 'Draft one', model: 'service/model' } }).content, 'Draft one');
  assert.throws(() => parseDedicatedDraftResponse({ draft: {} }), /no Co-DM draft/i);
  assert.equal(parseLegacyCampaignResponse({ campaign: { id: '11111111-1111-1111-1111-111111111111' } }).id, '11111111-1111-1111-1111-111111111111');
  assert.throws(() => parseLegacyCampaignResponse({ campaign: {} }), /campaign ID/i);
});

test('service errors redact protected service tokens', () => {
  const token = 'desktop-service-token-value';
  const error = sanitizeServiceError(new Error(`Authorization: Bearer ${token}`), token);
  assert.doesNotMatch(error.message, /desktop-service-token-value/);
  assert.match(error.message, /REDACTED/);
});

test('service client uses configured Khaos Nexus AI endpoint and optional service token', async () => {
  let request = null;
  const result = await callAiService('http://127.0.0.1:8787', '/health', {
    token: 'local-service-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ status: 'ok', service: 'khaos-nexus-ai', provider: 'mock' })
      };
    }
  });
  assert.equal(request.url, 'http://127.0.0.1:8787/health');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.authorization, 'Bearer local-service-token');
  assert.equal(result.payload.service, 'khaos-nexus-ai');
});

test('context fingerprints are stable and change with selected context', () => {
  const base = buildCampaignContext(campaignState(), 'c1', { includeGmNotes: false });
  const same = buildCampaignContext(campaignState(), 'c1', { includeGmNotes: false });
  const changed = buildCampaignContext(campaignState(), 'c1', { includeGmNotes: true });
  assert.equal(contextFingerprint(base), contextFingerprint(same));
  assert.notEqual(contextFingerprint(base), contextFingerprint(changed));
});

test('readiness reports AI service, campaign data, Discord binding, panel, and session state', () => {
  const value = buildReadiness(campaignState(), 'c1', {
    reachable: true,
    endpoint: DEFAULT_AI_SERVICE_ENDPOINT,
    service: 'khaos-nexus-ai',
    provider: 'mock',
    model: 'deterministic-mock',
    dedicatedDrafts: true,
    legacyCampaignTurns: true
  });
  assert.equal(value.totalCount, 11);
  assert.equal(value.ready, true);
  assert.ok(value.checks.every((item) => typeof item.ready === 'boolean'));
});

test('drafts are bounded local records and workflows are complete', () => {
  assert.deepEqual(Object.keys(CO_DM_WORKFLOWS).sort(), ['encounter_review', 'npc_dialogue', 'rules_research', 'session_prep', 'session_recap', 'world_hooks']);
  const draft = normalizeDraft({ campaignId: 'c1', workflow: 'npc_dialogue', content: 'Roleplay notes', title: 'Mara', provider: 'mock', model: 'deterministic-mock' });
  assert.equal(draft.campaignId, 'c1');
  assert.equal(draft.content, 'Roleplay notes');
  assert.equal(draft.provider, 'mock');
  assert.match(draft.id, /^codm_draft_/);
});

test('entry loads Co-DM persistence and stability after context providers', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const worldIndex = entry.indexOf("require('./dnd-world-content-extension.cjs').install()");
  const panelIndex = entry.indexOf("require('./dnd-encounter-panels-extension.cjs').install()");
  const coDmIndex = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  const persistenceIndex = entry.indexOf("require('./dnd-co-dm-persistence-extension.cjs').install()");
  const stabilityIndex = entry.indexOf("require('./dnd-co-dm-stability-extension.cjs').install()");
  assert.ok(worldIndex >= 0);
  assert.ok(panelIndex > worldIndex);
  assert.ok(coDmIndex > panelIndex);
  assert.ok(persistenceIndex > coDmIndex);
  assert.ok(stabilityIndex > persistenceIndex);
});

test('desktop Co-DM contains no direct OpenAI provider path or Discord publication channel', () => {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-co-dm.js'), 'utf8');
  const extension = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-extension.cjs'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'shared', 'dnd-ai-service.cjs'), 'utf8');
  const combined = `${renderer}\n${extension}\n${service}`;
  assert.doesNotMatch(renderer, /setInterval/);
  assert.doesNotMatch(renderer, /status-panels:publish|discord-studio:publish-panel|dnd:panel-refresh/i);
  assert.match(renderer, /Khaos Nexus AI/);
  assert.match(renderer, /compatibility mode stores a synchronized campaign copy/i);
  assert.doesNotMatch(combined, /api\.openai\.com|OPENAI_API_KEY|getDndCoDmApiKey|OpenAiProvider/);
  assert.match(extension, /DRAFTS_PATH/);
  assert.match(extension, /allowLegacyCampaignPersistence/);
});

test('persistence guard preserves notes and excludes AI service secrets from backups', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-persistence-extension.cjs'), 'utf8');
  assert.match(source, /upsertDndCampaign\(input/);
  assert.match(source, /campaign\.coDmNotes/);
  assert.match(source, /delete sanitized\.dndAiServiceToken/);
  assert.match(source, /delete sanitized\.dndCoDmOpenAiKey/);
  assert.match(source, /AI service token is intentionally excluded from backups/);
});
