'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { SelfRoleManager } = require('../src/sentinel/self-role-manager.cjs');
const { SelfRoleManager: DisplayAwareSelfRoleManager } = require('../src/sentinel/display-aware-self-role-manager.cjs');
const {
  WARFRAME_CLAN_MEMBER_ID,
  WARFRAME_CLAN_OFFICER_ID,
  roleOrderEnabled,
  accessRoleNamesFromCatalog,
  planRoleOrder,
  formatRoleOrderLog,
  reconcileRoleOrder
} = require('../src/sentinel/role-order.cjs');
const { ROLE_ORDER_DEBOUNCE_MS, ROLE_ORDER_INTERVAL_MS } = require('../src/sentinel/role-order-extension.cjs');

const root = path.resolve(__dirname, '..');

function perms(...flags) {
  const allowed = new Set(flags);
  return { has: (flag) => allowed.has(flag) };
}

function role(id, position, extra = {}) {
  return {
    id,
    name: extra.name || id,
    position,
    permissions: extra.permissions || perms(),
    ...extra
  };
}

function base(extra = {}) {
  return {
    guildId: 'guild',
    canManageRoles: true,
    botHighestPosition: extra.ceiling ?? 20,
    botHighestRoleId: 'sentinal-role',
    sentinalBotId: 'sentinal-bot',
    sentinalRoleIds: ['sentinal-role'],
    accessRoleNames: [],
    env: {},
    ...extra
  };
}

function positions(plan) {
  return new Map((plan.ladder || []).map((row) => [row.id, row.to]));
}

test('role order is enabled unless the kill switch is off', () => {
  assert.equal(roleOrderEnabled({}), true);
  assert.equal(roleOrderEnabled({ SENTINAL_ROLE_ORDER_ENABLED: '' }), true);
  assert.equal(roleOrderEnabled({ SENTINAL_ROLE_ORDER_ENABLED: 'true' }), true);
  assert.equal(roleOrderEnabled({ SENTINAL_ROLE_ORDER_ENABLED: 'false' }), false);
  assert.equal(roleOrderEnabled({ SENTINAL_ROLE_ORDER_ENABLED: 'off' }), false);
});

test('bands keep stable order under the Sentinal ceiling', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('above', 21, { name: 'Owner' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal', tags: { botId: 'sentinal-bot' }, managed: true }),
      role('color-low', 2, { name: 'Color: Blue' }),
      role('color-high', 4, { name: 'Color: Red' }),
      role('cephalon', 6, { name: 'Cephalon Nexus', tags: { botId: 'cephalon-bot' }, managed: true, editable: false, permissions: perms(PermissionFlagsBits.Administrator) }),
      role('ascended', 5, { name: 'Nexus Ascended', tags: { botId: 'ascended-bot' }, managed: true, editable: false }),
      role(WARFRAME_CLAN_OFFICER_ID, 3, { name: 'Warframe Clan Officer' }),
      role('access', 7, { name: 'Warframe Access' }),
      role('rest-low', 1, { name: 'Pronouns' }),
      role('rest-high', 8, { name: 'Supporter' })
    ],
    accessRoleNames: ['Warframe Access']
  }));

  assert.equal(plan.ok, true);
  assert.equal(plan.skipped, false);
  assert.deepEqual(plan.groups.colors, ['color-high', 'color-low']);
  assert.deepEqual(plan.groups.staffBots, ['cephalon', 'ascended']);
  assert.deepEqual(plan.groups.game, ['access', WARFRAME_CLAN_OFFICER_ID]);
  assert.deepEqual(plan.groups.rest, ['rest-high', 'rest-low']);
  const placed = positions(plan);
  assert.equal(placed.get('above'), 21);
  assert.equal(placed.get('sentinal-role'), 20);
  assert.equal(placed.get('guild'), 0);
  assert.ok(placed.get('color-high') > placed.get('color-low'));
  assert.ok(placed.get('color-low') > placed.get('cephalon'));
  assert.ok(placed.get('cephalon') > placed.get('ascended'));
  assert.ok(placed.get('ascended') > placed.get('access'));
  assert.ok(placed.get('access') > placed.get(WARFRAME_CLAN_OFFICER_ID));
  assert.ok(placed.get(WARFRAME_CLAN_OFFICER_ID) > placed.get('rest-high'));
  assert.ok(placed.get('rest-high') > placed.get('rest-low'));
  assert.ok(!plan.updates.some((item) => item.role === 'sentinal-role' || item.role === 'above' || item.role === 'guild'));
});

