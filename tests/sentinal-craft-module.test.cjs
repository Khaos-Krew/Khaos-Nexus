'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Events } = require('discord.js');
const { craftHelpText } = require('../src/craft/help.cjs');
const { CraftStore } = require('../src/craft/store.cjs');
const { handleMcPointsCommand } = require('../src/craft/mc-points-commands.cjs');
const { commandDefinitions } = require('../src/sentinel/friendly-commands.cjs');
const {
  CRAFT_COMMAND_NAMES,
  MODULE_OFF,
  attachCraftModule,
  craftModuleEnabled,
  craftModuleLayoutPolicy,
  handleSentinalCraftInteraction,
  repostOpenRealms,
  sentinalCraftCommands
} = require('../src/sentinel/craft-module.cjs');

const root = path.resolve(__dirname, '..');
const GUILD = '1016059608789434408';
const CATEGORY = '1516602943670059108';
const CHANNEL = '1516602943670059109';
const OWNER = '1516602943670059101';
const STRANGER = '1541540940471210128';
const OLD_MESSAGE = '1516602943670059110';
const NEW_MESSAGE = '1516602943670059111';

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function commandNamesFromSentinalSource() {
  const names = new Set(commandDefinitions().map((command) => command.name));
  const dir = path.join(root, 'src/sentinel');
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.cjs') && !entry.name.startsWith('craft-module')) files.push(full);
    }
  };
  walk(dir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/SlashCommandBuilder\(\)(?:\s*\n\s*)?\.setName\('([a-z0-9-]+)'\)/g)) names.add(match[1]);
    for (const match of text.matchAll(/new SlashCommandBuilder\(\)\.setName\('([a-z0-9-]+)'\)/g)) names.add(match[1]);
  }
  return names;
}

function chat(commandName, sub, { userId = OWNER, staff = false, category = CATEGORY } = {}) {
  const replies = [];
  const interaction = {
    commandName,
    customId: '',
    user: { id: userId },
    guildId: GUILD,
    channelId: CHANNEL,
    channel: { parentId: category },
    deferred: false,
    replied: false,
    memberPermissions: { has: () => staff },
    guild: {
      id: GUILD,
      channels: {
        create: async () => {
          interaction.layoutCalls += 1;
          throw new Error('created a channel');
        }
      }
    },
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
      getString: () => '',
      getBoolean: () => false,
      getInteger: () => null,
      getChannel: () => null
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    reply: async (payload) => {
      replies.push(payload);
      interaction.replied = true;
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      replies.push(payload);
    },
    followUp: async (payload) => {
      replies.push(payload);
    },
    layoutCalls: 0,
    replies
  };
  return interaction;
}

test('craft module stays off until SENTINAL_CRAFT_MODULE is set', () => {
  assert.equal(craftModuleEnabled({}), false);
  assert.equal(craftModuleEnabled({ SENTINAL_CRAFT_MODULE: 'false' }), false);
  assert.equal(craftModuleEnabled({ SENTINAL_CRAFT_MODULE: 'true' }), true);
  assert.equal(craftModuleLayoutPolicy().createsChannels, false);
  assert.equal(craftModuleLayoutPolicy().rearrangesChannels, false);
  assert.equal(craftModuleLayoutPolicy().editsPermissions, false);
  const entry = read('src/sentinel/entry.cjs');
  const installAt = entry.indexOf('installCraftModuleExtension');
  const botAt = entry.lastIndexOf("require('./bot.cjs')");
  assert.ok(installAt > 0 && botAt > installAt);
});

