'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderGameServersPanel } = require('../src/sentinel/game-servers-panel.cjs');
const { mergePanelServers } = require('../src/sentinel/game-servers-live.cjs');
const {
  LIST_FOOTER,
  LIST_TITLE,
  handleRetiredServerListCommand,
  isRetirableListMessage,
  listPostEnabled,
  retirePublicServerList
} = require('../src/sentinel/public-server-list.cjs');

const BOT = '1516602943670059555';
const LIST_CHANNEL = '1516602943670059108';
const STORED = '1554495926838497293';
const PANEL = '1557067868833845374';

const LIVE_ROWS = [
  { id: 'ark:astraeos', game: 'ARK: Survival Ascended', name: 'Khaos Nexus (Astraeos)', kind: 'ark', joins: ['In-game server list: Khaos Nexus (Astraeos)'], status: 'Online', players: '3' },
  { id: 'ark:gen1', game: 'ARK: Survival Ascended', name: 'Khaos Nexus (Gen1)', kind: 'ark', joins: ['In-game server list: Khaos Nexus (Gen1)'], status: 'Offline', players: '' },
  { id: 'minecraft:env', game: 'Minecraft', name: 'Nexus Craft', kind: 'java', joins: ['Java play.mc.example:25565'], status: 'Online', players: '2/20', pack: 'ATM10: Aeronautics', packVersion: 'v0.7.1', mcVersion: '1.21.1', loader: 'NeoForge' }
];

test('single panel: dot only for official servers, Minecraft gets Modpack + version lines', () => {
  const payload = renderGameServersPanel({ servers: mergePanelServers(LIVE_ROWS, []), privateServers: [] });
  const [ark, craft] = payload.embeds[0].fields;
  assert.equal(ark.name, '🛡️ Official • ARK: Survival Ascended');
  assert.equal(ark.value, [
    '🟢 **Khaos Nexus (Astraeos)**',
    '**Players:** 3',
    '**Join:** In-game server list: Khaos Nexus (Astraeos)',
    '',
    '🔴 **Khaos Nexus (Gen1)**',
    '**Join:** In-game server list: Khaos Nexus (Gen1)'
  ].join('\n'));
  assert.equal(craft.name, '🛡️ Official • Minecraft');
  assert.equal(craft.value, [
    '🟢 **Nexus Craft**',
    '**Modpack:** ATM10: Aeronautics v0.7.1',
    '**Minecraft:** 1.21.1 (NeoForge)',
    '**Players:** 2 / 20',
    '**Join:** Java play.mc.example:25565'
  ].join('\n'));
  assert.equal(JSON.stringify(payload).includes('Khaos Nexus Official'), false);
});

