'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeServerId,
  prefixForServer,
  summarizeConfigDiff,
  captureConfigDriftStatus
} = require('../src/sentinel/ark-config-drift-status.cjs');

test('ARK config drift status only accepts known source-of-truth servers', () => {
  assert.equal(normalizeServerId('GEN1'), 'gen1');
  assert.equal(prefixForServer('astraeos'), 'ARK_MAP2');
  assert.throws(() => normalizeServerId('unknown-map'), /unsupported ARK source-of-truth server/i);
});

test('drift summary exposes bounded gameplay differences without paths or raw capture metadata', () => {
  const summary = summarizeConfigDiff({
    serverId: 'gen1',
    prefix: 'ARK_GEN1',
    paths: {
      gameUserSettings: '/secret/server/path/GameUserSettings.ini',
      game: '/secret/server/path/Game.ini'
    },
    diff: {
      gameUserSettings: [
        { key: 'TamingSpeedMultiplier', expected: '10.0', actual: '8.0' },
        { key: 'XPMultiplier', expected: '5.0', actual: '4.0' }
      ],
      game: [
        { key: 'PerLevelStatsMultiplier_Player[7]', expected: '30.0', actual: '20.0' }
      ]
    }
  }, { maxEntries: 2 });

  assert.equal(summary.inSync, false);
  assert.equal(summary.driftCount, 3);
  assert.deepEqual(summary.counts, { gameUserSettings: 2, game: 1 });
  assert.equal(summary.entries.length, 2);
  assert.equal(summary.truncated, true);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('/secret/server/path'), false);
  assert.equal(serialized.includes('ARK_GEN1'), false);
});

test('clean drift summary reports in-sync state', () => {
  const summary = summarizeConfigDiff({
    serverId: 'astraeos',
    diff: { gameUserSettings: [], game: [] }
  });
  assert.equal(summary.inSync, true);
  assert.equal(summary.driftCount, 0);
  assert.equal(summary.truncated, false);
});

test('capture status maps server id to the expected read-only SFTP prefix and rejects cross-server results', async () => {
  let requestedPrefix = '';
  const clean = await captureConfigDriftStatus({
    serverId: 'gen1',
    capture: async ({ prefix }) => {
      requestedPrefix = prefix;
      return { serverId: 'gen1', diff: { gameUserSettings: [], game: [] } };
    }
  });
  assert.equal(requestedPrefix, 'ARK_GEN1');
  assert.equal(clean.inSync, true);

  await assert.rejects(() => captureConfigDriftStatus({
    serverId: 'gen1',
    capture: async () => ({ serverId: 'astraeos', diff: { gameUserSettings: [], game: [] } })
  }), /unexpected server/i);
});