test('craft command names do not collide with Sentinal commands', () => {
  const sentinal = commandNamesFromSentinalSource();
  assert.ok(sentinal.has('minecraft'));
  assert.ok(sentinal.has('shop'));
  assert.ok(sentinal.has('shopadmin'));
  assert.ok(sentinal.has('nexus'));
  for (const name of CRAFT_COMMAND_NAMES) assert.equal(sentinal.has(name), false, name);
  const plain = sentinalCraftCommands({}).map((command) => command.toJSON());
  assert.deepEqual(plain.map((command) => command.name), ['craft', 'mcrcon', 'mc', 'realm']);
  const realm = plain.find((command) => command.name === 'realm');
  assert.ok(realm.options.some((option) => option.name === 'repost'));
  const flagged = sentinalCraftCommands({
    MC_POINTS_ENABLED: 'true',
    MC_SHOP_ENABLED: 'true',
    MC_STARTER_KIT_ENABLED: 'true'
  }).map((command) => command.toJSON());
  assert.deepEqual(flagged.map((command) => command.name), ['craft', 'mcrcon', 'mc', 'mcadmin', 'realm']);
  function walk(option, label) {
    assert.ok(option.description && option.description.length <= 100, label);
    for (const child of option.options || []) walk(child, `${label}.${child.name}`);
  }
  for (const command of flagged) walk(command, command.name);
  assert.equal(craftHelpText().includes('Running inside Nexus Sentinal'), false);
  const help = craftHelpText({ SENTINAL_CRAFT_MODULE: 'true' });
  assert.match(help, /\/realm repost/);
  assert.match(help, /\/minecraft/);
  assert.ok(help.length <= 1900);
});

test('flag off does not register commands or touch the guild', async () => {
  let fetched = 0;
  const events = {};
  const client = {
    once(name, fn) { (events[name] ||= []).push(fn); },
    on(name, fn) { (events[name] ||= []).push(fn); },
    guilds: { fetch: async () => { fetched += 1; throw new Error('should not fetch'); } }
  };
  const attached = attachCraftModule(client, {
    env: { SENTINAL_CRAFT_MODULE: 'false' },
    log: { log() {}, warn() {} },
    loops: false
  });
  assert.equal(attached.enabled, false);
  assert.equal(events[Events.ClientReady], undefined);
  assert.equal(fetched, 0);
  const interaction = chat('mc', 'status');
  await events[Events.InteractionCreate][0](interaction);
  assert.equal(interaction.replies[0].content, MODULE_OFF);
  assert.equal(interaction.layoutCalls, 0);
});

test('flag on registers craft commands and does not create channels', async () => {
  const created = [];
  let layoutCalls = 0;
  const events = {};
  const guild = {
    id: GUILD,
    commands: {
      fetch: async () => ({ find: () => null }),
      create: async (json) => { created.push(json.name); },
      edit: async () => { throw new Error('edit'); }
    },
    channels: {
      create: async () => {
        layoutCalls += 1;
        throw new Error('created a channel');
      }
    }
  };
  const client = {
    once(name, fn) { (events[name] ||= []).push(fn); },
    on(name, fn) { (events[name] ||= []).push(fn); },
    guilds: { fetch: async (id) => (id === GUILD ? guild : null) },
    user: { id: '1516602943670059199' }
  };
  const lines = [];
  const attached = attachCraftModule(client, {
    env: { SENTINAL_CRAFT_MODULE: 'true', DISCORD_GUILD_ID: GUILD },
    config: { discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] } },
    store: { getStatusPanel: () => null },
    log: { log: (line) => lines.push(line), warn: (line) => lines.push(line) },
    loops: false
  });
  assert.equal(attached.enabled, true);
  await events[Events.ClientReady][0]();
  assert.deepEqual(created, ['craft', 'mcrcon', 'mc', 'realm']);
  assert.equal(layoutCalls, 0);
  assert.ok(lines.some((line) => line.includes('/craft') && line.includes('/realm')));
  assert.equal(lines.some((line) => /password|secret|token/i.test(line)), false);
});

