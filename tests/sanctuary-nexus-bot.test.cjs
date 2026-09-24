'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Events, MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  OWNER_CATEGORY_IDS,
  gameBotKey,
  resolveCategoryConfig,
  redirectMessage,
  evaluateCategoryAccess,
  installCategoryGate
} = require('../src/game-bots/category-gate.cjs');
const { helpText, buildStatusText, installOpsSpine } = require('../src/game-bots/ops-spine.cjs');
const { safeBotName } = require('../src/game-bots/command-failure.cjs');
const {
  sanctuaryCommands,
  bindSanctuaryCommands,
  handleSanctuaryInteraction,
  registerSanctuaryCommands,
  resolvedRoleGroups,
  syncRoleMenu
} = require('../src/sentinel/sanctuary-bot.cjs');
const {
  allRoleNames,
  planRoles,
  roleDiff,
  safeHttpLink,
  createLfgEntry,
  lfgMessage,
  toggleItem,
  SanctuaryStore,
  sanctuaryHelpText,
  resolveButtonChannel
} = require('../src/sentinel/sanctuary-suite.cjs');
const { communityEventSchedule, eventTimerMessage } = require('../src/sentinel/sanctuary-events.cjs');

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
    isStringSelectMenu: () => false,
    isButton: () => false,
    deferReply: async (payload = {}) => {
      target.deferred = true;
      replies.push(payload || {});
      return payload;
    },
    reply: record,
    editReply: record,
    followUp: record,
    update: record,
    replies,
    options: { getSubcommand: () => 'help', getString: () => null, getBoolean: () => false, getChannel: () => null },
    ...overrides
  };
  return target;
}

function walkOptions(option, names) {
  assert.ok(option.description.length <= 100, option.name);
  if (option.name) names.push(option.name);
  for (const choice of option.choices || []) assert.ok(choice.name.length <= 100);
  for (const child of option.options || []) walkOptions(child, names);
}

test('sanctuary category id stays env-only and prefers SANCTUARY_DISCORD_CATEGORY_ID', () => {
  assert.deepEqual(Object.keys(OWNER_CATEGORY_IDS).sort(), ['ascended', 'cephalon']);
  assert.equal(OWNER_CATEGORY_IDS.sanctuary, undefined);
  const primary = resolveCategoryConfig('sanctuary', {
    SANCTUARY_DISCORD_CATEGORY_ID: '2000000000000000001',
    DIABLO_DISCORD_CATEGORY_ID: '2000000000000000002'
  });
  assert.equal(primary.source, 'env');
  assert.equal(primary.envName, 'SANCTUARY_DISCORD_CATEGORY_ID');
  assert.equal(primary.id, '2000000000000000001');
  assert.equal(primary.open, false);
  const alias = resolveCategoryConfig('sanctuary', { DIABLO_DISCORD_CATEGORY_ID: '2000000000000000002' });
  assert.equal(alias.envName, 'DIABLO_DISCORD_CATEGORY_ID');
  assert.equal(alias.id, '2000000000000000002');
  assert.equal(resolveCategoryConfig('sanctuary', {}).open, true);
  assert.doesNotMatch(read('Dockerfile.sanctuary'), /SANCTUARY_DISCORD_CATEGORY_ID|DIABLO_DISCORD_CATEGORY_ID/);
  assert.doesNotMatch(read('src/railway/sanctuary-service.cjs'), /SANCTUARY_DISCORD_CATEGORY_ID\s*=\s*\d+/);
  assert.match(read('src/game-bots/start.cjs'), /resolveCategoryConfig/);
  assert.match(read('src/game-bots/start.cjs'), /installCategoryGate/);
});

