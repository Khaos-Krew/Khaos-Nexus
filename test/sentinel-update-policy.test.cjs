'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSentinelTag,
  sentinelAssetName,
  sentinelManifestName,
  selectSentinelRelease,
  findReleaseAsset,
  parseChecksumManifest,
  digestForAsset,
  compareVersions
} = require('../shared/sentinel-update-policy.cjs');

function release(tag, extra = {}) {
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    assets: [],
    ...extra
  };
}

test('Sentinel update policy accepts only the dedicated stable tag contract', () => {
  assert.deepEqual(parseSentinelTag('v0.33.0-sentinel'), { tag: 'v0.33.0-sentinel', version: '0.33.0', channel: 'sentinel' });
  for (const value of ['v0.33.0', 'v0.33.0-sentinel-roadmap', 'v0.33.0-dnd', 'latest', 'v1.2-sentinel']) {
    assert.equal(parseSentinelTag(value), null, value);
  }
});

test('Sentinel update policy generates exact Windows release asset names', () => {
  assert.equal(sentinelAssetName('0.33.0', 'installed'), 'Khaos-Nexus-Sentinel-Setup-0.33.0-x64.exe');
  assert.equal(sentinelAssetName('0.33.0', 'portable'), 'Khaos-Nexus-Sentinel-Portable-0.33.0-x64.exe');
  assert.equal(sentinelManifestName('0.33.0'), 'Khaos-Nexus-Sentinel-0.33.0-sha256.json');
});

test('Sentinel release selection ignores monolith, D&D, draft and prerelease entries', () => {
  const releases = [
    release('v9.0.0'),
    release('v9.0.0-dnd'),
    release('v0.35.0-sentinel', { draft: true }),
    release('v0.34.0-sentinel', { prerelease: true }),
    release('v0.33.1-sentinel'),
    release('v0.34.0-sentinel')
  ];
  const selected = selectSentinelRelease(releases, { currentVersion: '0.33.0' });
  assert.equal(selected.parsed.version, '0.34.0');
  assert.equal(compareVersions('0.34.0', '0.33.9'), 1);
});

test('Sentinel release asset selection is exact and never falls back to a generic executable', () => {
  const selected = release('v0.34.0-sentinel', {
    assets: [
      { name: 'Khaos-Nexus-Setup-0.34.0-x64.exe' },
      { name: 'Khaos-Nexus-Sentinel-Setup-0.34.0-x64.exe' }
    ]
  });
  assert.equal(findReleaseAsset(selected, '0.34.0', 'installed').name, 'Khaos-Nexus-Sentinel-Setup-0.34.0-x64.exe');
});

test('Sentinel checksum manifests are version-bound and provide trusted asset digests', () => {
  const digest = 'a'.repeat(64);
  const manifest = parseChecksumManifest(JSON.stringify({
    version: '0.34.0',
    assets: {
      'Khaos-Nexus-Sentinel-Portable-0.34.0-x64.exe': { sha256: digest, bytes: 123 }
    }
  }), '0.34.0');
  assert.equal(digestForAsset({ name: 'Khaos-Nexus-Sentinel-Portable-0.34.0-x64.exe' }, manifest), digest);
  assert.throws(() => parseChecksumManifest(JSON.stringify({ version: '0.35.0', assets: { x: digest } }), '0.34.0'), /version does not match/i);
});