test('realm repost republishes open listings and leaves the channel list alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinal-craft-repost-'));
  const store = new CraftStore(dir, {});
  const listing = store.createListing({
    ownerId: OWNER,
    name: 'Home Realm',
    edition: 'java',
    description: 'Bring food',
    slots: 2,
    channelId: CHANNEL
  });
  store.saveListing({ ...listing, messageId: OLD_MESSAGE });
  const deleted = [];
  let layoutCalls = 0;
  const channel = {
    id: CHANNEL,
    send: async (body) => {
      assert.match(JSON.stringify(body), new RegExp(`craft:realm:apply:${listing.id}`));
      return { id: NEW_MESSAGE };
    },
    messages: {
      fetch: async (id) => ({
        id,
        delete: async () => { deleted.push(id); }
      })
    }
  };
  const client = {
    channels: { fetch: async (id) => (id === CHANNEL ? channel : null) },
    guilds: {
      fetch: async () => ({
        channels: {
          create: async () => {
            layoutCalls += 1;
            throw new Error('created a channel');
          }
        }
      })
    }
  };
  const result = await repostOpenRealms({ store, client });
  assert.deepEqual(result.posted, [listing.id]);
  assert.deepEqual(result.leftovers, []);
  assert.deepEqual(result.applicationsNotified, []);
  assert.deepEqual(deleted, [OLD_MESSAGE]);
  assert.equal(store.getListing(listing.id).messageId, NEW_MESSAGE);
  assert.equal(layoutCalls, 0);

  const application = store.addApplication({
    listingId: listing.id,
    applicantId: STRANGER,
    gamertag: 'Steve',
    note: 'please'
  });
  const dms = [];
  client.users = {
    fetch: async (id) => {
      assert.equal(id, OWNER);
      return {
        send: async (body) => {
          dms.push(body);
        }
      };
    }
  };
  const resent = await repostOpenRealms({ store, client });
  assert.deepEqual(resent.applicationsNotified, [application.id]);
  assert.match(JSON.stringify(dms[0]), new RegExp(`craft:realm:approve:${application.id}`));
  assert.equal(layoutCalls, 0);

  const env = { SENTINAL_CRAFT_MODULE: 'true', NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY };
  const denied = chat('realm', 'repost', { userId: STRANGER, staff: false });
  await handleSentinalCraftInteraction(denied, { env, store, config: { discord: {} }, client });
  assert.match(denied.replies[0].content, /Only Nexus staff/);
  assert.equal(denied.layoutCalls, 0);

  const outside = chat('realm', 'repost', { staff: true, category: '2000000000000000002' });
  await handleSentinalCraftInteraction(outside, { env, store, config: { discord: {} }, client });
  assert.match(outside.replies[0].content, /category/);
  assert.equal(outside.deferred, false);
});

test('sentinal shop and starter hooks replace the Craft pointer', async () => {
  const shop = chat('mc', 'shop');
  let opened = '';
  const handled = await handleMcPointsCommand(shop, {
    env: {},
    isStaff: false,
    ephemeral: (content) => ({ content }),
    ephemeralFlags: 64,
    openShop: async () => { opened = 'shop'; }
  });
  assert.equal(handled, true);
  assert.equal(opened, 'shop');
  assert.equal(shop.replies.length, 0);

  const starter = chat('mc', 'starter');
  const pointed = await handleMcPointsCommand(starter, {
    env: { MC_STARTER_KIT_ENABLED: 'true', NEXUS_ECONOMY_URL: 'http://economy', NEXUS_ECONOMY_CRAFT_TOKEN: 'craft-token' },
    isStaff: false,
    ephemeral: (content) => ({ content }),
    ephemeralFlags: 64,
    points: {}
  });
  assert.equal(pointed, true);
  assert.match(starter.replies[0].content, /Open Sentinal/);
});

test('craft module source does not mutate layout or log RCON secrets', () => {
  const source = `${read('src/sentinel/craft-module.cjs')}\n${read('src/sentinel/craft-module-extension.cjs')}`;
  assert.doesNotMatch(source, /channels\.create|setParent|setPosition|permissionOverwrites/);
  assert.doesNotMatch(source, /RCON_PASSWORD|NEXUS_RCON_PASSWORD|MC_RCON_PASSWORD/);
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^)\n]*password/i);
  assert.match(read('docs/ops/SENTINAL_CRAFT_MODULE.md'), /SENTINAL_CRAFT_MODULE/);
  assert.match(read('docs/ops/SENTINAL_CRAFT_MODULE.md'), /nexus-craft\.json/);
  assert.match(read('docs/ops/SENTINAL_CRAFT_MODULE.md'), /1016059608789434408/);
  assert.match(read('Dockerfile.sentinal'), /SENTINAL_CRAFT_MODULE\.md/);
  assert.match(read('docs/ops/NEXUS_CRAFT.md'), /SENTINAL_CRAFT_MODULE/);
});
