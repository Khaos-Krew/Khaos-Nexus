'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Events, MessageFlags } = require('discord.js');
const {
  gameBotKey,
  resolveCategoryConfig,
  redirectMessage,
  evaluateCategoryAccess,
  installCategoryGate
} = require('../src/game-bots/category-gate.cjs');
const { helpText, buildStatusText, installOpsSpine } = require('../src/game-bots/ops-spine.cjs');
const { safeBotName } = require('../src/game-bots/command-failure.cjs');
const { sanctuaryCommands, bindSanctuaryCommands, SANCTUARY_INFO } = require('../src/sentinel/sanctuary-bot.cjs');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const CATEGORY = '1516640233389822042';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function interaction(overrides = {}) {
  const replies = [];
  const record = async (payload) => {
    replies.push(payload);
    target.replied = true;
    return payload;
  };
  const target = {
    guildId: 'guild',
    channelId: 'channel',
    commandName: 'sanctuary',
    user: { id: '42' },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    reply: record,
    editReply: record,
    followUp: record,
    replies,
    ...overrides
  };
  return target;
}

test('sanctuary game role maps onto the shared category gate', () => {
  assert.equal(gameBotKey({ botKey: 'sanctuary' }), 'sanctuary');
  assert.equal(gameBotKey({ gameRole: 'diablo' }), 'sanctuary');
  assert.equal(gameBotKey({ gameRole: 'diablo4' }), 'sanctuary');
  assert.equal(gameBotKey({ serviceName: 'sanctuary-nexus' }), 'sanctuary');
  assert.equal(safeBotName('sanctuary'), 'Sanctuary Nexus');
  assert.equal(safeBotName('Sanctuary Nexus'), 'Sanctuary Nexus');
});

test('unset sanctuary category warns and allows, including DMs', async () => {
  const open = resolveCategoryConfig('sanctuary', {});
  assert.equal(open.open, true);
  assert.equal(open.source, 'unset');
  assert.equal(open.envName, 'SANCTUARY_DISCORD_CATEGORY_ID');
  assert.equal(open.failClosed, false);
  const blank = resolveCategoryConfig('sanctuary', { SANCTUARY_DISCORD_CATEGORY_ID: '  ', DIABLO_DISCORD_CATEGORY_ID: '' });
  assert.equal(blank.open, true);
  const allowed = await evaluateCategoryAccess(interaction({ guildId: null, channel: null }), open);
  assert.equal(allowed.allow, true);
  assert.equal(allowed.reason, 'open');

  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const client = new EventEmitter();
    installCategoryGate(client, { bot: 'diablo', env: {} });
    let ran = 0;
    client.on('interactionCreate', () => { ran += 1; });
    const dm = interaction({ guildId: null, channel: null, commandName: 'nexushelp' });
    client.emit('interactionCreate', dm);
    await flush();
    assert.equal(ran, 1);
    assert.equal(dm.replies.length, 0);
    assert.match(warnings.join('\n'), /Sanctuary Nexus/);
    assert.match(warnings.join('\n'), /SANCTUARY_DISCORD_CATEGORY_ID is unset/);
  } finally {
    console.warn = original;
  }
});

test('a set sanctuary category denies other categories and DMs', async () => {
  const env = { SANCTUARY_DISCORD_CATEGORY_ID: CATEGORY };
  const config = resolveCategoryConfig('sanctuary', env);
  assert.equal(config.source, 'env');
  assert.equal(config.id, CATEGORY);
  assert.equal(config.open, false);

  const alias = resolveCategoryConfig('sanctuary', { DIABLO_DISCORD_CATEGORY_ID: CATEGORY });
  assert.equal(alias.envName, 'DIABLO_DISCORD_CATEGORY_ID');
  assert.equal(alias.id, CATEGORY);
  const primaryWins = resolveCategoryConfig('sanctuary', {
    SANCTUARY_DISCORD_CATEGORY_ID: '1516602943670059108',
    DIABLO_DISCORD_CATEGORY_ID: CATEGORY
  });
  assert.equal(primaryWins.id, '1516602943670059108');
  assert.equal(primaryWins.envName, 'SANCTUARY_DISCORD_CATEGORY_ID');

  const invalid = resolveCategoryConfig('sanctuary', { SANCTUARY_DISCORD_CATEGORY_ID: 'not-a-category' });
  assert.equal(invalid.failClosed, true);
  assert.equal(invalid.open, false);
  const closed = await evaluateCategoryAccess(interaction({
    channel: { parentId: CATEGORY, isThread: () => false }
  }), invalid);
  assert.equal(closed.allow, false);
  assert.equal(closed.reason, 'fail-closed');

  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'sanctuary', env });
  bindSanctuaryCommands(client, { config: { discord: { guildId: 'guild' } } });
  let ran = 0;
  client.on('interactionCreate', () => { ran += 1; });

  const wrong = interaction({
    channel: { parentId: '1516602943670059108', isThread: () => false }
  });
  client.emit('interactionCreate', wrong);
  await flush();
  assert.equal(ran, 0);
  assert.equal(wrong.replies.length, 1);
  assert.equal(wrong.replies[0].content, redirectMessage('sanctuary'));
  assert.equal(wrong.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(wrong.replies[0].content, /Sanctuary category/);

  const dm = interaction({ guildId: null, channel: null });
  client.emit('interactionCreate', dm);
  await flush();
  assert.equal(ran, 0);
  assert.equal(dm.replies[0].flags, MessageFlags.Ephemeral);

  const thread = interaction({
    channel: { isThread: () => true, parentId: 'parent-text', parent: { parentId: CATEGORY } }
  });
  client.emit('interactionCreate', thread);
  await flush();
  assert.equal(ran, 1);
  assert.equal(thread.replies.length, 1);
  assert.match(thread.replies[0].content, /Sanctuary Nexus/);
  assert.equal(thread.replies[0].flags, MessageFlags.Ephemeral);

  const cephalonStillDefault = resolveCategoryConfig('cephalon', {});
  assert.equal(cephalonStillDefault.id, '1516640233389822042');
  assert.equal(cephalonStillDefault.open, false);
  assert.equal(resolveCategoryConfig('ascended', {}).source, 'default');
});

