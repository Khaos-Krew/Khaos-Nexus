'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultDndState, normalizeBinding, normalizePanel } = require('../shared/dnd-discord.cjs');
const { PERMISSIONS, DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE } = require('../shared/dnd-discord-provisioning.cjs');
const { DndDiscordProvisioningService } = require('../main/services/dnd-discord-provisioning-runtime.cjs');

function http(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
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
    if (method === 'PATCH' && /^\/api\/v10\/channels\/\d+$/.test(parsed.pathname)) {
      const channelId = parsed.pathname.split('/').at(-1);
      const channel = channels.find((item) => String(item.id) === channelId);
      if (!channel) return http(404, { code: 10003, message: 'Unknown Channel' });
      if (Object.prototype.hasOwnProperty.call(body || {}, 'parent_id')) channel.parent_id = body.parent_id;
      return http(200, channel);
    }
    if (method === 'POST' && /^\/api\/v10\/channels\/\d+\/messages$/.test(parsed.pathname)) return http(200, { id: String(nextMessageId++) });
    if (method === 'PATCH' && /^\/api\/v10\/channels\/\d+\/messages\/\d+$/.test(parsed.pathname)) return http(200, { id: parsed.pathname.split('/').at(-1) });
    return http(404, { code: 10003, message: 'Unknown Channel' });
  }

  return { fetchImpl, channels, calls };
}

function requiredOnlyTemplate() {
  return DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.map((item) => ({ key: item.key, name: item.name, enabled: item.required }));
}

function channelMutationCalls(discord) {
  return discord.calls.filter((item) =>
    (item.method === 'POST' && item.path === '/api/v10/guilds/12345/channels') ||
    (item.method === 'PATCH' && /^\/api\/v10\/channels\/\d+$/.test(item.path))
  );
}

test('externally moved managed channel is reparented to the canonical campaign category and converges', async () => {
  const store = createStore();
  const discord = createDiscordMock();
  const service = new DndDiscordProvisioningService({ configStore: store, logger: {}, fetchImpl: discord.fetchImpl, sleep: async () => {} });
  const input = {
    campaignId: 'campaign-1',
    appId: 'nexus-bot',
    guildId: '12345',
    categoryName: 'The Red Keep',
    template: requiredOnlyTemplate(),
    createdBy: 'local-owner'
  };

  const initialPreview = await service.preview(input);
  const initial = await service.apply({ ...input, confirmed: true, confirmationHash: initialPreview.confirmationHash });
  assert.equal(initial.failedCount, 0);

  const record = store.state.provisioningRecords[0];
  const canonicalCategoryId = String(record.categoryId);
  const tableId = String(record.resources['table-chat'].id);
  const infoId = String(record.resources['campaign-info'].id);
  const tableChannel = discord.channels.find((item) => String(item.id) === tableId);
  const infoChannel = discord.channels.find((item) => String(item.id) === infoId);
  assert.equal(String(tableChannel.parent_id), canonicalCategoryId);
  assert.equal(String(infoChannel.parent_id), canonicalCategoryId);

  const externalCategoryId = '77777';
  discord.channels.push({
    id: externalCategoryId,
    guild_id: '12345',
    name: 'External Category',
    type: 4,
    parent_id: null,
    permission_overwrites: []
  });
  tableChannel.parent_id = externalCategoryId;

  const driftPreview = await service.preview(input);
  assert.equal(driftPreview.plan.find((item) => item.key === 'table-chat').action, 'reparent');
  assert.equal(driftPreview.plan.find((item) => item.key === 'campaign-info').action, 'reuse');

  const mutationsBeforeRecovery = channelMutationCalls(discord).length;
  const recovered = await service.apply({ ...input, confirmed: true, confirmationHash: driftPreview.confirmationHash });
  const recoveryMutations = channelMutationCalls(discord).slice(mutationsBeforeRecovery);

  assert.equal(recovered.failedCount, 0);
  assert.equal(recovered.createdCount, 0);
  assert.equal(recoveryMutations.filter((item) => item.method === 'POST').length, 0);
  assert.equal(recoveryMutations.filter((item) => item.method === 'PATCH').length, 1);
  assert.equal(recoveryMutations.find((item) => item.method === 'PATCH').path, `/api/v10/channels/${tableId}`);
  assert.equal(String(tableChannel.parent_id), canonicalCategoryId);
  assert.equal(String(infoChannel.parent_id), canonicalCategoryId);
  assert.equal(String(recovered.record.resources['table-chat'].id), tableId);
  assert.equal(String(recovered.record.resources['campaign-info'].id), infoId);

  const mainBinding = store.state.bindings.find((item) => item.active !== false && item.purpose === 'main');
  const infoBinding = store.state.bindings.find((item) => item.active !== false && item.purpose === 'announcements');
  assert.equal(String(mainBinding.resourceId), tableId);
  assert.equal(String(mainBinding.parentChannelId), canonicalCategoryId);
  assert.equal(String(infoBinding.resourceId), infoId);
  assert.equal(String(infoBinding.parentChannelId), canonicalCategoryId);

  const convergedPreview = await service.preview(input);
  assert.deepEqual(convergedPreview.plan.map((item) => item.action), ['reuse', 'reuse']);
  const mutationsBeforeConvergedApply = channelMutationCalls(discord).length;
  const converged = await service.apply({ ...input, confirmed: true, confirmationHash: convergedPreview.confirmationHash });
  assert.equal(converged.failedCount, 0);
  assert.equal(converged.createdCount, 0);
  assert.equal(channelMutationCalls(discord).length, mutationsBeforeConvergedApply);
});