test('button panels use the env channel and skip auto-post when it is unset', async () => {
  assert.equal(resolveButtonChannel({}).source, 'unset');
  assert.equal(resolveButtonChannel({}).ok, false);
  const primary = resolveButtonChannel({
    SANCTUARY_BUTTON_CHANNEL_ID: '2000000000000000001',
    SANCTUARY_COMMANDS_CHANNEL_ID: '2000000000000000002',
    DIABLO_BUTTON_CHANNEL_ID: '2000000000000000003'
  });
  assert.equal(primary.envName, 'SANCTUARY_BUTTON_CHANNEL_ID');
  assert.equal(primary.id, '2000000000000000001');
  const commandsAlias = resolveButtonChannel({
    SANCTUARY_BUTTON_CHANNEL_ID: ' ',
    SANCTUARY_COMMANDS_CHANNEL_ID: '2000000000000000002'
  });
  assert.equal(commandsAlias.envName, 'SANCTUARY_COMMANDS_CHANNEL_ID');
  const diabloAlias = resolveButtonChannel({ DIABLO_BUTTON_CHANNEL_ID: '2000000000000000003' });
  assert.equal(diabloAlias.envName, 'DIABLO_BUTTON_CHANNEL_ID');
  const invalid = resolveButtonChannel({
    SANCTUARY_BUTTON_CHANNEL_ID: 'nope',
    DIABLO_BUTTON_CHANNEL_ID: '2000000000000000003'
  });
  assert.equal(invalid.source, 'invalid');
  assert.equal(invalid.ok, false);
  assert.doesNotMatch(read('Dockerfile.sanctuary') + read('src/sentinel/sanctuary-suite.cjs') + read('src/sentinel/sanctuary-bot.cjs'), /SANCTUARY_BUTTON_CHANNEL_ID=\d+/);

  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const skipped = await syncRoleMenu({ env: {}, client: { channels: { fetch: async () => { throw new Error('fetch'); } } }, store: new SanctuaryStore() }, { roles: { cache: { values: () => [] } } });
    assert.equal(skipped.posted, false);
    assert.equal(skipped.reason, 'unset');
    assert.match(warnings.join('\n'), /SANCTUARY_BUTTON_CHANNEL_ID is unset/);
  } finally {
    console.warn = original;
  }

  const buttonId = '2000000000000000042';
  let edited = null;
  let sent = 0;
  const channel = { parentId: CATEGORY, isThread: () => false, send: async () => { sent += 1; } };
  const store = new SanctuaryStore();
  store.setPanelId('roles', '77');
  const roles = new Map(allRoleNames().map((name, index) => [String(index + 1), { id: String(1700000000000000000n + BigInt(index)), name }]));
  const guild = {
    roles: { cache: { values: () => roles.values(), find: (fn) => [...roles.values()].find(fn) } },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
  };
  const discord = {
    channels: {
      fetch: async (id) => {
        assert.equal(id, buttonId);
        return {
          id,
          send: async () => { sent += 1; return { id: 'new' }; },
          messages: { fetch: async (id) => (id === '77' ? { id: '77', edit: async (payload) => { edited = payload; } } : null) }
        };
      }
    }
  };
  const env = { SANCTUARY_BUTTON_CHANNEL_ID: buttonId };
  const posted = await handleSanctuaryInteraction(interaction({
    channel,
    user: { id: '7' },
    guild,
    options: { getSubcommand: () => 'roles', getBoolean: (name) => name === 'post', getString: () => null, getChannel: () => null }
  }), {
    config: { discord: { ownerUserIds: ['7'], operatorRoleIds: [] } },
    env,
    store,
    client: discord,
    schedule: false
  });
  assert.equal(posted, true);
  assert.equal(sent, 0);
  assert.match(edited.embeds[0].title, /Sanctuary Nexus roles/);
  assert.equal(store.panelId('roles'), '77');
});

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

