'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const {
  OWNER_CATEGORY_IDS,
  evaluateChannelCategory,
  installCategoryGate,
  resolveCategoryConfig
} = require('../../src/game-bots/category-gate.cjs');
const { evaluateVanguardChannel } = require('../../src/game-bots/vanguard/gate.cjs');
const { helpText } = require('../../src/game-bots/ops-spine.cjs');

const CATEGORY = '1516640233389822042';
const root = path.resolve(__dirname, '../..');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function interaction(overrides = {}) {
  const replies = [];
  const target = {
    guildId: '1516640233389822999',
    channelId: '1516640233389822888',
    commandName: 'status',
    user: { id: '42' },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    reply: async (payload) => {
      replies.push(payload);
      target.replied = true;
      return payload;
    },
    replies,
    ...overrides
  };
  return target;
}

test('vanguard category gate fail-closes until a snowflake is set', () => {
  assert.deepEqual(Object.keys(OWNER_CATEGORY_IDS).sort(), ['ascended', 'cephalon']);
  const missing = resolveCategoryConfig('vanguard', {});
  assert.equal(missing.failClosed, true);
  assert.equal(missing.open, false);
  assert.equal(missing.source, 'unset');
  assert.equal(missing.envName, 'VANGUARD_DISCORD_CATEGORY_ID');
  assert.equal(missing.id, '');
  assert.equal(evaluateChannelCategory({ parentId: CATEGORY }, 'vanguard', {}).allow, false);
  assert.equal(evaluateChannelCategory({ parentId: CATEGORY }, 'vanguard', {}).reason, 'fail-closed');
  assert.equal(evaluateVanguardChannel({ parentId: CATEGORY }, {}).reason, 'fail-closed');

  const blank = resolveCategoryConfig('vanguard', { VANGUARD_DISCORD_CATEGORY_ID: '  ', VANGUARD_CATEGORY_ID: '' });
  assert.equal(blank.failClosed, true);
  assert.equal(blank.source, 'unset');

  const alias = resolveCategoryConfig('vanguard', { VANGUARD_CATEGORY_ID: CATEGORY });
  assert.equal(alias.id, CATEGORY);
  assert.equal(alias.envName, 'VANGUARD_CATEGORY_ID');
  assert.equal(alias.failClosed, false);

  const primary = resolveCategoryConfig('vanguard', {
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_CATEGORY_ID: '1516602943670059108'
  });
  assert.equal(primary.id, CATEGORY);
  assert.equal(primary.envName, 'VANGUARD_DISCORD_CATEGORY_ID');

  const invalid = resolveCategoryConfig('vanguard', { VANGUARD_DISCORD_CATEGORY_ID: 'not-a-category' });
  assert.equal(invalid.failClosed, true);
  assert.equal(invalid.id, '');
  assert.equal(evaluateChannelCategory({ parentId: CATEGORY }, 'vanguard', { VANGUARD_DISCORD_CATEGORY_ID: 'not-a-category' }).reason, 'fail-closed');

  const env = { VANGUARD_DISCORD_CATEGORY_ID: CATEGORY };
  assert.equal(evaluateChannelCategory({ parentId: CATEGORY, isThread: () => false }, 'vanguard', env).allow, true);
  assert.equal(evaluateChannelCategory({ parentId: '1516602943670059108', isThread: () => false }, 'vanguard', env).reason, 'wrong-category');
  assert.equal(evaluateChannelCategory({
    isThread: () => true,
    parentId: 'parent-text',
    parent: { parentId: CATEGORY }
  }, 'vanguard', env).allow, true);
  assert.equal(evaluateVanguardChannel({ parentId: CATEGORY }, env).reason, 'allow');

  assert.equal(resolveCategoryConfig('cephalon', {}).id, OWNER_CATEGORY_IDS.cephalon);
  assert.equal(resolveCategoryConfig('ascended', {}).source, 'default');
  assert.equal(resolveCategoryConfig('sanctuary', {}).open, true);
});

