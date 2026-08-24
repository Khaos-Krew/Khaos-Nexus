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
  calculateTame,
  mergeTamingData,
  normalizeName
} = require('../src/backend/services/ark-companion-service.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-companion-')); }

function fixtureDataset() {
  const base = {
    version: 'base-test',
    species: [
      {
        name: 'Rex',
        blueprintPath: '/Game/Genesis2/Missions/Hunt/Rex_Character_BP_Hunt.Rex_Character_BP_Hunt',
        variants: ['Mission'],
        fullStatsRaw: [[1100, 0.2], [420, 0.1], [1550, 0.06]],
        taming: { violent: false, nonViolent: false, affinityNeeded0: 3450, affinityIncreasePL: 150, foodConsumptionBase: 0.002314, foodConsumptionMult: 180.0634 }
      },
      {
        name: 'Rex',
        blueprintPath: '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP',
        fullStatsRaw: [[1100, 0.2], [420, 0.1], [1550, 0.06]],
        taming: { violent: true, nonViolent: false, affinityNeeded0: 3450, affinityIncreasePL: 150, torporDepletionPS0: 0.725, foodConsumptionBase: 0.002314, foodConsumptionMult: 180.0634 }
      },
      {
        name: 'Moschops',
        blueprintPath: '/Game/PrimalEarth/Dinos/Moschops/Moschops_Character_BP.Moschops_Character_BP',
        fullStatsRaw: [[375, 0.2], [300, 0.1], [300, 0.06]],
        taming: { violent: false, nonViolent: true, affinityNeeded0: 600, affinityIncreasePL: 30, wakeAffinityMult: 1, wakeFoodDeplMult: 1, foodConsumptionBase: 0.004, foodConsumptionMult: 100 }
      }
    ]
  };
  const asa = { version: 'asa-test', species: [] };
  const food = {
    version: 'food-test',
    tamingFoodData: {
      default: {
        specialFoodValues: {
          'Exceptional Kibble': { a: 400, f: 96 },
          'Extraordinary Kibble': { a: 400, f: 96 },
          'Raw Mutton': { a: 187.5, f: 50 },
          'Raw Prime Meat': { a: 150, f: 50 },
          'Cooked Lamb Chop': { a: 101.25, f: 49.945 },
          'Raw Meat': { a: 50, f: 50 },
          Mejoberry: { a: 30, f: 30 },
          'Giant Bee Honey': { a: 200, f: 80 }
        }
      },
      Rex: { eats: ['Exceptional Kibble', 'Extraordinary Kibble', 'Raw Mutton', 'Raw Prime Meat', 'Cooked Lamb Chop', 'Raw Meat'] },
      Moschops: { eats: ['Giant Bee Honey', 'Mejoberry'] }
    }
  };
  return mergeTamingData(base, asa, food);
}

function serviceFor(dataset = fixtureDataset()) {
  return new ArkCompanionService({
    dataSource: {
      species: async () => [...dataset.records.values()].map((record) => ({
        name: record.species.name,
        slug: normalizeName(record.species.name).replace(/\s+/g, '-'),
        violent: Boolean(record.species.taming.violent),
        nonViolent: Boolean(record.species.taming.nonViolent)
      })).sort((a, b) => a.name.localeCompare(b.name)),
      calculate: async (payload) => calculateTame(dataset, payload)
    }
  });
}

function rexPayload(extra = {}) {
  return {
    creature: 'Rex',
    wildLevel: 150,
    tamingRate: 6,
    foodDrainRate: 5,
    weaponDamagePercent: 298,
    tranqMethod: 'crossbow-arrow',
    ...extra
  };
}

test('ARK taming data selects the normal tameable species instead of mission variants', () => {
  const dataset = fixtureDataset();
  const rex = dataset.records.get('rex');
  assert.ok(rex);
  assert.equal(rex.species.taming.violent, true);
  assert.match(rex.species.blueprintPath, /PrimalEarth/);
});

test('ARK tame calculator scales KO ammo by level and weapon damage', async () => {
  const result = await serviceFor().invoke('ark', 'taming', rexPayload());
  const expectedTorpor = 1550 * (1 + 0.06 * 149);
  const expectedArrows = Math.ceil(expectedTorpor / (157.5 * 2.98));
  assert.equal(result.creature, 'Rex');
  assert.equal(result.wildLevel, 150);
  assert.equal(result.knockout.required, true);
  assert.equal(result.knockout.amount, expectedArrows);
  assert.equal(result.knockout.ammo, 'Tranq Arrows');
  assert.equal(result.knockout.weaponDamagePercent, 298);
});