test('human staff pins stay above colors and a middle pin is filled around', () => {
  const plan = planRoleOrder(base({
    ceiling: 30,
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 30, { name: 'Nexus Sentinal' }),
      role('mod', 28, { name: 'Moderator', permissions: perms(PermissionFlagsBits.KickMembers) }),
      role('pin', 10, { name: 'Pinned Vanity' }),
      role('color-a', 3, { name: 'Color: Gold' }),
      role('color-b', 2, { name: 'Color: Teal' }),
      role('rest-a', 12, { name: 'Rank' }),
      role('rest-b', 11, { name: 'Platform' })
    ],
    protectedRoleIds: ['pin']
  }));

  assert.equal(plan.skipped, false);
  const placed = positions(plan);
  assert.equal(placed.get('mod'), 28);
  assert.equal(placed.get('pin'), 10);
  assert.ok(placed.get('color-a') < 28);
  assert.ok(placed.get('color-b') < placed.get('color-a'));
  assert.ok(placed.get('color-a') > placed.get('pin'));
  assert.ok(placed.get('rest-a') < placed.get('pin'));
  assert.ok(!plan.updates.some((item) => item.role === 'mod' || item.role === 'pin'));
});

test('a movable role above protected staff fails closed', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role('mod', 10, { name: 'Moderator', permissions: perms(PermissionFlagsBits.ModerateMembers) }),
      role('color', 12, { name: 'Color: Red' }),
      role('rest', 9, { name: 'Supporter' })
    ]
  }));
  assert.equal(plan.ok, false);
  assert.equal(plan.skipped, true);
  assert.equal(plan.reason, 'protected-staff-gap');
  assert.deepEqual(plan.updates, []);
  assert.match(plan.warnings[0], /Color: Red/);
});

test('managed bot roles are staff bots and Sentinal roles are not', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal', tags: { botId: 'sentinal-bot' }, managed: true, permissions: perms(PermissionFlagsBits.Administrator) }),
      role('sentinal-extra', 4, { name: 'Sentinal Extra', tags: { botId: 'sentinal-bot' }, managed: true }),
      role('booster', 3, { name: 'Server Booster', managed: true }),
      role('color', 2, { name: 'Color: Crimson' }),
      role('other-bot', 1, { name: 'Sanctuary Nexus', tags: { botId: 'sanctuary-bot' }, managed: true, editable: false })
    ]
  }));
  assert.deepEqual(plan.groups.colors, ['color']);
  assert.deepEqual(plan.groups.staffBots, ['other-bot']);
  assert.deepEqual(plan.groups.rest, ['sentinal-extra', 'booster']);
  const placed = positions(plan);
  assert.ok(placed.get('color') > placed.get('other-bot'));
  assert.ok(placed.get('other-bot') > placed.get('sentinal-extra'));
});

test('Warframe Clan Officer stays above Clan Member without shuffling the rest of the game band', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role('game-top', 8, { name: 'Minecraft Access' }),
      role(WARFRAME_CLAN_MEMBER_ID, 7, { name: 'Warframe Clan Member' }),
      role('game-mid', 6, { name: 'ARK Access' }),
      role(WARFRAME_CLAN_OFFICER_ID, 5, { name: 'Warframe Clan Officer' })
    ],
    accessRoleNames: ['Minecraft Access', 'ARK Access']
  }));
  assert.deepEqual(plan.groups.game, ['game-top', WARFRAME_CLAN_OFFICER_ID, 'game-mid', WARFRAME_CLAN_MEMBER_ID]);
  const placed = positions(plan);
  assert.ok(placed.get(WARFRAME_CLAN_OFFICER_ID) > placed.get(WARFRAME_CLAN_MEMBER_ID));
  assert.ok(placed.get('game-top') > placed.get(WARFRAME_CLAN_OFFICER_ID));
  assert.ok(placed.get(WARFRAME_CLAN_OFFICER_ID) > placed.get('game-mid'));
  assert.ok(placed.get('game-mid') > placed.get(WARFRAME_CLAN_MEMBER_ID));
});