test('pack text is sanitised the same way as #718 and community servers keep a short tag', () => {
  const rows = [{ ...LIVE_ROWS[2], pack: '[Click](https://x) @everyone', packVersion: '', mcVersion: '1.21.1' }];
  const registry = [{ id: 'SRV-2', moduleId: 'palworld', game: 'Palworld', name: 'Community Pal', trackingState: 'online', ownershipType: 'community-approved' }];
  const payload = renderGameServersPanel({ servers: mergePanelServers(rows, registry), privateServers: [] });
  const text = payload.embeds[0].fields.map((field) => field.value).join('\n');
  assert.match(text, /\*\*Modpack:\*\* \\\[Click\\\]\\\(https:\/\/x\\\) ＠everyone/);
  assert.equal(text.includes('@everyone'), false);
  assert.match(text, /🟢 \*\*Community Pal\*\*\n🌐 Community/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('separate public list post is off by default; PUBLIC_SERVER_LIST_POST=true restores it', () => {
  assert.equal(listPostEnabled({}), false);
  assert.equal(listPostEnabled({ PUBLIC_SERVER_LIST_POST: 'true' }), true);
  assert.equal(listPostEnabled({ PUBLIC_SERVER_LIST_POST: 'true', NEXUS_PUBLIC_SERVER_LIST_ENABLED: 'false' }), false);
});

function message(id, { author = BOT, title = LIST_TITLE, footer = LIST_FOOTER, pinned = false } = {}) {
  const log = [];
  return {
    id, author: { id: author }, pinned, log,
    embeds: [{ title, footer: { text: footer } }],
    unpin: async () => { log.push('unpin'); },
    delete: async () => { log.push('delete'); }
  };
}

test('retire deletes only Sentinal-authored list posts (unpinning first) and clears the stored id', async () => {
  const stored = message(STORED, { pinned: true });
  const strayCopy = message('1554495926838497000', { title: 'Khaos Nexus servers', footer: '' });
  const panel = message(PANEL, { title: 'KHAOS NEXUS • GAME SERVERS', footer: 'Nexus Sentinal • Managed Game Servers • v5' });
  const otherBot = message('1554495926838497111', { author: '1516602943670059999' });
  const userText = message('1554495926838497222', { title: '', footer: '' });
  const all = [stored, strayCopy, panel, otherBot, userText];
  const channel = {
    id: LIST_CHANNEL,
    messages: { fetch: async (arg) => (typeof arg === 'string' ? all.find((item) => item.id === arg) : new Map(all.map((item) => [item.id, item]))) }
  };
  let saved = null;
  const state = { getPublicServerList: () => ({ channelId: LIST_CHANNEL, messageId: STORED }), setPublicServerList: (value) => { saved = value; } };
  const client = { user: { id: BOT }, channels: { fetch: async () => channel } };
  const result = await retirePublicServerList(client, { env: {}, state, channels: [channel] });
  assert.equal(result.deleted, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(stored.log, ['unpin', 'delete']);
  assert.deepEqual(strayCopy.log, ['delete']);
  assert.deepEqual(panel.log, []);
  assert.deepEqual(otherBot.log, []);
  assert.deepEqual(userText.log, []);
  assert.deepEqual(saved, { channelId: LIST_CHANNEL, messageId: '' });
  assert.equal(isRetirableListMessage(message('1', { author: '2' }), BOT, '1'), false);
});

test('retire keeps the stored id when a delete fails so the next pass retries', async () => {
  const stored = message(STORED);
  stored.delete = async () => { throw new Error('Missing Permissions'); };
  const channel = { id: LIST_CHANNEL, messages: { fetch: async (arg) => (typeof arg === 'string' ? stored : new Map([[stored.id, stored]])) } };
  let saved = null;
  const state = { getPublicServerList: () => ({ channelId: LIST_CHANNEL, messageId: STORED }), setPublicServerList: (value) => { saved = value; } };
  const result = await retirePublicServerList({ user: { id: BOT }, channels: { fetch: async () => channel } }, { env: {}, state });
  assert.equal(result.deleted, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(saved, null);
});

test('/serverlist explains the list was retired', async () => {
  let reply = null;
  const interaction = { commandName: 'serverlist', isChatInputCommand: () => true, reply: async (payload) => { reply = payload; } };
  assert.equal(await handleRetiredServerListCommand(interaction), true);
  assert.match(reply.content, /GAME SERVERS panel/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
  assert.equal(await handleRetiredServerListCommand({ commandName: 'other', isChatInputCommand: () => true }), false);
});

const { gameServersChannels, retireOnce, startRetireLoop } = require('../src/sentinel/public-server-list-extension.cjs');

function discordError(code, message = 'discord error') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stateFor(channelId = LIST_CHANNEL, messageId = STORED) {
  const box = { saved: null };
  return { box, state: { getPublicServerList: () => ({ channelId, messageId }), setPublicServerList: (value) => { box.saved = value; } } };
}

test('permanent Discord errors are warnings (done), not retryable errors', async () => {
  for (const code of [50013, 50001]) {
    const stored = message(STORED);
    stored.delete = async () => { throw discordError(code, 'Missing Permissions'); };
    const channel = { id: LIST_CHANNEL, messages: { fetch: async (arg) => (typeof arg === 'string' ? stored : new Map([[stored.id, stored]])) } };
    const { box, state } = stateFor();
    const result = await retirePublicServerList({ user: { id: BOT }, channels: { fetch: async () => channel } }, { env: {}, state });
    assert.deepEqual(result.errors, [], String(code));
    assert.equal(result.warnings.length, 1, String(code));
    assert.match(result.warnings[0], new RegExp(`delete ${STORED}: ${code}`));
    assert.deepEqual(box.saved, { channelId: LIST_CHANNEL, messageId: '' });
  }
  // Unknown Channel for the stored channel, Unknown Message for the stored id.
  const { state: goneState } = stateFor();
  const gone = await retirePublicServerList({ user: { id: BOT }, channels: { fetch: async () => { throw discordError(10003, 'Unknown Channel'); } } }, { env: {}, state: goneState });
  assert.deepEqual(gone.errors, []);
  assert.match(gone.warnings[0], /10003/);
  const empty = { id: LIST_CHANNEL, messages: { fetch: async (arg) => { if (typeof arg === 'string') throw discordError(10008, 'Unknown Message'); return new Map(); } } };
  const { state: msgState } = stateFor();
  const missing = await retirePublicServerList({ user: { id: BOT }, channels: { fetch: async () => empty } }, { env: {}, state: msgState });
  assert.deepEqual(missing.errors, []);
  assert.match(missing.warnings[0], /10008/);
});

test('transient errors stay retryable', async () => {
  const stored = message(STORED);
  stored.delete = async () => { throw discordError(0, 'socket hang up'); };
  const channel = { id: LIST_CHANNEL, messages: { fetch: async (arg) => (typeof arg === 'string' ? stored : new Map([[stored.id, stored]])) } };
  const { box, state } = stateFor();
  const result = await retirePublicServerList({ user: { id: BOT }, channels: { fetch: async () => channel } }, { env: {}, state });
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(box.saved, null);
});

test('retire pass finds #game-servers from the channel cache only (no guild channel REST list)', async () => {
  const gameServers = { id: '1516602943670059300', name: 'game-servers', parentId: '', type: 0, isTextBased: () => true };
  const guild = {
    channels: {
      cache: new Map([[gameServers.id, gameServers]]),
      fetch: async () => { throw new Error('guild.channels.fetch must not be called'); }
    }
  };
  const client = { guilds: { cache: new Map([['1516602943670059000', guild]]), fetch: async () => { throw new Error('no guild fetch'); } } };
  const found = gameServersChannels(client, {}, { discord: { guildId: '1516602943670059000' } });
  assert.deepEqual(found.map((channel) => channel.id), [gameServers.id]);
  assert.deepEqual(gameServersChannels({ guilds: { cache: new Map() } }, {}, { discord: { guildId: '1516602943670059000' } }), []);
});

test('retireOnce is done on permanent-only errors and logs a warning; transient errors retry', async () => {
  const logs = { warn: [], log: [] };
  const log = { warn: (line) => logs.warn.push(line), log: (line) => logs.log.push(line) };
  const blocked = message(STORED);
  blocked.delete = async () => { throw discordError(50013, 'Missing Permissions'); };
  const channel = { id: LIST_CHANNEL, messages: { fetch: async (arg) => (typeof arg === 'string' ? blocked : new Map([[blocked.id, blocked]])) } };
  const client = { user: { id: BOT }, guilds: { cache: new Map() }, channels: { fetch: async () => channel } };
  assert.equal(await retireOnce(client, { env: {}, state: stateFor().state, config: {}, log }), true);
  assert.match(logs.warn[0], /gave up on: delete .*50013/);
  const flaky = message(STORED);
  flaky.delete = async () => { throw new Error('timeout'); };
  const flakyChannel = { id: LIST_CHANNEL, messages: { fetch: async (arg) => (typeof arg === 'string' ? flaky : new Map([[flaky.id, flaky]])) } };
  assert.equal(await retireOnce({ ...client, channels: { fetch: async () => flakyChannel } }, { env: {}, state: stateFor().state, config: {}, log }), false);
});

test('retire loop clears its interval after a clean pass', async () => {
  const cleared = [];
  const timers = { setInterval: () => ({ id: 'timer' }), clearInterval: (timer) => cleared.push(timer.id) };
  const results = [false, true];
  let calls = 0;
  const loop = startRetireLoop(async () => { calls += 1; return results.shift(); }, 300000, timers);
  assert.equal(loop.hasTimer(), true);
  assert.equal(await loop.tick(), false);
  assert.deepEqual(cleared, []);
  assert.equal(await loop.tick(), true);
  assert.deepEqual(cleared, ['timer']);
  assert.equal(loop.hasTimer(), false);
  assert.equal(await loop.tick(), true);
  assert.equal(calls, 2);
});
