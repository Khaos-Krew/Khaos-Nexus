'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { commandOwner, sentinalShouldRegister, ASCENDED_COMMANDS, CEPHALON_COMMANDS } = require('../src/sentinel/game-command-ownership.cjs');
const {
  OWNER_CATEGORY_IDS,
  gameBotKey,
  resolveCategoryConfig,
  redirectMessage,
  evaluateCategoryAccess,
  installCategoryGate
} = require('../src/game-bots/category-gate.cjs');
const {
  PLAYER_FAILURE_MESSAGE,
  reportCommandFailure,
  setGameBotMeta,
  redactSecrets
} = require('../src/game-bots/command-failure.cjs');
const {
  helpText,
  opsCommandBuilders,
  buildStatusText,
  handleOpsCommand,
  installOpsSpine,
  deployTip
} = require('../src/game-bots/ops-spine.cjs');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

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
    commandName: 'market',
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

test('category ids default to the owner categories and fail closed on garbage', () => {
  assert.equal(OWNER_CATEGORY_IDS.ascended, '1516602943670059108');
  assert.equal(OWNER_CATEGORY_IDS.cephalon, '1516640233389822042');
  assert.equal(resolveCategoryConfig('ascended', {}).id, OWNER_CATEGORY_IDS.ascended);
  assert.equal(resolveCategoryConfig('ascended', {}).source, 'default');
  assert.equal(resolveCategoryConfig('cephalon', { CEPHALON_DISCORD_CATEGORY_ID: '  ' }).id, OWNER_CATEGORY_IDS.cephalon);
  const override = resolveCategoryConfig('cephalon', { CEPHALON_DISCORD_CATEGORY_ID: '1516640233389822099' });
  assert.equal(override.source, 'env');
  assert.equal(override.id, '1516640233389822099');
  const invalid = resolveCategoryConfig('ascended', { ASCENDED_DISCORD_CATEGORY_ID: 'not-a-category' });
  assert.equal(invalid.failClosed, true);
  assert.equal(invalid.id, '');
  assert.equal(gameBotKey({ botKey: 'cephalon' }), 'cephalon');
  assert.equal(gameBotKey({ gameRole: 'ark_asa' }), 'ascended');
  assert.equal(gameBotKey({ serviceName: 'cephalon-nexus' }), 'cephalon');
  assert.equal(gameBotKey({}), '');
});

test('category access allows a channel and a thread, and denies the wrong category and DMs', async () => {
  const cephalon = resolveCategoryConfig('cephalon', {});
  const ascended = resolveCategoryConfig('ascended', {});
  const inCategory = await evaluateCategoryAccess(interaction({
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  }), cephalon);
  assert.equal(inCategory.allow, true);
  assert.equal(inCategory.reason, 'allow');

  const thread = await evaluateCategoryAccess(interaction({
    channel: { isThread: () => true, parentId: 'parent-text', parent: { parentId: OWNER_CATEGORY_IDS.ascended } }
  }), ascended);
  assert.equal(thread.allow, true);

  const fetchedThread = await evaluateCategoryAccess(interaction({
    channel: { isThread: () => true, parentId: 'parent-text', parent: null },
    guild: { channels: { fetch: async (id) => (id === 'parent-text' ? { parentId: OWNER_CATEGORY_IDS.cephalon } : null) } }
  }), cephalon);
  assert.equal(fetchedThread.allow, true);

  const fetchedChannel = await evaluateCategoryAccess(interaction({
    channel: null,
    channelId: 'text-1',
    guild: { channels: { fetch: async (id) => (id === 'text-1' ? { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false } : null) } }
  }), cephalon);
  assert.equal(fetchedChannel.allow, true);

  const wrong = await evaluateCategoryAccess(interaction({
    channel: { parentId: '1516602943670059108', isThread: () => false }
  }), cephalon);
  assert.equal(wrong.allow, false);
  assert.equal(wrong.reason, 'wrong-category');

  const wrongThread = await evaluateCategoryAccess(interaction({
    channel: { isThread: () => true, parentId: 'parent-text', parent: { parentId: '1000000000000000001' } }
  }), ascended);
  assert.equal(wrongThread.allow, false);

  const dm = await evaluateCategoryAccess(interaction({ guildId: null, channel: null }), cephalon);
  assert.equal(dm.allow, false);
  assert.equal(dm.reason, 'dm');

  const closed = await evaluateCategoryAccess(interaction({
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  }), resolveCategoryConfig('cephalon', { CEPHALON_DISCORD_CATEGORY_ID: 'nope' }));
  assert.equal(closed.allow, false);
  assert.equal(closed.reason, 'fail-closed');
});

