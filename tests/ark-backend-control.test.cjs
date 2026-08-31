'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArkBackendControl, ALLOWED_ACTIONS } = require('../src/sentinel/ark-backend-control.cjs');

function serverFixture() {
  return {
    id: 'gen1', name: 'MAP1', mapName: 'Genesis 1', envPrefix: 'ARK_GEN1', enabled: true,
    maintenance: false, restartRequired: false, restartReason: '', connections: { rcon: true, sftp: true }, runtime: {}
  };
}
function registryFixture() {
  const server = serverFixture();
  return {
    list: () => [server],
    updateRuntime: (_id, runtime) => Object.assign(server, { runtime }),
    setRestartRequired: (_id, value) => Object.assign(server, { restartRequired: value.required, restartReason: value.reason })
  };
}
function controlFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-control-'));
  return new ArkBackendControl({ registry: registryFixture(), auditPath: path.join(dir, 'audit.jsonl'), logger: { error() {} }, ...options });
}

test('ARK backend allowlist keeps raw RCON and restart blocked while allowing approved config apply', () => {
  assert.equal(ALLOWED_ACTIONS.has('server.status'), true);
  assert.equal(ALLOWED_ACTIONS.has('cluster.health'), true);
  assert.equal(ALLOWED_ACTIONS.has('config.plan'), true);
  assert.equal(ALLOWED_ACTIONS.has('config.apply'), true);
  assert.equal(ALLOWED_ACTIONS.has('server.restart'), false);
  assert.equal(ALLOWED_ACTIONS.has('rcon.raw'), false);
});

test('MAP1 resolves to ARK_GEN1 and status uses zero LLM calls', async () => {
  const control = controlFixture();
  const commands = [];
  control.rcon = () => ({ execute: async (command) => { commands.push(command); return '0. Alice, 12345678901234567890'; } });
  const result = await control.execute({ action: 'server.status', server: 'map1', correlationId: 'test-status-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.server.envPrefix, 'ARK_GEN1');
  assert.equal(result.data.playerCount, 1);
  assert.equal(result.llmCalls, 0);
  assert.deepEqual(commands, ['ListPlayers']);
});

test('save and broadcast remain typed and idempotent', async () => {
  const control = controlFixture();
  const commands = [];
  control.rcon = () => ({ execute: async (command) => { commands.push(command); return 'OK'; } });
  const saved = await control.execute({ action: 'server.save', server: 'MAP1', correlationId: 'test-save-000001' });
  assert.equal(saved.ok, true);
  const broadcast = await control.execute({ action: 'server.broadcast', server: 'MAP1', message: 'Restart warning', correlationId: 'test-broadcast-001' });
  assert.equal(broadcast.ok, true);
  const replay = await control.execute({ action: 'server.broadcast', server: 'MAP1', message: 'Different', correlationId: 'test-broadcast-001' });
  assert.equal(replay.replayed, true);
  assert.deepEqual(commands, ['SaveWorld', 'Broadcast Restart warning']);
});

test('config apply requires approval and exact fresh plan hash', async () => {
  let currentText = '[ServerSettings]\nMaxPlayers=70\n';
  const writes = [];
  const control = controlFixture({
    readConfig: async () => ({ text: currentText }),
    setIniValue: async (request) => {
      if (request.dryRun) return { changed: true, restartRequired: true, dryRun: true, backup: null };
      writes.push(request);
      currentText = '[ServerSettings]\nMaxPlayers=80\n';
      return { changed: true, restartRequired: true, dryRun: false, backup: '/safe/NexusBackups/one/GameUserSettings.ini' };
    }
  });
  const plan = await control.execute({ action: 'config.plan', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', correlationId: 'test-plan-000001' });
  assert.equal(plan.ok, true);
  assert.match(plan.data.planHash, /^[a-f0-9]{64}$/);
  assert.equal(plan.data.approvalRequired, true);

  const denied = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, correlationId: 'test-apply-deny01' });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /approved=true/);
  assert.equal(writes.length, 0);

  const applied = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, approved: true, correlationId: 'test-apply-ok0001' });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.verified, true);
  assert.equal(applied.data.rollbackOnVerificationFailure, true);
  assert.equal(applied.data.restartRequired, true);
  assert.equal(applied.llmCalls, 0);
  assert.equal(writes.length, 1);
});

test('config apply rejects stale plan after underlying file changes', async () => {
  let currentText = '[ServerSettings]\nMaxPlayers=70\n';
  const control = controlFixture({
    readConfig: async () => ({ text: currentText }),
    setIniValue: async (request) => request.dryRun ? { changed: true, restartRequired: true } : { changed: true, restartRequired: true }
  });
  const plan = await control.execute({ action: 'config.plan', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', correlationId: 'test-plan-stale01' });
  currentText = '[ServerSettings]\nMaxPlayers=75\n';
  const result = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, approved: true, correlationId: 'test-apply-stale1' });
  assert.equal(result.ok, false);
  assert.match(result.message, /stale/i);
});

test('cluster health aggregates runtime and SFTP config availability with zero LLM calls', async () => {
  const server = serverFixture();
  server.runtime = { state: 'online', playerCount: 2, latencyMs: 15, lastCheckedAt: '2026-08-31T00:00:00.000Z', lastError: '' };
  const registry = { list: () => [server], updateRuntime() {} };
  const control = controlFixture({
    registry,
    pollCluster: async () => ({ servers: [server], summary: { state: 'online', enabled: 1, online: 1, maintenance: 0, offline: 0, totalPlayers: 2 }, checkedAt: '2026-08-31T00:00:00.000Z' }),
    discoverPaths: async () => ({ gus: { found: true, discovered: false }, game: { found: true, discovered: false }, arkshop: { found: true, discovered: true } })
  });
  const result = await control.execute({ action: 'cluster.health', correlationId: 'test-health-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.server, null);
  assert.equal(result.data.summary.totalPlayers, 2);
  assert.equal(result.data.servers[0].configAccess.ok, true);
  assert.equal(result.llmCalls, 0);
});
