'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultDndState } = require('../shared/dnd-discord.cjs');
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
    members: [{ id: 'member-1', campaignId: 'campaign-1', discordUserId: '11111', displayName: 'Dungeon Master', role: 'dm', active: true }],
    registeredApps: [{ id: 'nexus-bot', name: 'Nexus Bot', botUserId: '99999', enabled: true, hasToken: true, guildIds: ['12345'] }],
    provisioningRecords: [{
      id: 'provisioning-1',
      campaignId: 'campaign-1',
      appId: 'nexus-bot',
      guildId: '12345',
      categoryId: '20000',
      categoryName: 'The Red Keep',
      resources: {
        'campaign-info': { id: '20001', name: 'campaign-info', type: 'text', purpose: 'announcements' },
        'table-chat': { id: '20002', name: 'table-chat', type: 'text', purpose: 'main' }
      },
      templateHash: 'existing',
      status: 'ready',
      createdBy: 'local-owner'
    }]
  };
  return {
    state,
    getDndState() { return JSON.parse(JSON.stringify(state)); },
    getDiscordAppToken() { return 'protected-token'; },
    mutateDnd(mutator) { return mutator(state); },
    appendDndAudit(input) { return input; }
  };
}

function createDiscordMock() {
  const channels = [
    { id: '20000', guild_id: '12345', name: 'The Red Keep', type: 4, parent_id: null },
    { id: '20001', guild_id: '12345', name: 'campaign-info', type: 0, parent_id: '20000' },
    { id: '20002', guild_id: '12345', name: 'table-chat', type: 0, parent_id: '20000' }
  ];
  const calls = [];
  const botPermissions = (PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES).toString();

  async function fetchImpl(url, options = {}) {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    calls.push({ method, path: parsed.pathname });
    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/channels') return http(200, channels);
    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/members/99999') return http(200, { id: '99999', roles: [] });
    if (method === 'GET' && parsed.pathname === '/api/v10/guilds/12345/roles') return http(200, [{ id: '12345', permissions: botPermissions }]);
    return http(404, { code: 10003, message: 'Unknown Channel' });
  }

  return { fetchImpl, channels, calls };
}

function requiredOnlyTemplate() {
  return DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.map((item) => ({ key: item.key, name: item.name, enabled: item.required }));
}

test('managed channel with wrong Discord type fails closed instead of being reused', async () => {
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

  const healthy = await service.preview(input);
  assert.equal(healthy.ready, true);
  assert.deepEqual(healthy.plan.map((item) => item.action), ['reuse', 'reuse']);

  const tableChannel = discord.channels.find((item) => item.id === '20002');
  tableChannel.type = 2;

  const drifted = await service.preview(input);
  assert.equal(drifted.ready, false);
  assert.equal(drifted.plan.find((item) => item.key === 'campaign-info').action, 'reuse');
  assert.equal(drifted.plan.find((item) => item.key === 'table-chat').action, 'type-conflict');
  assert.match(drifted.blockers.join(' '), /table-chat is bound to Discord channel 20002 with type 2, but Nexus requires text/i);

  await assert.rejects(
    service.apply({ ...input, confirmed: true, confirmationHash: drifted.confirmationHash }),
    (error) => error?.code === 'DND_PROVISIONING_NOT_READY'
  );

  assert.equal(discord.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
  assert.equal(store.state.provisioningRecords[0].resources['table-chat'].id, '20002');
});