test('installed gate replies ephemeral and does not run the command outside the category', async () => {
  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'ascended', env: {} });
  let ran = 0;
  client.on('interactionCreate', () => { ran += 1; });
  client.on('interactionCreate', () => { ran += 1; });

  const wrong = interaction({
    commandName: 'ark',
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  });
  client.emit('interactionCreate', wrong);
  await flush();
  assert.equal(ran, 0);
  assert.equal(wrong.replies.length, 1);
  assert.equal(wrong.replies[0].content, redirectMessage('ascended'));
  assert.equal(wrong.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(wrong.replies[0].content, /ARK Ascended category/);

  const dm = interaction({ guildId: null, channel: null, commandName: 'arkrcon' });
  client.emit('interactionCreate', dm);
  await flush();
  assert.equal(ran, 0);
  assert.equal(dm.replies[0].flags, MessageFlags.Ephemeral);

  const allowed = interaction({
    commandName: 'ark',
    channel: { isThread: () => true, parentId: 'parent-text', parent: { parentId: OWNER_CATEGORY_IDS.ascended } }
  });
  client.emit('interactionCreate', allowed);
  await flush();
  assert.equal(ran, 2);
  assert.equal(allowed.replies.length, 0);

  const autocomplete = interaction({
    isAutocomplete: () => true,
    commandName: 'ark',
    channel: { parentId: '1', isThread: () => false },
    respond: async (choices) => { autocomplete.choices = choices; },
    reply: async () => { throw new Error('autocomplete deny must not reply'); }
  });
  client.emit('interactionCreate', autocomplete);
  await flush();
  assert.deepEqual(autocomplete.choices, []);
});

test('Cephalon gate allows its category and redirects everywhere else', async () => {
  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'cephalon', env: {} });
  let ran = false;
  client.on('interactionCreate', () => { ran = true; });
  const allowed = interaction({
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  });
  client.emit('interactionCreate', allowed);
  await flush();
  assert.equal(ran, true);

  ran = false;
  const dm = interaction({ guildId: '', channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false } });
  client.emit('interactionCreate', dm);
  await flush();
  assert.equal(ran, false);
  assert.equal(dm.replies[0].content, 'Use this bot in the Warframe category.');
  assert.equal(dm.replies[0].flags, MessageFlags.Ephemeral);
});

test('uncaught command failures stay generic and alert staff without secrets', async () => {
  const sent = [];
  const client = new EventEmitter();
  installCategoryGate(client, {
    bot: 'cephalon',
    env: { NEXUS_STAFF_ALERT_CHANNEL_ID: '1516640233389822042' }
  });
  client.on('interactionCreate', () => {
    throw new Error('password=super-secret-rcon mysql://root:pw@db/app');
  });
  const failed = interaction({
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false },
    client: { channels: { fetch: async () => ({ send: async (message) => sent.push(message) }) } }
  });
  client.emit('interactionCreate', failed);
  await flush();
  await flush();
  assert.equal(failed.replies[0].content, PLAYER_FAILURE_MESSAGE);
  assert.equal(failed.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /Command: \/market/);
  assert.match(sent[0].content, /User: 42/);
  assert.match(sent[0].content, /Class: Error/);
  assert.match(sent[0].content, /Cephalon Nexus/);
  assert.doesNotMatch(sent[0].content, /super-secret-rcon/);
  assert.doesNotMatch(sent[0].content, /mysql:\/\//);
  assert.doesNotMatch(failed.replies[0].content, /super-secret-rcon/);
});

