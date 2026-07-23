'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LAYOUT,
  buttonId,
  parseButtonId,
  normalizeRoleMenu,
  renderRoleMenu,
  roleMutation,
  normalizeDiscordAutomationConfig,
  planLayout
} = require('../shared/discord-automation.cjs');
const { DiscordAutomationService } = require('../main/services/discord-automation-service.cjs');

test('role menu normalization limits options and forces color exclusivity', () => {
  const menu = normalizeRoleMenu({
    id: 'colors', kind: 'colors', mode: 'toggle', name: 'Colors',
    options: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, label: `Color ${index}`, roleId: String(10000 + index), color: '#ff0000' }))
  });
  assert.equal(menu.kind, 'colors');
  assert.equal(menu.mode, 'exclusive');
  assert.equal(menu.options.length, 25);
});

test('role-menu button identifiers round trip safely', () => {
  const id = buttonId('games', 'ark');
  assert.deepEqual(parseButtonId(id), { menuId: 'games', optionId: 'ark' });
  assert.equal(parseButtonId('not-a-khaos-button'), null);
});

test('rendered role menu contains at most five buttons per row', () => {
  const payload = renderRoleMenu({
    id: 'games', name: 'Games', options: Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, label: `Game ${index}`, roleId: String(20000 + index) }))
  });
  assert.equal(payload.components.length, 3);
  assert.deepEqual(payload.components.map((row) => row.components.length), [5, 5, 2]);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('exclusive role mutation removes sibling roles and adds selected role', () => {
  const menu = {
    id: 'colors', kind: 'colors', options: [
      { id: 'red', label: 'Red', roleId: '11111', color: '#ff0000' },
      { id: 'blue', label: 'Blue', roleId: '22222', color: '#0000ff' }
    ]
  };
  const mutation = roleMutation(menu, 'blue', ['11111', '99999']);
  assert.equal(mutation.action, 'replaced');
  assert.equal(mutation.addRoleId, '22222');
  assert.deepEqual(mutation.removeRoleIds, ['11111']);
});

test('clicking an active toggle role removes it', () => {
  const mutation = roleMutation({ id: 'games', options: [{ id: 'ark', label: 'ARK', roleId: '33333' }] }, 'ark', ['33333']);
  assert.equal(mutation.action, 'removed');
  assert.equal(mutation.addRoleId, '');
  assert.deepEqual(mutation.removeRoleIds, ['33333']);
});

test('layout planning is additive and does not duplicate existing category channels', () => {
  const existing = [
    { id: 'cat1', name: 'NEXUS INFORMATION', type: 4, parentId: '' },
    { id: 'chan1', name: 'welcome', type: 0, parentId: 'cat1' }
  ];
  const plan = planLayout(DEFAULT_LAYOUT, existing);
  assert.equal(plan.destructiveCount, 0);
  assert.ok(plan.unchangedCount >= 2);
  assert.ok(plan.createCount > 0);
  assert.equal(plan.operations.find((item) => item.name === 'welcome').action, 'unchanged');
});

test('automation config deduplicates built-in layout and bounds audit retention', () => {
  const config = normalizeDiscordAutomationConfig({
    layouts: [DEFAULT_LAYOUT],
    audit: { retention: 60 },
    auditEntries: Array.from({ length: 100 }, (_, index) => ({ id: `a${index}`, action: 'test', time: new Date(index).toISOString() }))
  });
  assert.equal(config.layouts.filter((item) => item.id === DEFAULT_LAYOUT.id).length, 1);
  assert.equal(config.auditEntries.length, 60);
});

test('service rejects roles the bot cannot manage', () => {
  const service = new DiscordAutomationService({ configStore: {}, logger: {} });
  assert.throws(() => service.validateRoleMenu({ id: 'staff', options: [{ id: 'admin', label: 'Admin', roleId: '44444' }] }, {
    roles: [{ id: '44444', name: 'Admin', manageable: false }]
  }), /cannot manage/i);
});

test('service applies only missing Discord layout items', async () => {
  const calls = [];
  const fakeRest = {
    async get(route) {
      if (route.endsWith('/roles')) return [{ id: 'botrole', name: 'Bot', position: 10, managed: false }];
      if (route.endsWith('/channels')) return [];
      if (route.endsWith('/@me')) return { id: 'botuser', username: 'Nexus' };
      if (route.includes('/members/')) return { roles: ['botrole'] };
      throw new Error(`Unexpected GET ${route}`);
    },
    async post(route, { body }) { calls.push({ route, body }); return { id: String(90000 + calls.length), ...body }; }
  };
  const configStore = {
    getRuntimeBootstrap() { return { discordToken: 'token', config: { discord: { guildId: '55555' } } }; },
    getDiscordAutomation() { return normalizeDiscordAutomationConfig({}); }
  };
  const service = new DiscordAutomationService({ configStore, restFactory: () => fakeRest, now: () => new Date('2026-07-23T00:00:00.000Z') });
  const result = await service.applyLayout({ id: 'small', name: 'Small', guildId: '55555', categories: [{ id: 'cat', name: 'TEST', channels: [{ id: 'general', name: 'general', type: 'text' }] }] });
  assert.equal(result.created.length, 2);
  assert.equal(calls[0].body.type, 4);
  assert.equal(calls[1].body.type, 0);
  assert.equal(calls[1].body.parent_id, '90001');
});