test('sanctuary help lists nexushelp and does not borrow other bots', async () => {
  const help = helpText('sanctuary');
  assert.match(help, /Sanctuary Nexus help/);
  assert.match(help, /\/nexushelp/);
  assert.match(help, /\/sanctuary/);
  assert.match(help, /\/status/);
  assert.match(help, /Nexus Sentinal/);
  assert.match(help, /\/bal/);
  assert.match(help, /\/o9verify/);
  assert.doesNotMatch(help, /\/warframe/);
  assert.doesNotMatch(help, /\/arkrcon/);
  assert.doesNotMatch(help, /Sentinel/);
  assert.doesNotMatch(help, /Nephalem/);
  assert.doesNotMatch(helpText('cephalon'), /\/sanctuary/);
  assert.doesNotMatch(helpText('ascended'), /\/sanctuary/);
  assert.equal(sanctuaryCommands().map((command) => command.name).join(','), 'sanctuary');
  for (const command of sanctuaryCommands()) assert.ok(command.toJSON().description.length <= 100);
  assert.match(SANCTUARY_INFO, /Nexus Sentinal/);
  assert.doesNotMatch(SANCTUARY_INFO, /Sentinel|Nephalem/);

  const status = await buildStatusText({
    bot: 'sanctuary',
    client: { isReady: () => true },
    env: { RAILWAY_GIT_COMMIT_SHA: 'abc1234def56789' }
  });
  assert.match(status, /Sanctuary Nexus status/);
  assert.match(status, /Discord: ready/);
  assert.match(status, /Deploy `abc1234`/);
  assert.match(status, /does not start a game backend/);
  assert.doesNotMatch(status, /Warframe backend|RCON|ArkShop/);

  const client = new EventEmitter();
  const created = [];
  client.guilds = {
    fetch: async () => ({
      commands: {
        fetch: async () => ({ find: () => null }),
        create: async (json) => { created.push(json.name); return json; },
        edit: async () => { throw new Error('edit should not run'); }
      }
    })
  };
  installOpsSpine(client, {
    bot: 'sanctuary',
    env: {},
    config: { discord: { guildId: '1516640233389822042', ownerUserIds: [], operatorRoleIds: [] } }
  });
  client.emit(Events.ClientReady);
  await flush();
  await flush();
  assert.deepEqual(created.sort(), ['nexushelp', 'status']);
});

test('Railway sanctuary files stay off BusyBox, RCON, and the backend', () => {
  const dockerfile = read('Dockerfile.sanctuary');
  const service = read('src/railway/sanctuary-service.cjs');
  const doc = read('docs/ops/SANCTUARY_NEXUS_DISCORD.md');
  assert.match(dockerfile, /FROM node:22-slim/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /NEXUS_GAME_ROLE=diablo/);
  assert.match(dockerfile, /src\/railway\/sanctuary-service\.cjs/);
  assert.doesNotMatch(dockerfile, /busybox|_RCON_PASSWORD|_RCON_PORT|_HOST=|backend\/server/i);
  assert.match(service, /botName: 'Sanctuary Nexus'/);
  assert.match(service, /serviceName: 'sanctuary-nexus'/);
  assert.match(service, /gameRole: 'diablo'/);
  assert.match(service, /installGuildMembersIntentExtension/);
  assert.match(service, /bindSanctuaryCommands/);
  assert.match(service, /startGameBot/);
  assert.doesNotMatch(service, /backend\/server|RCON|Nephalem|Sentinel/);
  for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_GUILD_ID', 'SANCTUARY_DISCORD_CATEGORY_ID', 'READY']) {
    assert.match(doc, new RegExp(name));
  }
  assert.match(doc, /Dockerfile\.sanctuary/);
  assert.match(doc, /sanctuary-nexus/);
  assert.match(doc, /Nexus Sentinal/);
  assert.match(doc, /BusyBox/);
  assert.doesNotMatch(doc, /Nephalem|Sentinel/);
  assert.match(read('Dockerfile.sentinal'), /Dockerfile\.sanctuary/);
  assert.match(read('src/game-bots/start.cjs'), /sanctuary/);
});
