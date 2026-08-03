'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DndCampaignService,
  validateDiscordMessagePayload,
  discordError
} = require('../main/services/dnd-campaign-service.cjs');
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

function campaignState() {
  const state = defaultDndState();
  state.campaigns.push({ id: 'c1', name: 'Campaign', status: 'active', ruleset: '5e_2024', currentLocation: '', activeQuestId: '' });
  state.bindings.push(normalizeBinding({ id: 'b1', campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main', active: true }));
  return state;
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

test('campaign panel uses a valid Discord action row instead of a nested button array', () => {
  const service = new DndCampaignService({ configStore: storeWith(campaignState()), logger: console });
  const built = service.buildPanel('c1');
  assert.equal(built.payload.components.length, 1);
  assert.equal(built.payload.components[0].type, 1);
  assert.equal(built.payload.components[0].components.length, 5);
  assert.doesNotThrow(() => validateDiscordMessagePayload(built.payload));
});

test('payload validation reports the exact malformed action-row field', () => {
  assert.throws(
    () => validateDiscordMessagePayload({ components: [[{ type: 2, style: 2, label: 'Broken', custom_id: 'dnd:broken' }]] }),
    (error) => error.code === 'DND_DISCORD_PAYLOAD_INVALID' && error.field === 'components[0]'
  );
});

test('payload validation rejects overlong button custom IDs before Discord is called', () => {
  assert.throws(
    () => validateDiscordMessagePayload({ components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Broken', custom_id: 'x'.repeat(101) }] }] }),
    (error) => error.code === 'DND_DISCORD_PAYLOAD_INVALID' && error.field === 'components[0].components[0].custom_id'
  );
});

test('Discord invalid-form errors are reduced to a specific redacted field path', () => {
  const error = discordError(400, {
    code: 50035,
    message: 'Invalid Form Body',
    errors: { components: { 0: { type: { _errors: [{ code: 'BASE_TYPE_BAD_LENGTH', message: 'This field is required' }] } } } }
  });
  assert.equal(error.code, 'DND_DISCORD_PAYLOAD_REJECTED');
  assert.equal(error.field, 'components.0.type');
  assert.match(error.message, /components\.0\.type/);
  assert.doesNotMatch(error.message, /token|campaign secret/i);
});

test('persistent panel refresh sends the validated action-row payload and stores the message', async () => {
  const state = campaignState();
  const store = storeWith(state);
  const service = new DndCampaignService({ configStore: store, logger: console });
  const original = global.fetch;
  let sentBody = null;
  global.fetch = async (_url, options = {}) => {
    sentBody = JSON.parse(options.body);
    return response(200, { id: snowflake(7) });
  };
  try {
    const result = await service.refreshPanel('b1');
    assert.equal(result.unchanged, false);
    assert.equal(sentBody.components[0].type, 1);
    assert.equal(sentBody.components[0].components.length, 5);
    assert.equal(store.state.panels[0].messageId, snowflake(7));
  } finally { global.fetch = original; }
});

test('persistent panel refresh skips Discord edit when stable content hash is unchanged', async () => {
  const state = campaignState();
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
