'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { ArkRconConfigStore } = require('../src/sentinel/ark-rcon-config-store.cjs');
const { pollCluster } = require('../src/sentinel/ark-cluster-monitor.cjs');
const { renderArkClusterPanel } = require('../src/sentinel/ark-cluster-panel.cjs');

test('cluster discovers Discord maps each refresh and probes distinct saved ports without Railway credentials', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-discord-'));
  const previous = process.env.NEXUS_DATA_DIR;
  process.env.NEXUS_DATA_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const registry = new ArkClusterRegistry();
  const store = new ArkRconConfigStore();
  const calls = [];
  class FakeRcon {
    constructor(connection) { this.connection = connection; }
    async execute(command) {
      assert.equal(command, 'ListPlayers');
      calls.push(this.connection);
      return '0. Player, test-eos';
    }
  }
  const configure = (prefix, port) => {
    store.setEndpoint(prefix, { host: '192.0.2.10', port });
    store.setPassword(prefix, `test-secret-${port}`);
  };
  // Existing metadata survives migration, including a stale environment-derived
  // rcon=false flag and a custom id that differs from the prefix suffix.
  registry.upsert({ id: 'first-map', envPrefix: 'ARK_TEST_ONE', mapName: 'Custom Map', maintenance: true, connections: { rcon: false } });
  configure('ARK_TEST_ONE', 30081);
  let snapshot = await pollCluster(registry, { RconClient: FakeRcon });
  assert.equal(snapshot.servers.length, 1);
  assert.equal(snapshot.servers[0].mapName, 'Custom Map');
  assert.equal(snapshot.servers[0].runtime.state, 'maintenance');
  assert.equal(snapshot.servers[0].runtime.playerCount, 1);

  configure('ARK_TEST_TWO', 30121);
  calls.length = 0;
  snapshot = await pollCluster(registry, { RconClient: FakeRcon });
  assert.equal(snapshot.servers.length, 2);
  assert.deepEqual(calls.map((c) => c.port).sort(), [30081, 30121]);
  for (const c of calls) {
    assert.equal(c.host, '192.0.2.10');
    assert.equal(c.password, `test-secret-${c.port}`);
  }
  const panel = JSON.stringify(renderArkClusterPanel(snapshot));
  assert.match(panel, /Custom Map/);
  assert.match(panel, /TEST TWO/);
  assert.doesNotMatch(panel, /test-secret|192\.0\.2/);
  assert.doesNotMatch(fs.readFileSync(registry.file, 'utf8'), /test-secret|password|192\.0\.2/);

  // Live endpoint edits are picked up without a process restart.
  store.setEndpoint('ARK_TEST_TWO', { host: '192.0.2.11', port: 30122 });
  calls.length = 0;
  await pollCluster(registry, { RconClient: FakeRcon });
  assert.ok(calls.some((c) => c.host === '192.0.2.11' && c.port === 30122));
  store.setEndpoint('ARK_TEST_TWO', { host: '192.0.2.11', port: 30122, enabled: false });
  calls.length = 0;
  snapshot = await pollCluster(registry, { RconClient: FakeRcon });
  assert.equal(calls.length, 1);
  assert.equal(snapshot.servers.find((s) => s.envPrefix === 'ARK_TEST_TWO').runtime.state, 'offline');

  // A missing password on a new map cannot borrow another map's credentials.
  store.setEndpoint('ARK_TEST_THREE', { host: '192.0.2.10', port: 30123 });
  snapshot = await pollCluster(registry, { RconClient: FakeRcon });
  assert.equal(snapshot.servers.find((s) => s.envPrefix === 'ARK_TEST_THREE').runtime.lastError, 'RCON not configured for this map.');
});
