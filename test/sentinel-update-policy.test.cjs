'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  versionFromSentinelTag,
  isSentinelRelease,
  selectSentinelRelease,
  sentinelPortableAsset,
  sentinelSetupAsset,
  sentinelUpdateMetadataAsset,
  digestFromAsset,
  startupAccepted
} = require('../shared/sentinel-update-policy.cjs');

test('Sentinel updater rejects monolith and unrelated releases', () => {
  assert.equal(versionFromSentinelTag('v0.34.0-sentinel'), '0.34.0');
  assert.equal(versionFromSentinelTag('v0.34.0-sentinel-rc1'), '0.34.0');
  assert.equal(versionFromSentinelTag('v0.99.0'), '');
  assert.equal(isSentinelRelease({ tag_name: 'v9.0.0', draft: false, prerelease: false }, 'test'), false);
  assert.equal(isSentinelRelease({ tag_name: 'v0.34.0-sentinel-rc1', draft: false, prerelease: true }, 'stable'), false);
  assert.equal(isSentinelRelease({ tag_name: 'v0.34.0-sentinel-rc1', draft: false, prerelease: true }, 'test'), true);
});

test('Sentinel updater selects only a newer matching release', () => {
  const releases = [
    { tag_name: 'v99.0.0', draft: false, prerelease: false },
    { tag_name: 'v0.32.0-sentinel-roadmap', draft: false, prerelease: false },
    { tag_name: 'v0.34.0-sentinel-rc1', draft: false, prerelease: true },
    { tag_name: 'v0.35.0-sentinel-rc2', draft: true, prerelease: true }
  ];
  const selected = selectSentinelRelease(releases, '0.33.0', 'test');
  assert.equal(selected.version, '0.34.0');
  assert.equal(selected.release.tag_name, 'v0.34.0-sentinel-rc1');
  assert.equal(selectSentinelRelease(releases, '0.34.0', 'test'), null);
});

test('Sentinel release asset policy requires Sentinel-named Windows artifacts', () => {
  const release = {
    assets: [
      { name: 'Khaos-Nexus-Portable-9.0.0-x64.exe' },
      { name: 'Khaos-Nexus-Sentinel-Portable-0.34.0-RC1-x64.exe' },
      { name: 'Khaos-Nexus-Sentinel-Setup-0.34.0-RC1-x64.exe' },
      { name: 'latest.yml' }
    ]
  };
  assert.match(sentinelPortableAsset(release).name, /Sentinel-Portable/);
  assert.match(sentinelSetupAsset(release).name, /Sentinel-Setup/);
  assert.equal(sentinelUpdateMetadataAsset(release).name, 'latest.yml');
  assert.equal(digestFromAsset({ digest: `sha256:${'a'.repeat(64)}` }), 'a'.repeat(64));
  assert.equal(digestFromAsset({ digest: 'sha256:nope' }), '');
});

test('post-update acceptance requires completed startup without critical failure', () => {
  assert.equal(startupAccepted({ completed: true, overall: 'healthy', checks: [] }), true);
  assert.equal(startupAccepted({ completed: true, overall: 'warning', checks: [{ critical: false, status: 'warn' }] }), true);
  assert.equal(startupAccepted({ completed: true, overall: 'failed', checks: [{ critical: true, status: 'fail' }] }), false);
  assert.equal(startupAccepted({ completed: false, overall: 'running', checks: [] }), false);
});