test('scoped help lists only that bot and points wallet, verify, and ranks at Sentinal', async () => {
  const cephalon = helpText('cephalon');
  const ascended = helpText('ascended');
  for (const name of CEPHALON_COMMANDS) assert.match(cephalon, new RegExp(`/${name}\\b`));
  for (const name of ASCENDED_COMMANDS) assert.match(ascended, new RegExp(`/${name}\\b`));
  assert.match(cephalon, /\/market/);
  assert.match(cephalon, /\/warframe/);
  assert.match(cephalon, /\/nexushelp/);
  assert.match(cephalon, /\/status/);
  assert.doesNotMatch(cephalon, /\/arkrcon/);
  assert.match(ascended, /\/arkrcon/);
  assert.doesNotMatch(ascended, /\/warframe/);
  for (const text of [cephalon, ascended]) {
    assert.match(text, /Nexus Sentinal/);
    assert.match(text, /\/bal/);
    assert.match(text, /\/o9verify/);
    assert.match(text, /ranks/);
    assert.doesNotMatch(text, /Sentinel/);
    assert.doesNotMatch(text, /• `\/bal`/);
  }
  assert.deepEqual(opsCommandBuilders().map((command) => command.toJSON().name).sort(), ['nexushelp', 'status']);
  for (const command of opsCommandBuilders()) assert.ok(command.toJSON().description.length <= 100);

  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'cephalon', env: {} });
  installOpsSpine(client, { bot: 'cephalon', env: {}, config: { discord: { guildId: 'g', ownerUserIds: [], operatorRoleIds: [] } } });
  const denied = interaction({ guildId: null, channel: null, commandName: 'nexushelp' });
  client.emit('interactionCreate', denied);
  await flush();
  await flush();
  assert.equal(denied.replies.length, 1);
  assert.match(denied.replies[0].content, /Warframe category/);

  const allowed = interaction({
    commandName: 'nexushelp',
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  });
  client.emit('interactionCreate', allowed);
  await flush();
  await flush();
  assert.match(allowed.replies[0].content, /Cephalon Nexus help/);
  assert.match(allowed.replies[0].content, /Nexus Sentinal/);
  assert.equal(allowed.replies[0].flags, MessageFlags.Ephemeral);
});

test('staff status reports discord, arkshop retirement, and deploy sha without RCON secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascended-status-'));
  const env = {
    ARKSHOP_DB_MODE: 'disabled',
    NEXUS_RCON_RAILWAY_ENV_FORBIDDEN: 'true',
    NEXUS_RCON_SOURCE: 'discord_override_store',
    NEXUS_DATA_DIR: dir,
    ARK_GEN1_HOST: '203.0.113.9',
    ARK_GEN1_RCON_PORT: '28015',
    ARK_GEN1_RCON_PASSWORD: 'super-secret-rcon',
    RAILWAY_GIT_COMMIT_SHA: 'abc1234def56789'
  };
  try {
    const text = await buildStatusText({ bot: 'ascended', client: { isReady: () => true }, env });
    assert.match(text, /Discord: ready/);
    assert.match(text, /ARKSHOP_DB_MODE=disabled/);
    assert.match(text, /ArkShop MySQL retired/);
    assert.match(text, /Deploy `abc1234`/);
    assert.match(text, /Nexus Sentinal/);
    assert.match(text, /RCON health: no self-check recorded yet/);
    assert.doesNotMatch(text, /super-secret-rcon/);
    assert.doesNotMatch(text, /203\.0\.113\.9/);
    assert.doesNotMatch(text, /28015/);
    assert.doesNotMatch(text, /Sentinel/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const cephalon = await buildStatusText({
    bot: 'cephalon',
    client: { isReady: () => false },
    env: { NEXUS_BACKEND_URL: 'http://127.0.0.1:9', RAILWAY_GIT_COMMIT_SHA: 'not a secret' },
    probe: async () => ({ label: 'Healthy', detail: 'mysql://root:super-secret-rcon@db/app' })
  });
  assert.match(cephalon, /Discord: not ready/);
  assert.match(cephalon, /Warframe backend: Healthy/);
  assert.match(cephalon, /Deploy SHA is not exposed/);
  assert.doesNotMatch(cephalon, /ARKSHOP_DB_MODE/);
  assert.doesNotMatch(cephalon, /super-secret-rcon/);
  assert.equal(deployTip({ RAILWAY_GIT_COMMIT_SHA: 'password=super-secret-rcon' }), 'Deploy SHA is not exposed in this environment.');

  const denied = interaction({
    commandName: 'status',
    user: { id: '5' },
    memberPermissions: { has: () => false }
  });
  const deniedResult = await handleOpsCommand(denied, {
    bot: 'cephalon',
    config: { discord: { ownerUserIds: [], operatorRoleIds: [] } },
    env: {}
  });
  assert.equal(deniedResult, true);
  assert.match(denied.replies[0].content, /restricted to Nexus staff/);
  assert.equal(denied.replies[0].flags, MessageFlags.Ephemeral);

  let edited = '';
  const staff = interaction({
    commandName: 'status',
    user: { id: '7' },
    memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
    deferReply: async (payload) => { staff.deferred = true; staff.replies.push(payload); },
    editReply: async (payload) => { edited = payload.content; }
  });
  await handleOpsCommand(staff, {
    bot: 'ascended',
    client: { isReady: () => true },
    env,
    config: { discord: { ownerUserIds: [], operatorRoleIds: ['operator-role'] } }
  });
  assert.match(edited, /Nexus Ascended status/);
  assert.doesNotMatch(edited, /super-secret-rcon/);

  const operator = interaction({
    commandName: 'status',
    user: { id: '8' },
    member: { roles: { cache: { some: (fn) => fn({ id: 'operator-role' }) } } },
    memberPermissions: { has: () => false },
    deferReply: async () => { operator.deferred = true; },
    editReply: async (payload) => { operator.edited = payload.content; }
  });
  await handleOpsCommand(operator, {
    bot: 'cephalon',
    client: { isReady: () => true },
    env: {},
    probe: async () => ({ label: 'Healthy' }),
    config: { discord: { ownerUserIds: [], operatorRoleIds: ['operator-role'] } }
  });
  assert.match(operator.edited, /Warframe backend: Healthy/);
});