test('ARK tame calculator returns the top five food choices with amounts', async () => {
  const result = await serviceFor().invoke('ark', 'taming', rexPayload());
  assert.equal(result.foods.length, 5);
  assert.equal(result.foods[0].food, 'Exceptional Kibble');
  assert.equal(result.foods[0].amount, 3);
  assert.equal(result.foods[1].food, 'Extraordinary Kibble');
  assert.ok(result.foods.every((food) => food.amount > 0 && food.durationSeconds > 0));
});

test('ARK tame calculator respects taming speed and food drain independently', async () => {
  const fastTame = await serviceFor().invoke('ark', 'taming', rexPayload({ tamingRate: 6, foodDrainRate: 1 }));
  const slowTame = await serviceFor().invoke('ark', 'taming', rexPayload({ tamingRate: 1, foodDrainRate: 1 }));
  const hungryTame = await serviceFor().invoke('ark', 'taming', rexPayload({ tamingRate: 1, foodDrainRate: 5 }));
  assert.ok(fastTame.foods[0].amount < slowTame.foods[0].amount);
  assert.equal(hungryTame.foods[0].amount, slowTame.foods[0].amount);
  assert.ok(hungryTame.foods[0].durationSeconds < slowTame.foods[0].durationSeconds);
});

test('passive tames never recommend KO ammo', async () => {
  const result = await serviceFor().invoke('ark', 'taming', {
    creature: 'Moschops', wildLevel: 100, tamingRate: 3, foodDrainRate: 2, weaponDamagePercent: 500, tranqMethod: 'longneck-shocking'
  });
  assert.equal(result.tamingType, 'passive');
  assert.equal(result.knockout.required, false);
  assert.match(result.knockout.reason, /do not knock/i);
  assert.equal(result.foods[0].food, 'Giant Bee Honey');
});

test('ARK companion exposes the tameable creature catalog for the Discord wizard', async () => {
  const species = await serviceFor().listSpecies();
  assert.deepEqual(species.map((item) => item.name), ['Moschops', 'Rex']);
  assert.equal(species.find((item) => item.name === 'Rex').violent, true);
});

test('ARK tame calculator validates input and does not fabricate unknown species', async () => {
  const service = serviceFor();
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ wildLevel: 0 })), /Wild level/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ tamingRate: 0 })), /Taming rate/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ foodDrainRate: 0 })), /Food drain rate/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ weaponDamagePercent: 0 })), /Weapon damage/i);
  await assert.rejects(service.invoke('ark', 'taming', rexPayload({ creature: 'Definitely Not A Dino' })), /No supported/i);
  await assert.rejects(service.invoke('ark', 'players', {}), /Unsupported ARK companion action/i);
});

test('ARK taming capability remains available without an ARK server provider', async () => {
  const runtime = new BackendRuntime({ config: { modules: { ark: { enabled: true } } }, providers: {}, services: {} });
  runtime.registerService('ark-companion', serviceFor());
  const manifest = runtime.manifests().find((module) => module.id === 'ark');
  assert.equal(manifest.configured, false);
  assert.ok(manifest.availableActions.includes('taming'));
  assert.ok(manifest.serviceAvailableActions.includes('taming'));
  assert.equal(manifest.providerAvailableActions.includes('taming'), false);
  const result = await runtime.invoke('ark', 'taming', rexPayload(), { role: 'viewer' });
  assert.equal(result.ok, true);
  assert.equal(result.data.knockout.required, true);
  assert.equal(result.data.foods.length, 5);
});

test('backend application registers the ARK companion service in the normal composition root', () => {
  const dir = tempDir();
  try {
    const app = createBackendApplication({
      backend: { host: '127.0.0.1', port: 0 },
      modules: { ark: { enabled: true } },
      scheduler: { stateFile: path.join(dir, 'schedules.json'), timeZone: 'America/Chicago' },
      accounts: { stateFile: path.join(dir, 'accounts.json') }
    }, { logger: { log() {} }, arkCompanion: serviceFor() });
    const ark = app.runtime.manifests().find((module) => module.id === 'ark');
    assert.ok(ark.serviceAvailableActions.includes('taming'));
    assert.deepEqual(app.arkCompanion.supportedActions, ['taming']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