test('a set sanctuary category denies other categories, DMs, and components', async () => {
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
  const store = new SanctuaryStore();
  bindSanctuaryCommands(client, {
    config: { discord: { guildId: 'guild' } },
    env,
    store,
    schedule: false
  });
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

  let applied = 0;
  const select = interaction({
    guildId: null,
    channel: null,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    customId: 'sanctuary:roles:class',
    values: ['1'],
    member: { roles: { add: async () => { applied += 1; }, cache: { keys: () => [] } } }
  });
  client.emit('interactionCreate', select);
  await flush();
  assert.equal(applied, 0);
  assert.match(select.replies[0].content, /Sanctuary category/);

  const thread = interaction({
    channel: { isThread: () => true, parentId: 'parent-text', parent: { parentId: CATEGORY } }
  });
  client.emit('interactionCreate', thread);
  await flush();
  assert.equal(ran, 1);
  assert.equal(thread.replies.length, 1);
  assert.match(thread.replies[0].embeds[0].description, /Sanctuary Nexus help/);
  assert.equal(thread.replies[0].flags, MessageFlags.Ephemeral);

  const cephalonStillDefault = resolveCategoryConfig('cephalon', {});
  assert.equal(cephalonStillDefault.id, '1516640233389822042');
  assert.equal(cephalonStillDefault.open, false);
  assert.equal(resolveCategoryConfig('ascended', {}).source, 'default');
});

test('sanctuary command registration surface lists the v1 suite', async () => {
  const command = sanctuaryCommands()[0].toJSON();
  assert.equal(command.name, 'sanctuary');
  assert.ok(command.description.length <= 100);
  const names = [];
  for (const option of command.options) walkOptions(option, names);
  assert.deepEqual(names.filter((name) => ['help', 'roles', 'lfg', 'build', 'season', 'seasonpost', 'status', 'timers', 'events'].includes(name)).sort(), [
    'build', 'events', 'help', 'lfg', 'roles', 'season', 'seasonpost', 'status', 'timers'
  ]);
  assert.ok(names.includes('activity'));
  assert.ok(names.includes('link'));
  assert.ok(names.includes('reregister'));
  assert.equal(allRoleNames().length, 17);
  assert.equal(planRoles([], false).ready, false);
  assert.equal(planRoles(allRoleNames(), false).ready, true);
  assert.deepEqual(roleDiff(['1', '2'], ['1', '2', '3'], ['3']), { add: ['3'], remove: ['1', '2'] });
  assert.equal(safeHttpLink('javascript:alert(1)'), '');
  assert.equal(safeHttpLink('https://user:pass@example.com/build'), '');
  assert.equal(safeHttpLink('https://example.com/build'), 'https://example.com/build');
  assert.deepEqual(toggleItem(['roles'], 'roles'), []);
  assert.deepEqual(toggleItem([], 'build'), ['build']);

  const created = [];
  await registerSanctuaryCommands({
    commands: {
      fetch: async () => ({ find: () => null }),
      create: async (json) => { created.push(json); return json; }
    }
  });
  assert.deepEqual(created.map((item) => item.name), ['sanctuary']);

  const help = helpText('sanctuary');
  assert.equal(help, sanctuaryHelpText());
  assert.match(help, /Sanctuary Nexus help/);
  assert.match(help, /\/nexushelp/);
  assert.match(help, /\/sanctuary lfg/);
    assert.match(help, /\/sanctuary timers/);
    assert.match(help, /live community trackers/);
  assert.match(help, /\/sanctuary roles/);
  assert.match(help, /\/sanctuary build/);
  assert.match(help, /\/sanctuary season/);
  assert.match(help, /\/status/);
  assert.match(help, /Nexus Sentinal/);
  assert.match(help, /\/bal/);
  assert.match(help, /\/o9verify/);
  assert.match(help, /shop/);
  assert.match(help, /ranks/);
  assert.doesNotMatch(help, /\/warframe/);
  assert.doesNotMatch(help, /\/arkrcon/);
  assert.doesNotMatch(help, /Sentinel/);
  assert.doesNotMatch(help, /Nephalem/);
  assert.doesNotMatch(helpText('cephalon'), /\/sanctuary/);
  assert.doesNotMatch(helpText('ascended'), /\/sanctuary/);
});