test('Clan Officer is not moved above a protected Clan Member', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role(WARFRAME_CLAN_MEMBER_ID, 8, { name: 'Warframe Clan Member', permissions: perms(PermissionFlagsBits.ManageRoles) }),
      role(WARFRAME_CLAN_OFFICER_ID, 4, { name: 'Warframe Clan Officer' }),
      role('rest', 3, { name: 'Supporter' })
    ]
  }));
  assert.equal(plan.skipped, true);
  assert.equal(plan.reason, 'officer-below-member');
  assert.deepEqual(plan.updates, []);
});

test('an already ordered ladder makes no updates', () => {
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role('color', 4, { name: 'Color: Red' }),
      role('bot', 3, { name: 'Cephalon Nexus', tags: { botId: 'cephalon-bot' }, managed: true }),
      role(WARFRAME_CLAN_OFFICER_ID, 2, { name: 'Warframe Clan Officer' }),
      role('rest', 1, { name: 'Supporter' })
    ]
  }));
  assert.equal(plan.ok, true);
  assert.equal(plan.noop, true);
  assert.deepEqual(plan.updates, []);
});

test('missing Manage Roles fails closed', () => {
  const plan = planRoleOrder(base({
    canManageRoles: false,
    roles: [
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role('color', 1, { name: 'Color: Red' })
    ]
  }));
  assert.equal(plan.skipped, true);
  assert.equal(plan.reason, 'missing-manage-roles');
  assert.deepEqual(plan.updates, []);
});

test('env overrides reclassify roles and explicit protection wins', () => {
  const colorId = '1552750297732874401';
  const botId = '1552750297732874402';
  const gameId = '1552750297732874403';
  const protectedColor = '1552750297732874404';
  const plan = planRoleOrder(base({
    env: {
      SENTINAL_ROLE_ORDER_COLOR_IDS: colorId,
      SENTINAL_ROLE_ORDER_STAFF_BOT_IDS: `${botId}, not-an-id`,
      SENTINAL_ROLE_ORDER_GAME_IDS: gameId,
      SENTINAL_ROLE_ORDER_PROTECTED_IDS: protectedColor
    },
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role(colorId, 2, { name: 'Custom Color' }),
      role(botId, 3, { name: 'Custom Bot' }),
      role(gameId, 4, { name: 'Custom Game' }),
      role(protectedColor, 5, { name: 'Color: Locked' }),
      role('plain', 1, { name: 'Supporter' })
    ]
  }));
  assert.deepEqual(plan.groups.colors, [colorId]);
  assert.deepEqual(plan.groups.staffBots, [botId]);
  assert.deepEqual(plan.groups.game, [gameId]);
  assert.deepEqual(plan.groups.rest, ['plain']);
  assert.equal(positions(plan).get(protectedColor), 5);
  assert.ok(plan.pins.some((pin) => pin.id === protectedColor));
});

test('catalog access names and game menus join the game band', () => {
  assert.ok(accessRoleNamesFromCatalog({}).includes('warframe access'));
  const plan = planRoleOrder(base({
    roles: [
      role('guild', 0, { name: '@everyone' }),
      role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
      role('menu-game', 2, { name: 'Raid' }),
      role('platform', 1, { name: 'PC' })
    ],
    menus: [
      { id: 'games', kind: 'roles', name: 'Games', options: [{ roleId: 'menu-game', label: 'Raid' }] },
      { id: 'platforms', kind: 'roles', name: 'Platforms', options: [{ roleId: 'platform', label: 'PC' }] }
    ]
  }));
  assert.deepEqual(plan.groups.game, ['menu-game']);
  assert.deepEqual(plan.groups.rest, ['platform']);
});

test('reconcile skips the position API when order is correct or Manage Roles is missing', async () => {
  const calls = [];
  const ordered = [
    role('guild', 0, { name: '@everyone' }),
    role('sentinal-role', 20, { name: 'Nexus Sentinal' }),
    role('color', 2, { name: 'Color: Red' }),
    role('rest', 1, { name: 'Supporter' })
  ];
  const guild = {
    id: 'guild',
    roles: {
      cache: new Map(ordered.map((item) => [item.id, item])),
      setPositions: async (updates) => { calls.push(updates); }
    },
    members: {
      me: {
        id: 'sentinal-bot',
        permissions: perms(PermissionFlagsBits.ManageRoles),
        roles: {
          highest: { id: 'sentinal-role', position: 20 },
          cache: new Map([['sentinal-role', { id: 'sentinal-role' }]])
        }
      }
    }
  };
  const noop = await reconcileRoleOrder(guild, { env: {}, accessRoleNames: [], apply: true });
  assert.equal(noop.moved, 0);
  assert.deepEqual(calls, []);

  guild.members.me.permissions = perms();
  guild.roles.cache = new Map([
    ['guild', role('guild', 0, { name: '@everyone' })],
    ['sentinal-role', role('sentinal-role', 20, { name: 'Nexus Sentinal' })],
    ['color', role('color', 1, { name: 'Color: Red' })],
    ['rest', role('rest', 2, { name: 'Supporter' })]
  ]);
  const blocked = await reconcileRoleOrder(guild, { env: {}, accessRoleNames: [], apply: true });
  assert.equal(blocked.reason, 'missing-manage-roles');
  assert.deepEqual(calls, []);
});

