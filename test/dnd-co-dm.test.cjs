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
  buildOpenAiRequest,
  parseOpenAiResponse,
  sanitizeProviderError,
  normalizeDraft
} = require('../shared/dnd-co-dm.cjs');
const { callOpenAi, OPENAI_RESPONSES_ENDPOINT } = require('../main/dnd-co-dm-extension.cjs');

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

test('Co-DM request disables provider storage and has no tools or autonomous action claim', () => {
  const state = campaignState();
  const context = buildCampaignContext(state, 'c1');
  const request = buildOpenAiRequest(state.coDmSettings, { campaignId: 'c1', workflow: 'session_prep', prompt: 'Prepare the next session.' }, context);
  assert.equal(request.store, false);
  assert.equal(request.model, 'gpt-5-mini');
  assert.equal('tools' in request, false);
  assert.match(request.instructions, /not an autonomous action/i);
  assert.match(request.instructions, /untrusted reference data/i);
  assert.match(request.input[0].content[0].text, /Prepare the next session/);
});

test('OpenAI response parsing supports output_text and nested output content', () => {
  assert.equal(parseOpenAiResponse({ output_text: 'Draft one' }), 'Draft one');
  assert.equal(parseOpenAiResponse({ output: [{ content: [{ type: 'output_text', text: 'Draft two' }] }] }), 'Draft two');
  assert.throws(() => parseOpenAiResponse({ output: [] }), /no draft text/i);
});

test('provider errors redact protected API keys', () => {
  const key = 'sk-project-super-secret-key-value';
  const error = sanitizeProviderError(new Error(`Authorization: Bearer ${key}`), key);
  assert.doesNotMatch(error.message, /super-secret-key-value/);
  assert.match(error.message, /REDACTED/);
});

test('provider call uses fixed Responses endpoint, store false body, and returns parsed JSON', async () => {
  let request = null;
  const payload = await callOpenAi('sk-project-example-key-value', { model: 'gpt-5-mini', store: false, input: 'Hello' }, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: 'Ready' }) };
  });
  assert.equal(request.url, OPENAI_RESPONSES_ENDPOINT);
  assert.equal(request.options.method, 'POST');
  assert.match(request.options.headers.authorization, /^Bearer sk-/);
  assert.equal(JSON.parse(request.options.body).store, false);
  assert.equal(payload.output_text, 'Ready');
});

test('readiness reports provider, campaign data, Discord binding, panel, and session state', () => {
  const value = buildReadiness(campaignState(), 'c1', { provider: 'OpenAI', model: 'gpt-5-mini', hasApiKey: true });
  assert.equal(value.totalCount, 10);
  assert.equal(value.ready, true);
  assert.ok(value.checks.every((item) => typeof item.ready === 'boolean'));
});

test('drafts are bounded local records and workflows are complete', () => {
  assert.deepEqual(Object.keys(CO_DM_WORKFLOWS).sort(), ['encounter_review', 'npc_dialogue', 'rules_research', 'session_prep', 'session_recap', 'world_hooks']);
  const draft = normalizeDraft({ campaignId: 'c1', workflow: 'npc_dialogue', content: 'Roleplay notes', title: 'Mara' });
  assert.equal(draft.campaignId, 'c1');
  assert.equal(draft.content, 'Roleplay notes');
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

test('renderer remains explicit-action only and has no Discord publication channel', () => {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-co-dm.js'), 'utf8');
  assert.doesNotMatch(renderer, /setInterval/);
  assert.doesNotMatch(renderer, /status-panels:publish|discord-studio:publish-panel|dnd:panel-refresh/i);
  assert.match(renderer, /Generate Draft/);
  assert.match(renderer, /win\.confirm/);

  const extension = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-extension.cjs'), 'utf8');
  assert.match(extension, /OPENAI_RESPONSES_ENDPOINT/);
  assert.match(extension, /getDndCoDmApiKey/);
  assert.match(extension, /storeProviderResponses: false/);
  assert.doesNotMatch(extension, /web_search|computer_use|function_call/);
});

test('persistence guard preserves campaign notes and excludes the Co-DM key from backups', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-co-dm-persistence-extension.cjs'), 'utf8');
  assert.match(source, /upsertDndCampaign\(input/);
  assert.match(source, /campaign\.coDmNotes/);
  assert.match(source, /delete sanitized\.dndCoDmOpenAiKey/);
  assert.match(source, /intentionally excluded from backups/);
});
