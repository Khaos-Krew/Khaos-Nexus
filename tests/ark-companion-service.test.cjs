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

function rexPayload(extra = {}) {
  return {
    creature: 'Rex',
    wildLevel: 150,
    food: 'Raw Mutton',
    tamingRate: 3,
    foodDrainRate: 2,
    ...extra
  };
}

test('ARK companion normalizes creature names and creates a rate-aware Dododex link', () => {
  assert.equal(creatureSlug(' Carcharodontosaurus '), 'carcharodontosaurus');
  assert.equal(dododexUrl('Rex', 3), 'https://www.dododex.com/taming/rex?taming=3');
  assert.equal(knownBaseMinutes('Argentavis'), 72);
});

test('ARK companion requires the tame, level, food, taming rate, and food drain', async () => {
  const service = new ArkCompanionService();
  await assert.rejects(service.invoke('ark', 'taming', { wildLevel: 150, food: 'Raw Mutton', tamingRate: 3, foodDrainRate: 1 }), /Creature name/i);
  await assert.rejects(service.invoke('ark', 'taming', { creature: 'Rex', food: 'Raw Mutton', tamingRate: 3, foodDrainRate: 1 }), /Wild level/i);
  await assert.rejects(service.invoke('ark', 'taming', { creature: 'Rex', wildLevel: 150, tamingRate: 3, foodDrainRate: 1 }), /Taming food/i);
  await assert.rejects(service.invoke('ark', 'taming', { creature: 'Rex', wildLevel: 150, food: 'Raw Mutton', foodDrainRate: 1 }), /Taming rate/i);
  await assert.rejects(service.invoke('ark', 'taming', { creature: 'Rex', wildLevel: 150, food: 'Raw Mutton', tamingRate: 3 }), /Food drain rate/i);
});

test('ARK companion carries complete tame inputs and uses both server rates for the planning reference', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', rexPayload());
  assert.equal(result.creature, 'Rex');
  assert.equal(result.wildLevel, 150);
  assert.equal(result.food, 'Raw Mutton');
  assert.equal(result.baseMinutes, 96);
  assert.equal(result.estimatedMinutes, 16);
  assert.equal(result.tamingRate, 3);
  assert.equal(result.foodDrainRate, 2);
  assert.match(result.estimateNote, /planning reference/i);
  assert.match(result.estimateNote, /Dododex/i);
  assert.match(result.dododexNote, /Food Drain/i);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'finalLevel'), false);
});

test('ARK companion accepts an internal caller-supplied base time for creatures outside the recovered reference table', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', {
    creature: 'Custom Creature', wildLevel: 150, food: 'Kibble', tamingRate: 4, foodDrainRate: 0.5, baseMinutes: 120
  });
  assert.equal(result.baseMinutes, 120);
  assert.equal(result.estimatedMinutes, 60);
  assert.match(result.dododexUrl, /custom-creature\?taming=4$/);
});

test('unknown creatures return a safe Dododex link without fabricating a tame estimate', async () => {
  const service = new ArkCompanionService();
  const result = await service.invoke('ark', 'taming', {
    creature: 'Unknown Creature', wildLevel: 225, food: 'Custom Food', tamingRate: 2, foodDrainRate: 1.5
  });
  assert.equal(result.estimateAvailable, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'estimatedMinutes'), false);
  assert.equal(result.wildLevel, 225);
  assert.equal(result.food, 'Custom Food');
  assert.equal(result.foodDrainRate, 1.5);
  assert.match(result.estimateNote, /will not invent/i);
  assert.match(result.dododexUrl, /unknown-creature\?taming=2$/);
});

test('ARK companion validates rate, food-drain, level, and base-time bounds', async () => {
  assert.equal(estimateTameMinutes(96, 3, 2), 16);
  assert.throws(() => estimateTameMinutes(96, 0, 1), /Taming rate/i);
  assert.throws(() => estimateTameMinutes(96, 3, 0), /Food drain rate/i);
  const service = new ArkCompanionService();
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ wildLevel: 0 })), /Wild level/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ tamingRate: 0 })), /Taming rate/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ foodDrainRate: 0 })), /Food drain rate/i);
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
  const result = await runtime.invoke('ark', 'taming', rexPayload(), { role: 'viewer' });
  assert.equal(result.ok, true);
  assert.equal(result.data.estimatedMinutes, 16);
  assert.equal(result.data.foodDrainRate, 2);
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
