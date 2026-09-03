'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultDndState, normalizeBinding, normalizePanel } = require('../shared/dnd-discord.cjs');
const { PERMISSIONS, DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE } = require('../shared/dnd-discord-provisioning.cjs');
const {
  DndDiscordProvisioningService,
  provisioningFailures
} = require('../main/services/dnd-discord-provisioning-runtime.cjs');

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

function requiredOnlyTemplate() {
  return DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.map((item) => ({
    key: item.key,
    name: item.name,
    enabled: item.required
  }));
}

test('provisioningFailures includes persistent panel failures', () => {
  assert.deepEqual(
    provisioningFailures([
      { key: 'table-chat', status: 'reused' },
      { key: 'campaign-panel', status: 'failed' },
      { key: 'session-notes', status: 'binding-failed' }
    ]).map((item) => item.key),
    ['campaign-panel', 'session-notes']
  );
});

test('panel refresh failure downgrades provisioning readiness and emits one corrected terminal result', async () => {
  const store = createStore();
  const channels = [];
  let nextChannelId = 20000;
  const botPermissions = (PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES).toString();

  const service = new DndDiscordProvisioningService({
    configStore: store,
    logger: {},
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;

      if (method === 'GET' && pathname === '/api/v10/guilds/12345/channels') return http(200, channels);
      if (method === 'GET' && pathname === '/api/v10/guilds/12345/members/99999') return http(200, { id: '99999', roles: [] });
      if (method === 'GET' && pathname === '/api/v10/guilds/12345/roles') return http(200, [{ id: '12345', permissions: botPermissions }]);
      if (method === 'POST' && pathname === '/api/v10/guilds/12345/channels') {
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
      if (method === 'POST' && /^\/api\/v10\/channels\/\d+\/messages$/.test(pathname)) {
        return http(500, { message: 'Persistent campaign panel unavailable' });
      }
      return http(404, { message: `Unhandled mock route: ${method} ${pathname}` });
    }
  });

  const input = {
    campaignId: 'campaign-1',
    appId: 'nexus-bot',
    guildId: '12345',
    template: requiredOnlyTemplate(),
    createdBy: 'owner-test'
  };
  const preview = await service.preview(input);
  assert.equal(preview.ready, true);

  const progress = [];
  const result = await service.apply({
    ...input,
    confirmed: true,
    confirmationHash: preview.confirmationHash
  }, (event) => progress.push(event));

  assert.equal(result.failedCount, 1);
  assert.equal(result.record.status, 'partial');
  assert.equal(store.state.provisioningRecords[0].status, 'partial');
  assert.equal(result.results.some((item) => item.key === 'campaign-panel' && item.status === 'failed'), true);

  const terminal = progress.filter((item) => item.phase === 'complete');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, 'partial');
  assert.equal(terminal[0].failedCount, 1);
  assert.equal(store.state.audit.some((item) => item.action === 'provisioning.outcome_reconciled' && item.outcome === 'partial'), true);
});
