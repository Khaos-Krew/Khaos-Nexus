'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackendApplication } = require('../src/backend/application.cjs');
const { BackendRuntime } = require('../src/backend/core/runtime.cjs');
const {
  ArkCompanionService,
  creatureSlug,
  dododexUrl,
  estimateTameMinutes,
  knownBaseMinutes
} = require('../src/backend/services/ark-companion-service.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-companion-')); }

test('ARK companion normalizes creature names and creates a rate-aware Dododex link', () => {
  assert.equal(creatureSlug(' Carcharodontosaurus '), 'carcharodontosaurus');
  assert.equal(dododexUrl('Rex', 3), 'https://www.dododex.com/taming/rex?taming=3');
  assert.equal(knownBaseMinutes('Argentavis'), 72);
});

test('ARK companion rough tame estimate uses recovered 1x base time without inventing final-level math', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', { creature: 'Rex', tamingRate: 3 });
  assert.equal(result.creature, 'Rex');
  assert.equal(result.baseMinutes, 96);
  assert.equal(result.estimatedMinutes, 32);
  assert.equal(result.tamingRate, 3);
  assert.match(result.estimateNote, /rough planning estimate/i);
  assert.match(result.estimateNote, /Dododex remains authoritative/i);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'finalLevel'), false);
});

test('ARK companion accepts a caller-supplied base time for creatures outside the recovered reference table', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', { creature: 'Custom Creature', tamingRate: 4, baseMinutes: 120 });
  assert.equal(result.baseMinutes, 120);
  assert.equal(result.estimatedMinutes, 30);
  assert.match(result.dododexUrl, /custom-creature\?taming=4$/);
});

test('unknown creatures return a safe Dododex link without fabricating a tame estimate', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', { creature: 'Unknown Creature', tamingRate: 2 });
  assert.equal(result.estimateAvailable, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'estimatedMinutes'), false);
  assert.match(result.estimateNote, /base-minutes/i);
  assert.match(result.dododexUrl, /unknown-creature\?taming=2$/);
});

test('ARK companion validates rate/base-time bounds and rejects unrelated actions', async () => {
  assert.equal(estimateTameMinutes(96, 3), 32);
  assert.throws(() => estimateTameMinutes(96, 0), /Taming rate/i);
  const service = new ArkCompanionService();
  await assert.rejects(service.invoke('ark', 'taming', { creature: 'Rex', tamingRate: 0 }), /Taming rate/i);
  await assert.rejects(service.invoke('ark', 'players', {}), /Unsupported ARK companion action/i);
});

test('ARK taming capability remains available from the backend service even when no ARK server provider is configured', async () => {
  const runtime = new BackendRuntime({ config: { modules: { ark: { enabled: true } } }, providers: {}, services: {} });
  runtime.registerService('ark-companion', new ArkCompanionService());
  const manifest = runtime.manifests().find((module) => module.id === 'ark');
  assert.equal(manifest.configured, false);
  assert.ok(manifest.availableActions.includes('taming'));
  assert.ok(manifest.serviceAvailableActions.includes('taming'));
  assert.equal(manifest.providerAvailableActions.includes('taming'), false);
  const result = await runtime.invoke('ark', 'taming', { creature: 'Rex', tamingRate: 3 }, { role: 'viewer' });
  assert.equal(result.ok, true);
  assert.equal(result.data.estimatedMinutes, 32);
});

test('backend application registers the ARK companion service in the normal composition root', () => {
  const dir = tempDir();
  try {
    const app = createBackendApplication({
      backend: { host: '127.0.0.1', port: 0 },
      modules: { ark: { enabled: true } },
      scheduler: { stateFile: path.join(dir, 'schedules.json'), timeZone: 'America/Chicago' },
      accounts: { stateFile: path.join(dir, 'accounts.json') }
    }, { logger: { log() {} } });
    const ark = app.runtime.manifests().find((module) => module.id === 'ark');
    assert.ok(ark.serviceAvailableActions.includes('taming'));
    assert.deepEqual(app.arkCompanion.supportedActions, ['taming']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