test('reconcile applies one position batch and honors the kill switch', async () => {
  const calls = [];
  const guild = {
    id: 'guild',
    roles: {
      cache: new Map([
        ['guild', role('guild', 0, { name: '@everyone' })],
        ['sentinal-role', role('sentinal-role', 20, { name: 'Nexus Sentinal' })],
        ['color', role('color', 1, { name: 'Color: Red' })],
        ['rest', role('rest', 2, { name: 'Supporter' })]
      ]),
      fetch: async () => { throw new Error('cache should be used'); },
      setPositions: async (updates) => { calls.push(updates); }
    },
    members: {
      me: {
        id: 'sentinal-bot',
        permissions: perms(PermissionFlagsBits.ManageRoles),
        roles: {
          highest: { id: 'sentinal-role', position: 20 },
          cache: new Map([['sentinal-role', { id: 'sentinal-role' }]])
        }
      }
    }
  };
  const disabled = await reconcileRoleOrder(guild, { env: { SENTINAL_ROLE_ORDER_ENABLED: 'false' }, apply: true });
  assert.equal(disabled.reason, 'disabled');
  assert.deepEqual(calls, []);

  const applied = await reconcileRoleOrder(guild, { env: {}, accessRoleNames: [], apply: true });
  assert.equal(applied.moved, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    { role: 'rest', position: 1 },
    { role: 'color', position: 2 }
  ]);
  assert.match(formatRoleOrderLog({ reason: 'startup', moved: applied.moved, bands: applied.bands, warnings: [] }), /moved=2 bands=\{colors:1,staffBots:0,game:0,rest:1\} warnings=none/);
});

test('name-color positioning defers to role order when the reconciler is enabled', async () => {
  const previous = process.env.SENTINAL_ROLE_ORDER_ENABLED;
  delete process.env.SENTINAL_ROLE_ORDER_ENABLED;
  try {
    const guild = { roles: { fetch: async () => { throw new Error('color positions should defer'); } } };
    const baseManager = new SelfRoleManager({ client: {}, state: {}, config: { discord: {} } });
    const deferred = await baseManager.prioritizeColorRoles(guild, [], new Map(), []);
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.changed, 0);

    const displayManager = new DisplayAwareSelfRoleManager({ client: {}, state: {}, config: { discord: {} } });
    const display = await displayManager.prioritizeColorRoles(guild, [], new Map(), []);
    assert.equal(display.deferred, true);
    assert.equal(display.displaySafe, true);

    process.env.SENTINAL_ROLE_ORDER_ENABLED = 'false';
    const skipped = await baseManager.prioritizeColorRoles(guild, [], new Map(), []);
    assert.equal(skipped.deferred, undefined);
    assert.equal(skipped.skipped, true);
  } finally {
    if (previous === undefined) delete process.env.SENTINAL_ROLE_ORDER_ENABLED;
    else process.env.SENTINAL_ROLE_ORDER_ENABLED = previous;
  }
});

test('Sentinal wires role order after role menus and copies the ops note', () => {
  const entry = fs.readFileSync(path.join(root, 'src/sentinel/entry.cjs'), 'utf8');
  const roleMenu = fs.readFileSync(path.join(root, 'src/sentinel/role-menu-extension.cjs'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.sentinal'), 'utf8');
  assert.match(entry, /installRoleOrderExtension\(\)/);
  assert.match(roleMenu, /notifyRoleMenuStartupComplete/);
  assert.equal(ROLE_ORDER_DEBOUNCE_MS, 30_000);
  assert.equal(ROLE_ORDER_INTERVAL_MS, 6 * 60 * 60 * 1000);
  assert.match(dockerfile, /docs\/ops\/SENTINAL_ROLE_ORDER\.md/);
});
