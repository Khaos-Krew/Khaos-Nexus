'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPublicServers } = require('../src/sentinel/public-server-inventory.cjs');
const { applyLiveMinecraftStatus } = require('../src/sentinel/public-server-list.cjs');

const skyblockPanel = { host: 'play.example.com', kind: 'geyser', javaPort: 25614, bedrockPort: 25614 };
const craftStore = { getStatusPanel: () => skyblockPanel, listListings: () => [] };
const empty = { list: () => [] };
const arkRegistry = {
  dir: '/nonexistent-ark-dir',
  list: () => [{ id: 'gen1', name: 'Khaos Nexus (Gen1)', envPrefix: 'ARK_GEN1', runtime: {} }]
};
const servers = JSON.stringify([
  { name: 'Skyblock', mcVersion: '1.21.11' },
  { name: 'ATM10', kind: 'java', host: '203.0.113.5', javaPort: 25588, group: 'nexus-craft' }
]);

function collect(env) {
  return collectPublicServers({ env, craftStore, arkRegistry, hostedStore: empty, runtime: null });
}

test('ARK rows stay on the public list by default and drop when NEXUS_ARK_ENABLED=false', () => {
  assert.ok(collect({}).some((row) => row.game.startsWith('ARK')));
  assert.ok(!collect({ NEXUS_ARK_ENABLED: 'false' }).some((row) => row.game.startsWith('ARK')));
});

test('label entry mcVersion lands on the main join and survives a proxy ping', async () => {
  const rows = collect({ NEXUS_ARK_ENABLED: 'false', NEXUS_CRAFT_PUBLIC_NAME: 'Minecraft', NEXUS_MINECRAFT_PUBLIC_SERVERS: servers });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Minecraft');
  const [skyblock, atm] = rows[0].servers;
  assert.equal(skyblock.name, 'Skyblock');
  assert.equal(skyblock.mcVersion, '1.21.11');
  assert.equal(atm.name, 'ATM10');
  const probe = async ({ host }) => host === 'play.example.com'
    ? { java: { online: 1, max: 30, version: 'Velocity 1.7.2-26.3' } }
    : { java: { online: 0, max: 20, version: '1.21.1', loader: 'NeoForge' } };
  const [live] = await applyLiveMinecraftStatus(rows, { probeServerStatus: probe });
  assert.equal(live.servers[0].mcVersion, '1.21.11');
  assert.equal(live.servers[1].mcVersion, '1.21.1');
  assert.equal(live.servers[1].loader, 'NeoForge');
});

test('proxy version text is never shown when no version is configured', async () => {
  const rows = collect({ NEXUS_ARK_ENABLED: 'false', NEXUS_MINECRAFT_PUBLIC_SERVERS: JSON.stringify([{ name: 'Skyblock' }]) });
  const probe = async () => ({ java: { online: 0, max: 30, version: 'Velocity 3.4.0' } });
  const [live] = await applyLiveMinecraftStatus(rows, { probeServerStatus: probe });
  assert.equal(live.servers[0].name, 'Skyblock');
  assert.ok(!live.servers[0].mcVersion);
});
