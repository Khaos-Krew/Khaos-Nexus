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
