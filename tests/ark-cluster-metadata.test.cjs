'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const {
  parseIni,
  extractRates,
  extractMods,
  discoverServerMetadata,
  syncClusterMetadata
} = require('../src/sentinel/ark-cluster-metadata.cjs');
const { effectiveRates, effectiveMods } = require('../src/sentinel/ark-cluster-panel.cjs');

const SAMPLE_GUS = `[ServerSettings]\nXPMultiplier=2.0\nTamingSpeedMultiplier=10.0\nHarvestAmountMultiplier=5.0\nEggHatchSpeedMultiplier=8\nBabyMatureSpeedMultiplier=12\nActiveMods=111111,222222,333333\n`;

test('ARK metadata parser reads case-insensitive INI sections and keys', () => {
  const ini = parseIni('[ServerSettings]\nHarvestAmountMultiplier=5\n');
  assert.equal(ini.serversettings.harvestamountmultiplier, '5');
});

test('ARK metadata discovery extracts common live rates', () => {
  assert.deepEqual(extractRates(SAMPLE_GUS), {
    XP: '2x',
    Taming: '10x',
    Harvest: '5x',
    'Egg Hatch': '8x',
    'Baby Mature': '12x'
  });
});

test('ARK metadata discovery extracts active mod ids without duplicates', () => {
  assert.deepEqual(extractMods('[ServerSettings]\nActiveMods=111,222,111\n'), ['111', '222']);
});

test('server metadata uses existing safe SFTP config reader abstraction', async () => {
  const result = await discoverServerMetadata({ envPrefix: 'ARK_TEST', connections: { sftp: true } }, {
    reader: async (prefix, key) => ({ text: SAMPLE_GUS, remoteFile: `${prefix}/${key}`, discovered: true })
  });
  assert.equal(result.rates.Harvest, '5x');
  assert.equal(result.mods.length, 3);
  assert.equal(result.discoveredPath, true);
});

test('metadata sync continuously updates detected values without overwriting staff-curated overrides', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-meta-'));
  const registry = new ArkClusterRegistry(root);
  registry.upsert({
    id: 'gen1',
    name: 'Gen 1',
    mapName: 'Genesis Part 1',
    mapIdentifier: 'Genesis_WP',
    envPrefix: 'ARK_GEN1',
    rates: {},
    mods: [],
    connections: { rcon: true, sftp: true }
  });

  await syncClusterMetadata(registry, {
    reader: async () => ({ text: SAMPLE_GUS, remoteFile: 'GameUserSettings.ini', discovered: false })
  });
  let record = registry.get('gen1');
  assert.equal(record.detectedRates.Harvest, '5x');
  assert.deepEqual(record.detectedMods, ['111111', '222222', '333333']);
  assert.equal(effectiveRates(record).Harvest, '5x');
  assert.deepEqual(effectiveMods(record), ['111111', '222222', '333333']);

  registry.upsert({ ...record, rates: { Harvest: 'Custom 7x' }, mods: ['Named Mod'] });
  await syncClusterMetadata(registry, {
    reader: async () => ({ text: '[ServerSettings]\nHarvestAmountMultiplier=100\nActiveMods=999\n', remoteFile: 'GameUserSettings.ini', discovered: false })
  });
  record = registry.get('gen1');
  assert.equal(record.detectedRates.Harvest, '100x');
  assert.deepEqual(record.detectedMods, ['999']);
  assert.deepEqual(record.rates, { Harvest: 'Custom 7x' });
  assert.deepEqual(record.mods, ['Named Mod']);
  assert.deepEqual(effectiveRates(record), { Harvest: 'Custom 7x' });
  assert.deepEqual(effectiveMods(record), ['Named Mod']);
});