test('direct failure report redacts secrets and stays ephemeral after defer', async () => {
  const sent = [];
  const deferred = interaction({
    commandName: 'warframe',
    user: { id: '99' },
    deferred: true,
    client: { channels: { fetch: async () => ({ send: async (message) => sent.push(message) }) } }
  });
  setGameBotMeta(deferred.client, { bot: 'cephalon' });
  const result = await reportCommandFailure(deferred, Object.assign(new Error('token=super-secret-rcon'), { name: 'DiscordAPIError', code: 50013 }), {
    env: { NEXUS_STAFF_ALERT_CHANNEL_ID: '1516640233389822042' }
  });
  assert.equal(result.delivered, true);
  assert.equal(deferred.replies[0].content, PLAYER_FAILURE_MESSAGE);
  assert.doesNotMatch(JSON.stringify(sent), /super-secret-rcon/);
  assert.match(sent[0].content, /Class: DiscordAPIError:50013/);
  assert.equal(redactSecrets('mysql://root:pw@db/app password=super-secret-rcon'), '[redacted-url] password=[redacted]');
});

test('Sentinal is not category-locked and Railway files keep RCON out of Ascended env', () => {
  assert.equal(commandOwner('nexushelp'), 'sentinal');
  assert.equal(commandOwner('status'), 'sentinal');
  assert.equal(sentinalShouldRegister('nexus'), true);
  assert.equal(sentinalShouldRegister('market'), false);
  assert.doesNotMatch(read('src/sentinel/entry.cjs'), /installCategoryGate|installOpsSpine|category-gate/);
  assert.doesNotMatch(read('src/railway/sentinal-service.cjs'), /installCategoryGate|installOpsSpine|category-gate/);
  assert.match(read('src/game-bots/start.cjs'), /installCategoryGate/);
  assert.match(read('src/game-bots/start.cjs'), /installOpsSpine/);
  assert.match(read('Dockerfile.cephalon'), /CEPHALON_DISCORD_CATEGORY_ID=1516640233389822042/);
  assert.match(read('Dockerfile.cephalon'), /CEPHALON_JTC_LOBBY_CHANNEL_ID=1540877236184424500/);
  assert.match(read('Dockerfile.ascended'), /ASCENDED_DISCORD_CATEGORY_ID=1516602943670059108/);
  assert.match(read('Dockerfile.ascended'), /ASCENDED_JTC_LOBBY_CHANNEL_ID=1540867019979890829/);
  assert.doesNotMatch(read('Dockerfile.ascended'), /_RCON_PASSWORD|_RCON_PORT|_HOST=/);
  assert.match(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /1516602943670059108/);
  assert.match(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /1516640233389822042/);
  assert.match(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /1540877236184424500/);
  assert.match(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /1540867019979890829/);
  assert.match(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /Nexus Sentinal/);
  assert.doesNotMatch(read('docs/ops/STAGE1_GAME_BOT_OPS.md'), /Sentinel/);
});
