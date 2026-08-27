'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ArkClusterRegistry,
  normalizeRecord,
  emptyRuntime
} = require('../src/sentinel/ark-cluster-registry.cjs');
const {
  parseListPlayers,
  summarizeCluster,
  probeArkServer
} = require('../src/sentinel/ark-cluster-monitor.cjs');
const {
  PANEL_MARKER,
  BUTTON_MODS,
  renderArkClusterPanel,
  renderMapField
} = require('../src/sentinel/ark-cluster-panel.cjs');
const { buildModListReply } = require('../src/sentinel/ark-cluster-public-actions.cjs');
const { parseMods, parseRates } = require('../src/sentinel/ark-cluster-extension.cjs');

function tempRegistry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-cluster-'));
  return { root, registry: new ArkClusterRegistry(root) };
}

test('ARK cluster registry persists records without storing connection secrets', () => {
  const { root, registry } = tempRegistry();
  const record = registry.upsert({
    id: 'gen1',
    name: 'Khaos Nexus Gen 1',
    mapName: 'Genesis Part 1',
    mapIdentifier: 'Genesis_WP',
    envPrefix: 'ARK_GEN1',
    clusterId: 'nexus-cluster',
    connections: { rcon: true, query: true, api: false, sftp: true }
  });
  assert.equal(record.id, 'gen1');
  assert.equal(record.envPrefix, 'ARK_GEN1');
  assert.equal(registry.get('gen1').mapIdentifier, 'Genesis_WP');
  const persisted = fs.readFileSync(path.join(root, 'data', 'ark-cluster-registry.json'), 'utf8');
  assert.match(persisted, /ARK_GEN1/);
  assert.doesNotMatch(persisted, /RCON_PASSWORD|SFTP_PASSWORD|MysqlPass|password/i);
});

test('ARK cluster registry add and remove are reflected dynamically', () => {
  const { registry } = tempRegistry();
  registry.upsert({ id: 'gen1', name: 'Gen 1', mapName: 'Genesis 1', mapIdentifier: 'Genesis_WP', envPrefix: 'ARK_GEN1' });
  registry.upsert({ id: 'gen2', name: 'Gen 2', mapName: 'Genesis 2', mapIdentifier: 'Gen2_WP', envPrefix: 'ARK_GEN2' });
  assert.deepEqual(registry.list().map((server) => server.id), ['gen1', 'gen2']);
  registry.remove('gen1');
  assert.deepEqual(registry.list().map((server) => server.id), ['gen2']);
});

test('registry records carry the Phase 1 control-plane profile fields', () => {
  const record = normalizeRecord({
    id: 'test',
    name: 'Test',
    mapName: 'Test Map',
    mapIdentifier: 'Test_WP',
    envPrefix: 'ARK_TEST'
  });
  assert.equal(record.configProfile, 'default');
  assert.equal(record.modProfile, 'default');
  assert.equal(record.shopProfile, 'default');
  assert.equal(record.restartProfile, 'default');
  assert.equal(record.connections.rcon, true);
  assert.deepEqual(record.runtime, emptyRuntime());
});

test('ListPlayers parser extracts player name and EOS id', () => {
  const players = parseListPlayers('0. Khaos_Asuna, 0002f8bdae234238b0d398ae179826fb\n1. Player Two, abc_DEF-123');
  assert.equal(players.length, 2);
  assert.equal(players[0].name, 'Khaos_Asuna');
  assert.equal(players[0].eosId, '0002f8bdae234238b0d398ae179826fb');
  assert.equal(players[1].name, 'Player Two');
});

test('cluster summary exposes only Online Offline and Maintenance semantics', () => {
  const servers = [
    { enabled: true, runtime: { state: 'online', playerCount: 2 } },
    { enabled: true, runtime: { state: 'offline', playerCount: 0 } }
  ];
  const summary = summarizeCluster(servers);
  assert.equal(summary.state, 'maintenance');
  assert.equal(summary.online, 1);
  assert.equal(summary.offline, 1);
  assert.equal(summary.totalPlayers, 2);
});

test('maintenance registry state remains public Maintenance even when RCON responds', async () => {
  process.env.ARK_TEST_HOST = '127.0.0.1';
  process.env.ARK_TEST_RCON_PORT = '1234';
  process.env.ARK_TEST_RCON_PASSWORD = 'secret-for-test';
  class FakeRcon {
    async execute() { return '0. Tester, eos-test-123'; }
  }
  const result = await probeArkServer({
    enabled: true,
    maintenance: true,
    envPrefix: 'ARK_TEST',
    connections: { rcon: true }
  }, { RconClient: FakeRcon, now: () => new Date('2026-08-27T23:00:00Z') });
  assert.equal(result.state, 'maintenance');
  assert.equal(result.playerCount, 1);
  delete process.env.ARK_TEST_HOST;
  delete process.env.ARK_TEST_RCON_PORT;
  delete process.env.ARK_TEST_RCON_PASSWORD;
});

test('public ARK cluster panel shows map status and players without operator detail', () => {
  const server = normalizeRecord({
    id: 'gen1',
    name: 'Khaos Nexus Gen 1',
    mapName: 'Genesis Part 1',
    mapIdentifier: 'Genesis_WP',
    envPrefix: 'ARK_GEN1',
    currentEvent: 'Launch Weekend',
    rates: { Harvest: '5x', Taming: '10x' },
    mods: ['Awesome SpyGlass', 'ArkShop UI'],
    runtime: { state: 'online', playerCount: 3, players: [], lastCheckedAt: '2026-08-27T23:10:00Z', lastError: '' }
  });
  const field = renderMapField(server);
  assert.match(field, /Map:\*\* Genesis Part 1/);
  assert.match(field, /Status:\*\* 🟢 Online/);
  assert.match(field, /Players:\*\* 3/);
  assert.doesNotMatch(field, /Control|Profiles|Config state|Rates|Mods|Access|Genesis_WP/);

  const payload = renderArkClusterPanel({
    servers: [server],
    summary: summarizeCluster([server]),
    checkedAt: '2026-08-27T23:10:00Z'
  });
  assert.equal(payload.embeds[0].footer.text, PANEL_MARKER);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, new RegExp(BUTTON_MODS));
  assert.doesNotMatch(serialized, /RCON|SFTP|Profiles|Config state|Harvest 5x|Awesome SpyGlass|Genesis_WP|secret-for-test/);
});

test('public mod list button uses manual mods first and detected mods as fallback', () => {
  const reply = buildModListReply([
    normalizeRecord({ id: 'gen1', name: 'Gen 1', mapName: 'Genesis Part 1', envPrefix: 'ARK_GEN1', detectedMods: ['111111', '222222'] }),
    normalizeRecord({ id: 'gen2', name: 'Gen 2', mapName: 'Genesis Part 2', envPrefix: 'ARK_GEN2', mods: ['Named Mod'], detectedMods: ['ignored'] })
  ]);
  assert.match(reply, /Genesis Part 1/);
  assert.match(reply, /111111/);
  assert.match(reply, /222222/);
  assert.match(reply, /Genesis Part 2/);
  assert.match(reply, /Named Mod/);
  assert.doesNotMatch(reply, /ignored/);
});

test('staff metadata parsers accept compact mod and rate updates', () => {
  assert.deepEqual(parseMods('Mod A, Mod B, Mod C'), ['Mod A', 'Mod B', 'Mod C']);
  assert.deepEqual(parseMods('none'), []);
  assert.deepEqual(parseRates('Harvest=5x,Taming=10x'), { Harvest: '5x', Taming: '10x' });
  assert.deepEqual(parseRates('none'), {});
});
