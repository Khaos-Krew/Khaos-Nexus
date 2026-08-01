'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DndCampaignService } = require('../main/services/dnd-campaign-service.cjs');
const { defaultDndState, normalizeBinding } = require('../shared/dnd-discord.cjs');

const snowflake = (n) => String(100000000000000000n + BigInt(n));

function storeWith(state = defaultDndState()) {
  return {
    state,
    getDndState() { return JSON.parse(JSON.stringify(this.state)); },
    getDiscordAppToken() { return 'protected-token'; },
    upsertDndBinding(binding) { this.state.bindings.push(binding); return binding; },
    upsertDndPanel(panel) { const i = this.state.panels.findIndex((item) => item.bindingId === panel.bindingId); if (i >= 0) this.state.panels[i] = panel; else this.state.panels.push(panel); return panel; },
    appendDndAudit() { return true; }
  };
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => payload === null ? '' : JSON.stringify(payload) };
}

test('default setup creates no Discord resource and performs no network request', async () => {
  const store = storeWith();
  const service = new DndCampaignService({ configStore: store, logger: console });
  let calls = 0;
  const original = global.fetch;
  global.fetch = async () => { calls += 1; return response(500, {}); };
  try {
    const result = await service.saveSetup({ mode: 'none' });
    assert.deepEqual(result, { mode: 'none', createdCount: 0, binding: null });
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});

test('explicit thread creation creates exactly one resource', async () => {
  const store = storeWith();
  const service = new DndCampaignService({ configStore: store, logger: console });
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'POST') return response(201, { id: snowflake(5), parent_id: snowflake(2), name: 'Campaign' });
    return response(200, { id: snowflake(5), guild_id: snowflake(1), parent_id: snowflake(2), name: 'Campaign', type: 11 });
  };
  try {
    const result = await service.saveSetup({
      mode: 'create-thread', confirmed: true, campaignId: 'c1', appId: 'a1', guildId: snowflake(1),
      parentChannelId: snowflake(2), name: 'Campaign', purpose: 'main', primary: true, createdBy: 'u1'
    });
    assert.equal(result.createdCount, 1);
    assert.equal(calls.filter((item) => item.method === 'POST').length, 1);
    assert.equal(store.state.bindings.length, 1);
    assert.equal(store.state.bindings[0].resourceType, 'thread');
  } finally { global.fetch = original; }
});

test('persistent panel refresh skips Discord edit when stable content hash is unchanged', async () => {
  const state = defaultDndState();
  state.campaigns.push({ id: 'c1', name: 'Campaign', status: 'active', ruleset: '5e_2024', currentLocation: '', activeQuestId: '' });
  const binding = normalizeBinding({ id: 'b1', campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main', active: true });
  state.bindings.push(binding);
  const store = storeWith(state);
  const service = new DndCampaignService({ configStore: store, logger: console });
  const built = service.buildPanel('c1');
  state.panels.push({ id: 'p1', bindingId: 'b1', messageId: snowflake(7), contentHash: built.hash, lastRefreshedAt: new Date().toISOString(), active: true });
  const original = global.fetch;
  global.fetch = async () => { throw new Error('Discord should not be called'); };
  try {
    const result = await service.refreshPanel('b1');
    assert.equal(result.unchanged, true);
  } finally { global.fetch = original; }
});
