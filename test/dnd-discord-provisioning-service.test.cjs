'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultDndState,
  normalizeBinding,
  normalizePanel
} = require('../shared/dnd-discord.cjs');
const {
  PERMISSIONS,
  DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE
} = require('../shared/dnd-discord-provisioning.cjs');
const {
  DndDiscordProvisioningService
} = require('../main/services/dnd-discord-provisioning-runtime.cjs');

function http(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    async text() { return payload === null || payload === undefined ? '' : JSON.stringify(payload); }
  };
}

function createStore() {
  const state = {
    ...defaultDndState(),
    campaigns: [{ id: 'campaign-1', name: 'The Red Keep', status: 'active', ruleset: '5e_2024' }],
    members: [
      { id: 'member-1', campaignId: 'campaign-1', discordUserId: '11111', displayName: 'Dungeon Master', role: 'dm', active: true },
      { id: 'member-2', campaignId: 'campaign-1', discordUserId: '22222', displayName: 'Player One', role: 'player', active: true }
    ],
    registeredApps: [{ id: 'nexus-bot', name: 'Nexus Bot', botUserId: '99999', enabled: true, hasToken: true, guildIds: ['12345'] }],
    provisioningRecords: []
  };
  return {
    state,
    getDndState() { return JSON.parse(JSON.stringify(state)); },
    getDiscordAppToken(appId) { return appId === 'nexus-bot' ? 'protected-token' : ''; },
    mutateDnd(mutator) { return mutator(state); },
    appendDndAudit(input) {
      const entry = { id: `audit-${state.audit.length + 1}`, time: new Date().toISOString(), ...input };
      state.audit.push(entry);
      return JSON.parse(JSON.stringify(entry));
    },
    upsertDndBinding(input) {
      const value = normalizeBinding(input);
      const index = state.bindings.findIndex((item) => item.id === value.id);
      if (index >= 0) state.bindings[index] = value;
      else state.bindings.push(value);
      return JSON.parse(JSON.stringify(value));
    },
    upsertDndPanel(input) {
      const value = normalizePanel(input);
      const index = state.panels.findIndex((item) => item.id === value.id || item.bindingId === value.bindingId);
      if (index >= 0) state.panels[index] = { ...value, id: state.panels[index].id };
      else state.panels.push(value);
      return JSON.parse(JSON.stringify(index >= 0 ? state.panels[index] : value));
    }
  };
}

function createDiscordMock() {
  const channels = [];
  const calls = [];
  let nextChannelId = 20000;
  let nextMessageId = 30000;
  const botPermissions = (PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES).toString();

  async function fetchImpl(url, options = {}) {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path: parsed.pathname, body });

    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/channels') return http(200, channels);
    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/members/99999') return http(200, { id: '99999', roles: [] });
    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/roles') return http(200, [{ id: '12345', permissions: botPermissions }]);
    if (method === 'POST' && parsed.pathname === '/api/v10/guilds/12345/channels') {
      const created = {
        id: String(nextChannelId++),
        guild_id: '12345',
        name: body.name,
        type: body.type,
        parent_id: body.parent_id || null,
        permission_overwrites: body.permission_overwrites || []
      };
      channels.push(created);
      return http(201, created);
    }
    if (method === 'POST' && /^\/api\/v10\/channels\/\d+\/messages$/.test(parsed.pathname)) {
      return http(200, { id: String(nextMessageId++) });
    }
    if (method === 'PATCH' && /^\/api\/v10\/channels\/\d+\/messages\/\d+$/.test(parsed.pathname)) {
      return http(200, { id: parsed.pathname.split('/').at(-1) });
    }
    return http(404, { message: `Unhandled mock route: ${method} ${parsed.pathname}` });
  }

  return { fetchImpl, channels, calls };
}

function requiredOnlyTemplate() {
  return DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.map((item) => ({
    key: item.key,
    name: item.name,
    enabled: item.required
  }));
}

test('preview blocks missing permissions and reports exact readiness requirements', async () => {
  const store = createStore();
  const service = new DndDiscordProvisioningService({
    configStore: store,
    logger: {},
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/channels')) return http(200, []);
      if (pathname.endsWith('/members/99999')) return http(200, { roles: [] });
      if (pathname.endsWith('/roles')) return http(200, [{ id: '12345', permissions: '0' }]);
      return http(404, { message: 'missing' });
    },
    sleep: async () => {}
  });

  const preview = await service.preview({
    campaignId: 'campaign-1', appId: 'nexus-bot', guildId: '12345', template: requiredOnlyTemplate()
  });
  assert.equal(preview.ready, false);
  assert.equal(preview.blockers.some((item) => item.includes('Manage Channels')), true);
  assert.equal(preview.blockers.some((item) => item.includes('Manage Roles')), true);
  assert.equal(preview.plan.length, 2);
});

test('confirmed provisioning creates one category, binds required channels, and is idempotent', async () => {
  const store = createStore();
  const discord = createDiscordMock();
  const service = new DndDiscordProvisioningService({
    configStore: store,
    logger: {},
    fetchImpl: discord.fetchImpl,
    sleep: async () => {}
  });
  const input = {
    campaignId: 'campaign-1',
    appId: 'nexus-bot',
    guildId: '12345',
    categoryName: 'The Red Keep',
    template: requiredOnlyTemplate(),
    createdBy: 'local-owner'
  };

  const preview = await service.preview(input);
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.plan.map((item) => item.action), ['create', 'create']);

  const progress = [];
  const first = await service.apply({ ...input, confirmed: true, confirmationHash: preview.confirmationHash }, (entry) => progress.push(entry));
  assert.equal(first.createdCount, 3);
  assert.equal(first.failedCount, 0);
  assert.equal(first.record.status, 'ready');
  assert.equal(store.state.provisioningRecords.length, 1);
  assert.equal(store.state.bindings.length, 2);
  assert.equal(store.state.bindings.find((item) => item.purpose === 'main').primary, true);
  assert.equal(store.state.bindings.find((item) => item.purpose === 'announcements').primary, false);
  assert.equal(store.state.panels.length, 1);
  assert.equal(discord.channels.filter((item) => item.type === 4).length, 1);
  assert.equal(discord.channels.filter((item) => item.type === 0).length, 2);
  assert.equal(progress.at(-1).phase, 'complete');

  const secondPreview = await service.preview(input);
  assert.deepEqual(secondPreview.plan.map((item) => item.action), ['reuse', 'reuse']);
  const postCountBefore = discord.calls.filter((item) => item.method === 'POST' && item.path.endsWith('/channels')).length;
  const second = await service.apply({ ...input, confirmed: true, confirmationHash: secondPreview.confirmationHash });
  const postCountAfter = discord.calls.filter((item) => item.method === 'POST' && item.path.endsWith('/channels')).length;
  assert.equal(second.createdCount, 0);
  assert.equal(postCountAfter, postCountBefore);
  assert.equal(store.state.provisioningRecords.length, 1);
  assert.equal(store.state.bindings.length, 2);
});

test('Discord request retries a 429 using the returned retry delay', async () => {
  const store = createStore();
  const delays = [];
  let attempts = 0;
  const service = new DndDiscordProvisioningService({
    configStore: store,
    logger: {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return http(429, { retry_after: 0.01 });
      return http(200, []);
    },
    sleep: async (ms) => { delays.push(ms); }
  });

  const result = await service.discord('nexus-bot', '/guilds/12345/channels');
  assert.deepEqual(result, []);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);
});
