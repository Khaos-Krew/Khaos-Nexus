'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ArkConfigProfileStore,
  validateSettingKey,
  countSettings
} = require('../src/sentinel/ark-config-profiles.cjs');
const {
  ArkConfigApplyStore,
  previewProfile,
  applyProfile,
  rollbackTransaction
} = require('../src/sentinel/ark-config-profile-service.cjs');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { renderRestartState } = require('../src/sentinel/ark-cluster-panel.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-profile-'));
}

function sampleProfile() {
  return {
    id: 'event-5x',
    name: 'Event 5x',
    revision: 3,
    files: {
      gus: { sections: { ServerSettings: { HarvestAmountMultiplier: '5', TamingSpeedMultiplier: '5' } } },
      game: { sections: { '/script/shootergame.shootergamemode': { XPMultiplier: '2' } } }
    }
  };
}

test('ARK config profiles are versioned and retain prior snapshots', () => {
  const store = new ArkConfigProfileStore(tempRoot());
  store.create({ id: 'weekend', name: 'Weekend Rates' });
  const r2 = store.setSetting({ profileId: 'weekend', fileKey: 'gus', section: 'ServerSettings', key: 'HarvestAmountMultiplier', value: '5' });
  const r3 = store.setSetting({ profileId: 'weekend', fileKey: 'gus', section: 'ServerSettings', key: 'TamingSpeedMultiplier', value: '10' });
  assert.equal(r2.revision, 2);
  assert.equal(r3.revision, 3);
  assert.deepEqual(r3.history.map((item) => item.revision), [1, 2]);
  assert.equal(countSettings(r3.files).total, 2);
});

test('reusable ARK config profiles reject password token secret and credential keys', () => {
  for (const key of ['ServerPassword', 'ApiToken', 'mysql_secret', 'credentialKey', 'API_KEY']) {
    assert.throws(() => validateSettingKey(key), /Sensitive\/password\/token/);
  }
  assert.equal(validateSettingKey('HarvestAmountMultiplier'), 'HarvestAmountMultiplier');
});

test('profile revision restore creates a new revision instead of rewinding history', () => {
  const store = new ArkConfigProfileStore(tempRoot());
  store.create({ id: 'rates', name: 'Rates' });
  store.setSetting({ profileId: 'rates', fileKey: 'gus', section: 'ServerSettings', key: 'HarvestAmountMultiplier', value: '5' });
  store.setSetting({ profileId: 'rates', fileKey: 'gus', section: 'ServerSettings', key: 'HarvestAmountMultiplier', value: '10' });
  const restored = store.restoreRevision('rates', 2);
  assert.equal(restored.revision, 4);
  assert.equal(restored.files.gus.sections.ServerSettings.HarvestAmountMultiplier, '5');
});

test('profile preview compares both INI files without writing them', async () => {
  const calls = [];
  const result = await previewProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: sampleProfile(),
    reader: async (prefix, fileKey) => {
      calls.push([prefix, fileKey]);
      return {
        remoteFile: fileKey === 'gus' ? 'GameUserSettings.ini' : 'Game.ini',
        text: fileKey === 'gus'
          ? '[ServerSettings]\nHarvestAmountMultiplier=1\nTamingSpeedMultiplier=1\n'
          : '[/script/shootergame.shootergamemode]\nXPMultiplier=1\n'
      };
    }
  });
  assert.equal(result.settings, 3);
  assert.equal(result.changedFiles, 2);
  assert.equal(result.restartRequired, true);
  assert.deepEqual(calls, [['ARK_GEN1', 'gus'], ['ARK_GEN1', 'game']]);
});

