'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  activeSourceIds,
  filterCampaignSourceState,
  install
} = require('../shared/dnd-content-source-authority.cjs');

function state() {
  return {
    campaigns: [{ id: 'c1', name: 'Emberfall', active: true }],
    members: [{ id: 'm1', campaignId: 'c1', displayName: 'GM', role: 'dm', active: true }],
    characters: [{ id: 'ch1', campaignId: 'c1', name: 'Vorkesh', active: true }],
    sessions: [{ id: 's1', campaignId: 'c1', title: 'Next Session', status: 'planned' }],
    sources: [
      { id: 'active-source', name: 'Active Rules', active: true },
      { id: 'removed-source', name: 'Removed Rules', active: false },
      { id: 'legacy-disabled-source', name: 'Legacy Disabled Rules', enabled: false }
    ],
    campaignSources: [
      { id: 'cs1', campaignId: 'c1', sourceId: 'active-source', enabled: true },
      { id: 'cs2', campaignId: 'c1', sourceId: 'removed-source', enabled: true },
      { id: 'cs3', campaignId: 'c1', sourceId: 'legacy-disabled-source', enabled: true }
    ],
    homebrew: [
      { id: 'h1', campaignId: 'c1', name: 'Approved Rule', status: 'approved', body: { description: 'Allowed homebrew.' } },
      { id: 'h2', campaignId: 'c1', name: 'Draft Rule', status: 'draft', body: { description: 'Must stay private.' } },
      { id: 'h3', campaignId: 'other', name: 'Other Campaign Rule', status: 'approved', body: { description: 'Must stay isolated.' } }
    ],
    registeredApps: [{ id: 'bot', enabled: true, modules: ['dnd-workspace'] }],
    bindings: [{ id: 'b1', campaignId: 'c1', active: true }],
    panels: [{ id: 'p1', bindingId: 'b1', active: true, messageId: '12345' }],
    quests: [], npcs: [], locations: [], factions: [], encounters: [], rolls: [], combatants: [], attendance: [], loot: [], grants: [], channelContexts: [], audit: []
  };
}

test('campaign source authority excludes removed and legacy-disabled sources', () => {
  const input = state();
  assert.deepEqual([...activeSourceIds(input)], ['active-source']);
  const filtered = filterCampaignSourceState(input);
  assert.deepEqual(filtered.campaignSources.map((item) => item.sourceId), ['active-source']);
  assert.equal(input.campaignSources.length, 3, 'authority filtering must not mutate persisted state');
});

test('installed authority prevents inactive source metadata from reaching Veyra and readiness', () => {
  install();
  const { buildCampaignContext, buildReadiness } = require('../shared/dnd-co-dm.cjs');
  const input = state();
  const context = buildCampaignContext(input, 'c1', { includeApprovedHomebrew: true });
  assert.match(context.text, /Active Rules/);
  assert.doesNotMatch(context.text, /Removed Rules|Legacy Disabled Rules/);
  assert.match(context.text, /Approved Rule|Allowed homebrew/);
  assert.doesNotMatch(context.text, /Draft Rule|Must stay private|Other Campaign Rule|Must stay isolated/);

  const readiness = buildReadiness(input, 'c1', {
    reachable: true,
    provider: 'test',
    model: 'test',
    dedicatedDrafts: true
  });
  const sourceCheck = readiness.checks.find((item) => item.id === 'sources');
  assert.equal(sourceCheck.ready, true);
  assert.match(sourceCheck.detail, /^1 source\(s\) enabled/);
});

test('packaged startup installs source authority before Co-DM captures context builders', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const authority = entry.indexOf("require('../shared/dnd-content-source-authority.cjs').install()");
  const coDm = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  assert.ok(authority >= 0);
  assert.ok(coDm > authority);
});
