'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  patchPlayerConsole,
  patchHostedPower
} = require('../main/nexus-core-live-migrations-extension.cjs');
const { PlayerConsoleService } = require('../main/services/player-console-service.cjs');
const { HostedServerService } = require('../main/services/hosted-server-service.cjs');
const { getNexusCoreService } = require('../main/services/nexus-core-service.cjs');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function playerService() {
  const dataDirectory = tempRoot('khaos-core-player-');
  let calls = 0;
  const server = { id: 'rag-01', name: 'Ragnarok', game: 'ark', enabled: true, password: 'runtime-secret' };
  const configStore = {
    configPath: path.join(dataDirectory, 'config.json'),
    getPlayerConsoleConfig: () => ({ settings: { historyLimit: 50, tokenLifetimeMinutes: 10 } }),
    getRuntimeBootstrap: () => ({ config: { servers: [server] } })
  };
  const service = new PlayerConsoleService({
    dataDirectory,
    configStore,
    logger: { info() {}, warn() {}, error() {} },
    connectionFactory: () => ({
      action: async (action) => {
        calls += 1;
        return `${action} accepted`;
      }
    }),
    now: () => Date.parse('2026-08-11T08:00:00Z')
  });
  service.runtimeServers = () => [server];
  return { service, dataDirectory, server, calls: () => calls };
}

function addPlayerToken(service, token = 'player-token') {
  service.tokens.set(token, {
    serverId: 'rag-01',
    playerName: 'TestPlayer',
    identifier: 'platform-123',
    expiresAt: Date.parse('2026-08-11T09:00:00Z')
  });
  return token;
}

test('manual kick executes through Core once and duplicate delivery is suppressed', async () => {
  patchPlayerConsole();
  const { service, dataDirectory, calls } = playerService();
  const token = addPlayerToken(service);
  const input = {
    token,
    action: 'kick',
    reason: 'Testing moderation migration',
    actor: { id: 'operator-1', name: 'Operator', role: 'operator' }
  };

  const first = await service.moderate(input);
  const duplicate = await service.moderate(input);
  assert.equal(first.outcome, 'success');
  assert.equal(duplicate.outcome, 'success');
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls(), 1);

  const core = getNexusCoreService({ dataDirectory });
  const types = core.journal.list().map((record) => record.event.type);
  assert.ok(types.includes('core.action.succeeded'));
  assert.ok(types.includes('core.action.duplicate'));
  assert.equal(JSON.stringify(core.journal.list()).includes('runtime-secret'), false);
  assert.equal(JSON.stringify(core.journal.list()).includes(token), false);
});

test('operator cannot escalate a ban through the service boundary but owner can', async () => {
  patchPlayerConsole();
  const deniedHarness = playerService();
  const deniedToken = addPlayerToken(deniedHarness.service, 'ban-token-operator');
  await assert.rejects(
    () => deniedHarness.service.moderate({
      token: deniedToken,
      action: 'ban',
      reason: 'Denied privilege test',
      actor: { id: 'operator-2', name: 'Operator', role: 'operator' }
    }),
    (error) => error.code === 'NEXUS_CAPABILITY_DENIED'
  );
  assert.equal(deniedHarness.calls(), 0);

  const ownerHarness = playerService();
  const ownerToken = addPlayerToken(ownerHarness.service, 'ban-token-owner');
  const result = await ownerHarness.service.moderate({
    token: ownerToken,
    action: 'ban',
    reason: 'Owner-authorized ban',
    actor: { id: 'owner-1', name: 'Owner', role: 'owner' }
  });
  assert.equal(result.outcome, 'success');
  assert.equal(ownerHarness.calls(), 1);
});

function hostedService() {
  const dataDirectory = tempRoot('khaos-core-hosted-');
  let calls = 0;
  const configStore = {
    configPath: path.join(dataDirectory, 'config.json'),
    getHostedControlConfig: () => ({ settings: { historyLimit: 50, actionTokenMinutes: 10 } }),
    getHostedControlPublicConfig: () => ({ providers: [], settings: { historyLimit: 50 } })
  };
  const service = new HostedServerService({
    dataDirectory,
    configStore,
    logger: { info() {}, warn() {}, error() {} },
    now: () => Date.parse('2026-08-11T08:10:00Z')
  });
  service.client = () => ({
    provider: { id: 'provider-1', name: 'Pterodactyl' },
    client: {
      power: async () => { calls += 1; }
    }
  });
  service.tokens.set('hosted-token', {
    providerId: 'provider-1',
    identifier: 'server-abc',
    serverName: 'Hosted Ragnarok',
    expiresAt: Date.parse('2026-08-11T09:00:00Z')
  });
  return { service, dataDirectory, calls: () => calls };
}

test('hosted power signals execute through Core and remain duplicate-safe', async () => {
  patchHostedPower();
  const { service, dataDirectory, calls } = hostedService();
  const input = {
    token: 'hosted-token',
    signal: 'restart',
    actor: { id: 'owner-1', name: 'Owner', role: 'owner' }
  };
  const first = await service.power(input);
  const duplicate = await service.power(input);
  assert.equal(first.outcome, 'success');
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls(), 1);
  const core = getNexusCoreService({ dataDirectory });
  assert.equal(JSON.stringify(core.journal.list()).includes('hosted-token'), false);
});