test('successful config profile apply records every changed backup in one transaction', async () => {
  const root = tempRoot();
  const applyStore = new ArkConfigApplyStore(root);
  let counter = 0;
  const result = await applyProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: sampleProfile(),
    actorId: '1234567890',
    applyStore,
    reader: async (prefix, fileKey) => ({ remoteFile: `${fileKey}.ini`, text: fileKey === 'gus' ? '[ServerSettings]\nHarvestAmountMultiplier=1\nTamingSpeedMultiplier=1\n' : '[/script/shootergame.shootergamemode]\nXPMultiplier=1\n' }),
    setter: async ({ fileKey, key }) => ({ changed: true, backup: `${fileKey}/NexusBackups/${++counter}/${key}.bak`, remoteFile: `${fileKey}.ini` }),
    restorer: async () => { throw new Error('restorer should not run'); }
  });
  assert.equal(result.appliedSettings, 3);
  assert.equal(result.transaction.applied.length, 3);
  assert.equal(result.restartRequired, true);
  assert.equal(applyStore.get(result.transaction.id).profileRevision, 3);
});

test('partial profile failure automatically rolls back prior successful writes in reverse order', async () => {
  const restored = [];
  let setterCalls = 0;
  await assert.rejects(() => applyProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: sampleProfile(),
    applyStore: new ArkConfigApplyStore(tempRoot()),
    reader: async (prefix, fileKey) => ({ remoteFile: `${fileKey}.ini`, text: fileKey === 'gus' ? '[ServerSettings]\nHarvestAmountMultiplier=1\nTamingSpeedMultiplier=1\n' : '[/script/shootergame.shootergamemode]\nXPMultiplier=1\n' }),
    setter: async ({ fileKey, key }) => {
      setterCalls += 1;
      if (setterCalls === 3) throw new Error('simulated final write failure');
      return { changed: true, backup: `${fileKey}/backup-${key}`, remoteFile: `${fileKey}.ini` };
    },
    restorer: async ({ backup }) => { restored.push(backup); return { changed: true }; }
  }), /2 applied setting\(s\) were rolled back/);
  assert.equal(restored.length, 2);
  assert.match(restored[0], /TamingSpeedMultiplier/);
  assert.match(restored[1], /HarvestAmountMultiplier/);
});

test('recorded profile transaction can be rolled back once and is marked rolled back', async () => {
  const applyStore = new ArkConfigApplyStore(tempRoot());
  applyStore.add({
    id: 'tx-1',
    serverId: 'gen1',
    envPrefix: 'ARK_GEN1',
    profileId: 'event-5x',
    profileRevision: 3,
    appliedAt: new Date().toISOString(),
    rolledBackAt: '',
    applied: [
      { fileKey: 'gus', backup: 'gus/NexusBackups/1/GameUserSettings.ini' },
      { fileKey: 'game', backup: 'game/NexusBackups/1/Game.ini' }
    ]
  });
  const restored = [];
  const result = await rollbackTransaction({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    transactionId: 'tx-1',
    applyStore,
    restorer: async ({ backup }) => { restored.push(backup); return { changed: true }; }
  });
  assert.equal(result.restored, 2);
  assert.match(applyStore.get('tx-1').rolledBackAt, /^\d{4}-/);
  assert.deepEqual(restored, ['game/NexusBackups/1/Game.ini', 'gus/NexusBackups/1/GameUserSettings.ini']);
  await assert.rejects(() => rollbackTransaction({ server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, transactionId: 'tx-1', applyStore, restorer: async () => ({}) }), /already been rolled back/);
});

test('cluster registry persists and renders pending config restart state', () => {
  const registry = new ArkClusterRegistry(tempRoot());
  registry.upsert({ id: 'gen1', name: 'Gen 1', mapName: 'Genesis 1', mapIdentifier: 'Genesis_WP', envPrefix: 'ARK_GEN1' });
  const marked = registry.setRestartRequired('gen1', { required: true, reason: 'Profile event-5x applied', transactionId: 'tx-123' });
  assert.equal(marked.restartRequired, true);
  assert.equal(marked.lastConfigTransactionId, 'tx-123');
  assert.match(renderRestartState(marked), /Restart required/);
  const cleared = registry.setRestartRequired('gen1', { required: false });
  assert.equal(cleared.restartRequired, false);
  assert.match(renderRestartState(cleared), /No pending config restart/);
});