test('a missing vanguard category refuses /status with the fail-closed reason', async () => {
  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'vanguard', env: {} });
  let ran = 0;
  client.on('interactionCreate', () => { ran += 1; });
  const status = interaction();
  client.emit('interactionCreate', status);
  await flush();
  assert.equal(ran, 0);
  assert.equal(status.replies.length, 1);
  assert.equal(status.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(status.replies[0].content, /fail-closed/);
  assert.match(status.replies[0].content, /VANGUARD_DISCORD_CATEGORY_ID/);

  const outside = new EventEmitter();
  installCategoryGate(outside, { bot: 'vanguard', env: { VANGUARD_DISCORD_CATEGORY_ID: CATEGORY } });
  let outsideRan = 0;
  outside.on('interactionCreate', () => { outsideRan += 1; });
  const wrong = interaction({
    commandName: 'lfg',
    channel: { parentId: '1516602943670059108', isThread: () => false }
  });
  outside.emit('interactionCreate', wrong);
  await flush();
  assert.equal(outsideRan, 0);
  assert.equal(wrong.replies[0].content, 'Use this bot in the Vanguard category.');
  assert.equal(wrong.replies[0].flags, MessageFlags.Ephemeral);
});

test('vanguard help stays off the other bots and points at Sentinal', () => {
  const help = helpText('vanguard');
  assert.match(help, /\/lfg create/);
  assert.match(help, /\/nexushelp/);
  assert.match(help, /\/status/);
  assert.match(help, /Nexus Sentinal/);
  assert.match(help, /\/bal/);
  assert.match(help, /\/o9verify/);
  assert.match(help, /shop/);
  assert.match(help, /Many Worlds One Nexus/);
  assert.match(help, /Not affiliated with or endorsed by Bungie/);
  assert.match(help, /no paid tiers/);
  assert.doesNotMatch(help, /Sentinel/);
  assert.doesNotMatch(help, /paypal|patreon|kofi|discord\.gg\/donate/i);
  assert.doesNotMatch(helpText('cephalon'), /\/lfg/);
  assert.doesNotMatch(helpText('ascended'), /\/vanguard/);
  assert.doesNotMatch(helpText('sanctuary'), /Many Worlds One Nexus/);
});

test('vanguard sources import shared helpers and do not call Bungie or the economy', () => {
  const dir = path.join(root, 'src/game-bots/vanguard');
  const files = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.cjs')) files.push(full);
    }
  };
  walk(dir);
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(fs.readFileSync(path.join(dir, 'gate.cjs'), 'utf8'), /evaluateChannelCategory/);
  assert.match(fs.readFileSync(path.join(dir, 'jtc.cjs'), 'utf8'), /installJoinToCreate/);
  assert.match(fs.readFileSync(path.join(dir, 'panels.cjs'), 'utf8'), /upsertEmbed/);
  assert.match(fs.readFileSync(path.join(root, 'src/railway/vanguard-service.cjs'), 'utf8'), /startGameBot/);
  assert.match(fs.readFileSync(path.join(dir, 'entry.cjs'), 'utf8'), /commandName === 'd2'/);
  assert.match(fs.readFileSync(path.join(dir, 'bungie/client.cjs'), 'utf8'), /X-API-Key/);
  assert.match(fs.readFileSync(path.join(dir, 'bungie/client.cjs'), 'utf8'), /https:\/\/www\.bungie\.net\/Platform/);
  assert.doesNotMatch(source, /MoveEquipDestinyItems|AdminGroups|BnetWrite|paypal|patreon|kofi|require\('pg'\)|HttpsProxyAgent|HTTP_PROXY|HTTPS_PROXY|oauth/i);
  const urls = source.replace(/https:\/\/www\.bungie\.net/g, '').replace(/https:\/\/github\.com\/Khaos-Krew\/Khaos-Nexus/g, '');
  assert.doesNotMatch(urls, /https?:\/\//);
});

test('vanguard image starts the service without baking tokens or category ids', {
  skip: fs.existsSync(path.join(root, 'Dockerfile.vanguard')) ? false : 'image does not include Dockerfile.vanguard'
}, () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile.vanguard'), 'utf8');
  assert.match(docker, /src\/railway\/vanguard-service\.cjs/);
  assert.match(docker, /VANGUARD_DATA_DIR=\/data\/vanguard/);
  assert.doesNotMatch(docker, /VANGUARD_DISCORD_TOKEN|VANGUARD_DISCORD_CATEGORY_ID=\d+|BUNGIE_/);
});