test('player commands post embeds inside the category and stay ephemeral for private views', async () => {
  const buttonId = '2000000000000000099';
  const posted = [];
  const env = { SANCTUARY_DISCORD_CATEGORY_ID: CATEGORY, SANCTUARY_BUTTON_CHANNEL_ID: buttonId, READY: 'true' };
  const store = new SanctuaryStore();
  const config = { discord: { guildId: 'guild', ownerUserIds: ['7'], operatorRoleIds: [] } };
  const context = {
    config,
    env,
    store,
    schedule: false,
    client: {
      isReady: () => true,
      ws: { ping: 42 },
      channels: {
        fetch: async (id) => ({
          id,
          send: async (payload) => { posted.push({ id, payload }); return { id: '555' }; }
        })
      }
    }
  };
  const channel = { parentId: CATEGORY, isThread: () => false };
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('fetch called'); };
  try {
    const lfg = interaction({
      channel,
      options: {
        getSubcommand: () => 'lfg',
        getString: (name) => (name === 'activity' ? 'helltide' : 'meet @everyone'),
        getBoolean: () => false,
        getChannel: () => ({ id: '1516602943670059108' })
      },
      fetchReply: async () => ({ id: '99' })
    });
    assert.equal(await handleSanctuaryInteraction(lfg, context), true);
    assert.equal(lfg.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(lfg.replies[0].content, /button channel/);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].id, buttonId);
    assert.match(posted[0].payload.embeds[0].title, /Helltide/);
    assert.equal(posted[0].payload.components[0].components[0].custom_id.startsWith('sanctuary:lfg:close:'), true);
    assert.doesNotMatch(posted[0].payload.embeds[0].description, /@everyone/);
    assert.equal(posted[0].payload.content, 'Voice: <#1516602943670059108>');
    assert.equal(store.state.lfg[0].channelId, buttonId);
    assert.doesNotMatch(lfg.replies[0].content, new RegExp(buttonId));

    const badBuild = interaction({
      channel,
      options: {
        getSubcommand: () => 'build',
        getString: (name) => (name === 'link' ? 'not a link' : 'barbarian'),
        getBoolean: () => false,
        getChannel: () => null
      }
    });
    await handleSanctuaryInteraction(badBuild, context);
    assert.match(badBuild.replies[0].content, /http or https/);
    assert.equal(badBuild.replies[0].flags, MessageFlags.Ephemeral);

    const build = interaction({
      channel,
      options: {
        getSubcommand: () => 'build',
        getString: (name) => ({ link: 'https://example.com/build', class: 'barbarian', type: 'pit', note: 'speed clear' }[name]),
        getBoolean: () => false,
        getChannel: () => null
      }
    });
    await handleSanctuaryInteraction(build, context);
    assert.equal(build.replies[0].flags, undefined);
    assert.match(build.replies[0].embeds[0].description, /does not open or scrape/);
    assert.equal(build.replies[0].embeds[0].fields.find((field) => field.name === 'Class').value, 'Barbarian');

    const season = interaction({ channel, options: { getSubcommand: () => 'season', getString: () => null, getBoolean: () => false, getChannel: () => null } });
    await handleSanctuaryInteraction(season, context);
    assert.equal(season.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(season.replies[0].embeds[0].description, /☐/);
    const check = interaction({
      channel,
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'sanctuary:check:roles',
      options: undefined
    });
    await handleSanctuaryInteraction(check, context);
    assert.match(check.replies[0].embeds[0].description, /☑ Class/);

    const deniedPost = interaction({
      channel,
      user: { id: '5' },
      memberPermissions: { has: () => false },
      options: { getSubcommand: () => 'seasonpost', getString: () => 'Tonight', getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(deniedPost, context);
    assert.match(deniedPost.replies[0].content, /restricted to Sanctuary Nexus staff/);
    assert.equal(deniedPost.replies[0].flags, MessageFlags.Ephemeral);

    const post = interaction({
      channel,
      user: { id: '7' },
      options: { getSubcommand: () => 'seasonpost', getString: (name) => (name === 'title' ? 'Season window' : 'Groups are open'), getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(post, context);
    assert.equal(post.replies[0].flags, undefined);
    assert.match(post.replies[0].embeds[0].description, /Herald template/);
    assert.match(post.replies[0].embeds[0].description, /Nexus Sentinal/);

    const deniedStatus = interaction({
      channel,
      user: { id: '5' },
      memberPermissions: { has: () => false },
      options: { getSubcommand: () => 'status', getString: () => null, getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(deniedStatus, context);
    assert.match(deniedStatus.replies[0].content, /restricted to Sanctuary Nexus staff/);

    const status = interaction({
      channel,
      user: { id: '7' },
      guild: { name: 'Khaos' },
      client: context.client,
      options: { getSubcommand: () => 'status', getString: () => null, getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(status, context);
    assert.match(status.replies[0].content, /Discord: ready/);
    assert.match(status.replies[0].content, /READY flag: true/);
    assert.match(status.replies[0].content, /Category id: present/);
    assert.match(status.replies[0].content, /Latency: 42 ms/);
    assert.match(status.replies[0].content, /live community trackers, with an approximate fallback/);

    const timers = interaction({
      channel,
      options: { getSubcommand: () => 'timers', getString: () => null, getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(timers, context);
    const timerEmbed = timers.replies.find((item) => item.embeds)?.embeds[0];
    assert.equal(timers.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(timerEmbed.description, /Community tracker did not answer/);
    assert.match(timerEmbed.description, /Approximate community schedule/);
    assert.match(timerEmbed.description, /Helltide/);
    assert.match(timerEmbed.description, /World boss/);
    assert.match(timerEmbed.description, /does not count one down/);
    assert.match(timerEmbed.description, /\/sanctuary lfg/);
    assert.match(timerEmbed.footer.text, /diablo4\.life unavailable/);
    assert.match(timerEmbed.footer.text, /not Blizzard-official/);
    assert.equal(posted.length, 1);
    assert.doesNotMatch(status.replies[0].content, new RegExp(CATEGORY));
    assert.equal(status.replies[0].flags, MessageFlags.Ephemeral);

    const missingRoles = interaction({
      channel,
      guild: { roles: { cache: { values: () => [], find: () => null } }, members: { me: { permissions: { has: () => false } } } },
      options: { getSubcommand: () => 'roles', getString: () => null, getBoolean: () => false, getChannel: () => null }
    });
    await handleSanctuaryInteraction(missingRoles, context);
    assert.match(missingRoles.replies[0].embeds[0].title, /need setup/);
    assert.match(missingRoles.replies[0].embeds[0].fields[0].value, /Sanctuary Barbarian/);
    assert.match(missingRoles.replies[0].embeds[0].fields[0].value, /Sanctuary World Tier 1/);
    assert.equal(missingRoles.replies[0].flags, MessageFlags.Ephemeral);
  } finally {
    global.fetch = originalFetch;
  }

  const entry = createLfgEntry({ id: 'abc', userId: '42', activity: 'pit', now: 1_700_000_000_000, ttlMs: 1000 });
  entry.closed = true;
  entry.reason = 'expired';
  assert.match(lfgMessage(entry).embeds[0].title, /expired/);
  assert.deepEqual(lfgMessage(entry).components, []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctuary-store-'));
  try {
    const disk = new SanctuaryStore(path.join(dir, 'sanctuary-nexus.json'));
    disk.setChecks('42', ['roles', 'nope']);
    disk.saveLfg(createLfgEntry({ id: 'disk', userId: '42', activity: 'boss' }));
    const again = new SanctuaryStore(path.join(dir, 'sanctuary-nexus.json'));
    assert.deepEqual(again.checksFor('42'), ['roles']);
    assert.equal(again.getLfg('disk').activity, 'boss');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing sanctuary roles are created under the bot when Manage Roles is granted', async () => {
  const roles = new Map();
  const cache = {
    values: () => roles.values(),
    find: (fn) => [...roles.values()].find(fn)
  };
  const guild = {
    roles: {
      cache,
      create: async ({ name }) => {
        const role = { id: String(1700000000000000000n + BigInt(roles.size)), name };
        roles.set(role.id, role);
        return role;
      },
      fetch: async () => cache
    }
  };
  const me = { permissions: { has: () => true }, roles: { highest: { position: 5 } } };
  const resolved = await resolvedRoleGroups(guild, me);
  assert.equal(roles.size, allRoleNames().length);
  assert.equal(resolved.ready, true);
  assert.equal(resolved.groups.length, 3);
  assert.equal(resolved.groups.find((group) => group.id === 'class').roles.length, 8);
  assert.equal(resolved.missing.length, 0);
});

test('sanctuary help and status stay off other bots and off a baked category id', async () => {
  const status = await buildStatusText({
    bot: 'sanctuary',
    client: { isReady: () => true },
    env: { RAILWAY_GIT_COMMIT_SHA: 'abc1234def56789', SANCTUARY_DISCORD_CATEGORY_ID: CATEGORY }
  });
  assert.match(status, /Sanctuary Nexus status/);
  assert.match(status, /Discord: ready/);
  assert.match(status, /Category id: present/);
  assert.match(status, /No game backend is started/);
  assert.match(status, /live community trackers, with an approximate fallback/);
  assert.doesNotMatch(status, /Warframe backend|RCON|ArkShop/);
  assert.doesNotMatch(status, new RegExp(CATEGORY));

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

  const dockerfile = read('Dockerfile.sanctuary');
  const service = read('src/railway/sanctuary-service.cjs');
  const suite = read('src/sentinel/sanctuary-suite.cjs');
  const bot = read('src/sentinel/sanctuary-bot.cjs');
  const events = read('src/sentinel/sanctuary-events.cjs');
  const doc = read('docs/ops/SANCTUARY_NEXUS_DISCORD.md');
  const runbook = read('docs/ops/sanctuary-bot-runbook.md');
  assert.match(dockerfile, /FROM node:22-slim/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /NEXUS_GAME_ROLE=diablo/);
  assert.match(dockerfile, /src\/railway\/sanctuary-service\.cjs/);
  assert.match(dockerfile, /SANCTUARY_JTC_LOBBY_CHANNEL_ID=1541540961937526916/);
  assert.doesNotMatch(dockerfile, /busybox|_RCON_PASSWORD|_RCON_PORT|_HOST=|SANCTUARY_DISCORD_CATEGORY_ID=\d+/i);
  assert.match(service, /botName: 'Sanctuary Nexus'/);
  assert.match(service, /serviceName: 'sanctuary-nexus'/);
  assert.match(service, /gameRole: 'diablo'/);
  assert.match(service, /installGuildMembersIntentExtension/);
  assert.match(service, /bindSanctuaryCommands/);
  assert.match(service, /startGameBot/);
  assert.doesNotMatch(service, /backend\/server|RCON|Nephalem|Sentinel/);
  const sources = suite + bot + events;
  assert.doesNotMatch(sources, /news\.blizzard\.com|_RCON_|Nephalem|Sentinel|d4api\.dev|d4armory|helltides\.com/);
  assert.match(events, /https:\/\/diablo4\.life\/api\/trackers\/list/);
  assert.doesNotMatch(sources.replace(/https:\/\/diablo4\.life\/api\/trackers\/list/g, ''), /\bhttps?:\/\//);
  assert.match(runbook, /d4api\.dev/);
  assert.match(runbook, /SANCTUARY_WORLD_BOSS_ANCHOR/);
  assert.match(runbook, /warframestat\.us/);
  assert.match(runbook, /officialserverstatus\.ini/);
  assert.match(runbook, /Bungie API key/);
  for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_GUILD_ID', 'SANCTUARY_DISCORD_CATEGORY_ID', 'READY', 'Dockerfile.sanctuary']) {
    assert.match(doc, new RegExp(name.replace(/\./g, '\\.')));
    assert.match(runbook, new RegExp(name.replace(/\./g, '\\.')));
  }
  assert.match(runbook, /Server Members Intent/);
  assert.match(runbook, /oauth2\/authorize/);
  assert.match(runbook, /Rollback/);
  assert.match(runbook, /DIABLO_DISCORD_CATEGORY_ID/);
  assert.match(doc, /Nexus Sentinal/);
  assert.match(doc, /BusyBox/);
  assert.doesNotMatch(doc + runbook, /Nephalem|Sentinel/);
  assert.doesNotMatch(suite + bot + dockerfile + runbook, /SANCTUARY_DISCORD_CATEGORY_ID=\d+/);
  assert.match(read('Dockerfile.sentinal'), /Dockerfile\.sanctuary/);
  assert.match(read('Dockerfile.sentinal'), /sanctuary-bot-runbook\.md/);
  const bits = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageRoles
  ].reduce((sum, bit) => BigInt(sum) | BigInt(bit), 0n);
  assert.match(runbook, new RegExp(bits.toString()));
});

test('sanctuary timers use the community cadence and do not call the network', async () => {
  const during = Date.parse('2026-09-23T23:37:00.000Z');
  const live = communityEventSchedule(during, {});
  assert.equal(live.helltide.active, true);
  assert.equal(live.helltide.end, Date.parse('2026-09-23T23:55:00.000Z'));
  assert.equal(live.worldBoss.active, true);
  assert.equal(live.worldBoss.end, Date.parse('2026-09-23T23:45:00.000Z'));
  assert.equal(live.worldBoss.phase, 'built-in');
  assert.equal(live.legion.pinned, false);

  const gap = communityEventSchedule(Date.parse('2026-09-23T23:57:00.000Z'), {});
  assert.equal(gap.helltide.active, false);
  assert.equal(gap.helltide.start, Date.parse('2026-09-24T00:00:00.000Z'));
  assert.equal(gap.worldBoss.active, false);
  assert.equal(gap.worldBoss.start, Date.parse('2026-09-24T03:00:00.000Z'));

  const beforeAnchor = communityEventSchedule(Date.parse('2026-09-23T19:00:00.000Z'), {});
  assert.equal(beforeAnchor.worldBoss.active, false);
  assert.equal(beforeAnchor.worldBoss.start, Date.parse('2026-09-23T20:00:00.000Z'));

  const pinned = communityEventSchedule(during, { SANCTUARY_LEGION_ANCHOR: '2026-09-23T23:55:00.000Z' });
  assert.equal(pinned.legion.pinned, true);
  assert.equal(pinned.legion.active, false);
  assert.equal(pinned.legion.start, Date.parse('2026-09-23T23:55:00.000Z'));
  const legionLive = communityEventSchedule(Date.parse('2026-09-23T23:41:00.000Z'), {
    SANCTUARY_LEGION_ANCHOR: '2026-09-23T23:40:00.000Z',
    SANCTUARY_WORLD_BOSS_ANCHOR: 'not-a-time'
  });
  assert.equal(legionLive.legion.active, true);
  assert.equal(legionLive.legion.end, Date.parse('2026-09-23T23:44:00.000Z'));
  assert.equal(legionLive.worldBoss.phase, 'built-in');

  const shifted = communityEventSchedule(during, { SANCTUARY_WORLD_BOSS_ANCHOR: '2026-09-23T23:00:00.000Z' });
  assert.equal(shifted.worldBoss.phase, 'env');
  assert.equal(shifted.worldBoss.active, false);
  assert.equal(shifted.worldBoss.start, Date.parse('2026-09-24T02:30:00.000Z'));

  const text = eventTimerMessage(live).embeds[0].description;
  assert.match(text, /Approximate community schedule/);
  assert.match(text, /<t:\d+:R>/);
  assert.doesNotMatch(text, /Ashava|Avarice|Azmodan|d4api/);

  const events = interaction({
    channel: { parentId: CATEGORY, isThread: () => false },
    options: { getSubcommand: () => 'events', getString: () => null, getBoolean: () => false, getChannel: () => null }
  });
  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = () => {
    networkCalls += 1;
    throw new Error('live network is not used by this test');
  };
  try {
    assert.equal(await handleSanctuaryInteraction(events, {
      env: {},
      schedule: false,
      trackerCache: { entry: null, pending: null },
      trackerFetch: async () => { throw new Error('offline fixture'); }
    }), true);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(networkCalls, 0);
  assert.equal(events.replies[0].flags, MessageFlags.Ephemeral);
  const eventEmbed = events.replies.find((item) => item.embeds)?.embeds[0];
  assert.match(eventEmbed.title, /event timers/);
  assert.match(eventEmbed.description, /approximate, not a live report/);
});
