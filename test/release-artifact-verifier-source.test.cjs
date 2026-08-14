'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release artifact verifier uses channel-aware updater metadata and artifact version for filenames', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release-artifacts.cjs'), 'utf8');
  assert.match(source, /const artifactVersion =/);
  assert.match(source, /const updaterVersion =/);
  assert.match(source, /const releaseChannel =/);
  assert.match(source, /const updaterMetadataName = releaseChannel === 'beta' \? 'beta\.yml' : 'latest\.yml'/);
  assert.match(source, /latestYmlAdvertisesVersion\(metadata, updaterVersion\)/);
  assert.match(source, /Khaos-Nexus-Setup-\$\{artifactVersion\}-\$\{arch\}\.exe/);
  assert.match(source, /Khaos-Nexus-Portable-\$\{artifactVersion\}-\$\{arch\}\.exe/);
  assert.match(source, /releaseChannel,/);
  assert.match(source, /updaterMetadataName,/);
  assert.doesNotMatch(source, /latestYmlAdvertisesVersion\(metadata, artifactVersion\)/);
  assert.doesNotMatch(source, /\(\?m\)/);
});
