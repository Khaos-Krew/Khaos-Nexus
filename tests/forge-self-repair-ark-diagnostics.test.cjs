'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  arkDiagnosticsConfiguration,
  collectArkSelfRepairDiagnostics,
  runProbe
} = require('../src/sentinel/forge-self-repair-ark-diagnostics.cjs');

test('ARK Self-Repair diagnostics are disabled by default even when the ARK server is enabled', () => {
  const config = arkDiagnosticsConfiguration({ ARK_GEN1_ENABLED: 'true' });
  assert.equal(config.serverEnabled, true);
  assert.equal(config.requested, false);
  assert.equal(config.enabled, false);
  assert.equal(config.rconEnabled, true);
  assert.equal(config.databaseEnabled, true);
  assert.equal(config.sftpEnabled, false);
});

test('ARK Self-Repair diagnostics can probe RCON and database without exposing credentials', async () => {
  const env = {
    ARK_GEN1_ENABLED: 'true',
    NEXUS_FORGE_SELF_REPAIR_ARK_CHECKS_ENABLED: 'true'
  };
  const result = await collectArkSelfRepairDiagnostics({
    env,
    rconProbe: async () => ({ ok: true, state: 'reachable', responseBytes: 42 }),
    databaseProbe: async () => ({ ok: true, state: 'connected', backend: 'sqlite', tableExists: true })
  });

  assert.equal(result.enabled, true);
  assert.equal(result.ok, true);
  assert.equal(result.rcon.responseBytes, 42);
  assert.equal(result.database.backend, 'sqlite');
  assert.equal(result.sftp.enabled, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.rcon, 'password'), false);
});

test('ARK Self-Repair diagnostics degrade when an enabled probe fails and never throw the credential-bearing error object', async () => {
  const env = {
    ARK_GEN1_ENABLED: 'true',
    NEXUS_FORGE_SELF_REPAIR_ARK_CHECKS_ENABLED: 'true',
    NEXUS_FORGE_SELF_REPAIR_ARK_SFTP_ENABLED: 'true'
  };
  const result = await collectArkSelfRepairDiagnostics({
    env,
    rconProbe: async () => { throw new Error('connection refused'); },
    databaseProbe: async () => ({ ok: true, state: 'connected' }),
    sftpProbe: async () => ({ ok: false, state: 'config-path-missing' })
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'degraded');
  assert.equal(result.rcon.ok, false);
  assert.equal(result.rcon.state, 'unavailable');
  assert.match(result.rcon.error, /connection refused/);
  assert.equal(result.sftp.ok, false);
});

test('ARK probe wrapper treats a disabled check as healthy-disabled', async () => {
  let called = false;
  const result = await runProbe('test', false, async () => { called = true; }, {});
  assert.equal(result.enabled, false);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'disabled');
  assert.equal(called, false);
});
