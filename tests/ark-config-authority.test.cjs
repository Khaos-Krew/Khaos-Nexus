'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadDesiredState,
  resolveDesiredProfile,
  validateManifest,
  auditServerDesiredState,
  digest
} = require('../src/sentinel/ark-config-authority.cjs');
const {
  applyProfile,
  protectedProfileRefs
} = require('../src/sentinel/ark-config-profile-service.cjs');

const manifestPath = path.resolve(__dirname, '../config/ark/desired-state/cluster.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Git-owned ARK desired-state manifest is preview-only until live verification', () => {
  const manifest = loadDesiredState(manifestPath);
  assert.equal(manifest.authority, 'github');
  assert.equal(manifest.applyMode, 'preview-only');
  assert.equal(manifest.liveVerified, false);
  assert.equal(manifest.policy.runtimeWritebackToGit, false);
  assert.equal(manifest.policy.automaticLiveApply, false);
  assert.equal(manifest.policy.automaticRestart, false);
  assert.match(manifest.digest, /^[a-f0-9]{64}$/);
  assert.ok(manifest.servers.gen1);
  assert.ok(manifest.servers.map2);
});

test('desired-state profile resolves cluster defaults plus map override without changing defaults', () => {
  const manifest = loadDesiredState(manifestPath);
  const copy = clone(manifest);
  copy.servers.map2.overrides = {
    gus: { sections: { ServerSettings: { HarvestAmountMultiplier: '6.0' } } }
  };
  const before = manifest.defaults.gus.sections.ServerSettings.HarvestAmountMultiplier;
  const profile = resolveDesiredProfile(copy, 'map2');
  assert.equal(profile.files.gus.sections.ServerSettings.HarvestAmountMultiplier, '6.0');
  assert.equal(manifest.defaults.gus.sections.ServerSettings.HarvestAmountMultiplier, before);
  assert.equal(profile.envPrefix, 'ARK_MAP2');
  assert.ok(profile.settings.total > 0);
});

test('player per-level stat settings are recorded in Git but classified as protected', () => {
  const manifest = loadDesiredState(manifestPath);
  const profile = resolveDesiredProfile(manifest, 'gen1');
  const refs = protectedProfileRefs(profile.files);
  assert.ok(refs.length > 0);
  assert.ok(refs.every((item) => /^PerLevelStatsMultiplier_Player\[\d+\]$/i.test(item.key)));
});

test('desired-state audit is read-only and reports drift without a writer', async () => {
  const manifest = loadDesiredState(manifestPath);
  const calls = [];
  const result = await auditServerDesiredState({
    serverId: 'map2',
    manifest,
    reader: async (prefix, fileKey) => {
      calls.push([prefix, fileKey]);
      return { remoteFile: `${fileKey}.ini`, text: '' };
    }
  });
  assert.equal(result.authority, 'github');
  assert.equal(result.writePerformed, false);
  assert.equal(result.drifted, true);
  assert.equal(result.changedFiles, 2);
  assert.ok(result.protectedSettings > 0);
  assert.deepEqual(calls, [['ARK_MAP2', 'gus'], ['ARK_MAP2', 'game']]);
});

test('ordinary config apply refuses protected player-stat settings before any write', async () => {
  let writes = 0;
  const profile = {
    id: 'protected-test',
    revision: 1,
    files: {
      game: {
        sections: {
          '/Script/ShooterGame.ShooterGameMode': {
            'PerLevelStatsMultiplier_Player[0]': '2.0'
          }
        }
      }
    }
  };
  await assert.rejects(() => applyProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile,
    reader: async () => ({ remoteFile: 'Game.ini', text: '[/Script/ShooterGame.ShooterGameMode]\nPerLevelStatsMultiplier_Player[0]=1.0\n' }),
    setter: async () => { writes += 1; return { changed: true }; }
  }), /protected player-stat setting/);
  assert.equal(writes, 0);
});

test('manifest validation fails closed if automatic config mutation is enabled', () => {
  const raw = clone(loadDesiredState(manifestPath));
  raw.policy.automaticLiveApply = true;
  assert.throws(() => validateManifest(raw), /automaticLiveApply must remain false/);
});

test('desired-state digest is stable across object key order', () => {
  assert.equal(digest({ b: 2, a: { d: 4, c: 3 } }), digest({ a: { c: 3, d: 4 }, b: 2 }));
});
