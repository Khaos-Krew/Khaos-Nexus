'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseIdentity } = require('../scripts/validate-release-label.cjs');

function packageFixture(version, tag, channel, display) {
  return {
    version,
    khaosRelease: {
      publicTag: tag,
      channel,
      updaterVersion: version,
      displayVersion: display
    }
  };
}

test('future beta release labels use -B while internal versions stay stable SemVer', () => {
  const result = validateReleaseIdentity(packageFixture('0.27.0', 'v0.27.0-B', 'beta', '0.27.0-B'));
  assert.deepEqual(result, {
    internalVersion: '0.27.0',
    publicTag: 'v0.27.0-B',
    channel: 'beta',
    legacy: false
  });
});

test('future stable release labels use -R and reject a beta channel mismatch', () => {
  assert.equal(validateReleaseIdentity(packageFixture('0.27.0', 'v0.27.0-R', 'stable', '0.27.0-R')).channel, 'stable');
  assert.throws(
    () => validateReleaseIdentity(packageFixture('0.27.0', 'v0.27.0-R', 'beta', '0.27.0-R')),
    /requires channel stable/i
  );
});

test('public labels never replace the internal updater SemVer', () => {
  assert.throws(
    () => validateReleaseIdentity(packageFixture('0.27.0-B', 'v0.27.0-B', 'beta', '0.27.0-B')),
    /Internal package version must be stable monotonic SemVer/i
  );
});

test('legacy v0.26.5-beta remains recognized without weakening future policy', () => {
  const result = validateReleaseIdentity(packageFixture('0.26.5', 'v0.26.5-beta', 'beta', '0.26.5-beta'));
  assert.equal(result.legacy, true);
  assert.throws(
    () => validateReleaseIdentity(packageFixture('0.28.0', 'v0.28.0-beta', 'beta', '0.28.0-beta')),
    /must end in -B.*-R/i
  );
});

test('workflow enforces release labels on pull requests and tags', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-label-policy.yml'), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /tags:/);
  assert.match(workflow, /validate-release-label\.cjs/);
  assert.match(workflow, /KHAOS_RELEASE_TAG/);
});
