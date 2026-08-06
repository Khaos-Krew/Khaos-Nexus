'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RUNTIME,
  AGENTS,
  agentKey,
  validateCoreReadiness,
  runtimeStatus
} = require('../main/ai-runtime-contract.cjs');
const { buildServiceEnvironment } = require('../main/ai-runtime-environment.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('approved runtime and agent identities are canonical', () => {
  assert.equal(RUNTIME.label, 'Khaos Nexus AI Runtime');
  assert.deepEqual([AGENTS.dnd.name, AGENTS.core.name], ['Veyra', 'Nexus Sentinel']);
  assert.equal(AGENTS.dnd.title, 'D&D Lorewarden and Co-DM');
  assert.equal(AGENTS.core.title, 'System Health and Assistance AI');
  assert.equal(agentKey('runtime', true), 'all');
});

test('runtime status supports one active worker and degrades without collapsing the other', () => {
  assert.equal(runtimeStatus([{ key: 'dnd', status: 'ready' }, { key: 'core', status: 'stopped' }]).status, 'ready');
  assert.equal(runtimeStatus([{ key: 'dnd', status: 'ready' }, { key: 'core', status: 'failed' }]).status, 'degraded');
  assert.equal(runtimeStatus([{ key: 'dnd', status: 'stopped' }, { key: 'core', status: 'failed' }]).status, 'failed');
});

test('Nexus Sentinel validator matches the exact pinned sidecar contract', () => {
  const readiness = {
    event: 'nexus-ai-core.ready',
    startupNonce: 'nonce',
    service: 'khaos-nexus-ai-core',
    serviceVersion: '0.7.0',
    apiVersion: '1',
    serviceContractVersion: '1.0.0',
    sidecarContractVersion: '1.0.0',
    targetService: 'nexus-ai-core',
    host: '127.0.0.1',
    port: 43210,
    boundaries: {
      directExecution: false,
      directDiscordConnection: false,
      directServiceForwarding: false,
      directDndCallsAllowed: false
    },
    monitor: { schedulerOwnedExternally: true, githubWebhooksEnabled: false }
  };
  assert.equal(validateCoreReadiness(readiness, 'nonce'), 'http://127.0.0.1:43210');
  assert.throws(() => validateCoreReadiness({ ...readiness, targetService: 'khaos-nexus' }, 'nonce'), /target service is incompatible/i);
});

test('Veyra uses the bounded embedded-local profile while host and Sentinel remain production hardened', () => {
  const base = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\System32', NODE_OPTIONS: '--inspect' };
  const veyra = buildServiceEnvironment({
    parentEnv: base,
    nodeEnv: 'development',
    serviceData: 'C:\\Data\\Veyra',
    serviceEnv: AGENTS.dnd.env
  });
  const sentinel = buildServiceEnvironment({
    parentEnv: base,
    serviceData: 'C:\\Data\\Sentinel',
    serviceEnv: AGENTS.core.env
  });
  assert.equal(veyra.NODE_ENV, 'development');
  assert.equal(veyra.HOST, '127.0.0.1');
  assert.equal(veyra.AUTH_REQUIRED, 'false');
  assert.equal(sentinel.NODE_ENV, 'production');
  assert.equal(veyra.NODE_OPTIONS, undefined);
  assert.equal(sentinel.NODE_OPTIONS, undefined);
});

test('launcher terminates workers when their runtime host disconnects', () => {
  const source = read('main/ai-runtime-agent-launcher.cjs');
  assert.match(source, /process\.on\('disconnect'/);
  assert.match(source, /process\.emit\('SIGTERM'/);
  assert.match(source, /setTimeout\(\(\) => process\.exit\(0\), 1500\)/);
});

test('ADR-011 records one host and mandatory agent isolation', () => {
  const source = read('docs/ADR-011_UNIFIED_AI_RUNTIME_AGENTS.md');
  assert.match(source, /one \*\*Khaos Nexus AI Runtime\*\* host/i);
  assert.match(source, /Veyra — D&D Lorewarden and Co-DM/);
  assert.match(source, /Nexus Sentinel — System Health and Assistance AI/);
  assert.match(source, /separate worker processes/i);
  assert.match(source, /separate:[\s\S]*prompts[\s\S]*memory[\s\S]*endpoints/i);
});


test('Nexus Sentinel private files are contained inside its dedicated data directory', () => {
  const source = read('main/ai-runtime-host.cjs');
  assert.match(source, /function safePrivateFile\(root, value, label\)/);
  assert.match(source, /outside its private data directory/);
  assert.match(source, /safePrivateFile\(dataDir, input\.readyFile/);
  assert.match(source, /safePrivateFile\(dataDir, input\.monitorStateFile/);
});
