'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const { campaignContentContext } = require('../shared/dnd-content-authority.cjs');

function readyState() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [{ id: 'character-1', campaignId: 'campaign-1', name: 'Vorkesh', active: true, hp: 20, maxHp: 20, armorClass: 16, level: 3, className: 'Artificer', conditions: [] }],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: [],
    sources: [], campaignSources: [], contentEntries: [], homebrew: []
  };
  runtime.ensureCampaignRuntimeState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, { campaignId: 'campaign-1', enabled: true, mode: 'group_ai_dm', pace: 'live', automationLevel: 'narration_and_npcs' });
  const seat = runtime.upsertPlayerSeat(state, { campaignId: 'campaign-1', memberId: 'member-1', characterId: 'character-1', type: 'human_player', displayName: 'Kirito', ready: true });
  const run = runtime.startCampaignRun(state, { campaignId: 'campaign-1', actorId: 'owner', worldTime: 'Day 1' });
  const scene = runtime.startScene(state, { campaignId: 'campaign-1', runId: run.id, actorId: 'owner', locationName: 'Forge', publicDescription: 'The forge burns.', participantSeatIds: [seat.id] });
  const turn = runtime.openTurnCycle(state, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, requiredSeatIds: [seat.id] });
  const submitted = runtime.submitTurnAction(state, { turnCycleId: turn.id, seatId: seat.id, characterId: 'character-1', text: 'I inspect the runes.', clientActionId: 'content-action' });
  runtime.lockTurnAction(state, { turnCycleId: turn.id, actionId: submitted.action.id });
  return { state, run, scene, turn };
}

function source(id, overrides = {}) {
  return {
    id,
    name: id,
    ruleset: '5e_2024',
    sourceVersion: '1',
    licenseType: 'user_authored',
    attributionText: 'Test source.',
    isFullTextAllowed: true,
    active: true,
    metadata: { kind: 'homebrew_source', visibility: 'campaign' },
    ...overrides
  };
}

test('Veyra receives only enabled campaign-eligible sources and approved homebrew', () => {
  const { state, run, scene, turn } = readyState();
  state.sources.push(
    source('enabled-source'),
    source('disabled-source'),
    source('private-source', { metadata: { kind: 'homebrew_source', visibility: 'private' } }),
    source('inactive-source', { active: false })
  );
  state.campaignSources.push(
    { id: 'cs-1', campaignId: 'campaign-1', sourceId: 'enabled-source', enabled: true },
    { id: 'cs-2', campaignId: 'campaign-1', sourceId: 'disabled-source', enabled: false },
    { id: 'cs-3', campaignId: 'campaign-1', sourceId: 'private-source', enabled: true },
    { id: 'cs-4', campaignId: 'campaign-1', sourceId: 'inactive-source', enabled: true }
  );
  state.contentEntries.push(
    { id: 'entry-ok', sourceId: 'enabled-source', campaignId: '', name: 'Rune Law', contentType: 'rule', summary: 'Campaign-safe rule.', fullText: 'Allowed text.', contentOrigin: 'user_authored', active: true },
    { id: 'entry-other-campaign', sourceId: 'enabled-source', campaignId: 'campaign-2', name: 'Other Secret', summary: 'Do not hydrate.', active: true },
    { id: 'entry-disabled', sourceId: 'disabled-source', campaignId: 'campaign-1', name: 'Disabled Rule', summary: 'Do not hydrate.', active: true },
    { id: 'entry-private', sourceId: 'private-source', campaignId: 'campaign-1', name: 'Private Notes', summary: 'Do not hydrate.', active: true }
  );
  state.homebrew.push(
    { id: 'brew-approved', campaignId: 'campaign-1', status: 'approved', name: 'Ember Blade', contentType: 'item', body: { description: 'Approved campaign item.' }, revision: 2, approvedAt: '2026-09-04T00:00:00Z' },
    { id: 'brew-draft', campaignId: 'campaign-1', status: 'draft', name: 'Draft Spell', contentType: 'spell', body: { description: 'Do not hydrate.' } },
    { id: 'brew-other', campaignId: 'campaign-2', status: 'approved', name: 'Other Campaign', contentType: 'item', body: { description: 'Do not hydrate.' } }
  );

  const envelope = runtime.buildVeyraRuntimeEnvelope(state, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, turnCycleId: turn.id });
  assert.deepEqual(envelope.content.sources.map((item) => item.id), ['enabled-source']);
  assert.deepEqual(envelope.content.entries.map((item) => item.id), ['entry-ok']);
  assert.deepEqual(envelope.content.homebrew.map((item) => item.id), ['brew-approved']);
  const serialized = JSON.stringify(envelope.content);
  assert.match(serialized, /Campaign-safe rule/);
  assert.match(serialized, /Approved campaign item/);
  assert.doesNotMatch(serialized, /Other Secret|Disabled Rule|Private Notes|Draft Spell|Other Campaign/);
});

test('conflicting duplicate campaign source selections fail closed', () => {
  const state = {
    sources: [source('ambiguous-source')],
    campaignSources: [
      { id: 'cs-a', campaignId: 'campaign-1', sourceId: 'ambiguous-source', enabled: true },
      { id: 'cs-b', campaignId: 'campaign-1', sourceId: 'ambiguous-source', enabled: false }
    ],
    contentEntries: [{ id: 'entry-ambiguous', sourceId: 'ambiguous-source', campaignId: 'campaign-1', name: 'Ambiguous', summary: 'Must not hydrate.', active: true }],
    homebrew: []
  };
  const context = campaignContentContext(state, 'campaign-1');
  assert.deepEqual(context.sources, []);
  assert.deepEqual(context.entries, []);
});

test('runtime content projection strips authority metadata and refuses stale unauthorized full text', () => {
  const state = {
    sources: [source('metadata-source', { isFullTextAllowed: false })],
    campaignSources: [{ id: 'cs-1', campaignId: 'campaign-1', sourceId: 'metadata-source', enabled: true }],
    contentEntries: [{ id: 'entry-1', sourceId: 'metadata-source', campaignId: 'campaign-1', name: 'Metadata Entry', summary: 'Safe summary.', fullText: 'Stale full text must not hydrate.', active: true }],
    homebrew: [{ id: 'brew-1', campaignId: 'campaign-1', status: 'approved', name: 'Approved', body: { description: 'Safe.' }, reviewNotes: 'GM-only review notes', approvedBy: 'private-owner-id' }]
  };
  const context = campaignContentContext(state, 'campaign-1');
  assert.equal(context.entries[0].fullText, '');
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /Stale full text must not hydrate|GM-only review notes|private-owner-id/);
});
