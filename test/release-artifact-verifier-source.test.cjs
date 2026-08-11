'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release artifact verifier uses updater version for latest.yml and artifact version for filenames', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release-artifacts.cjs'), 'utf8');
  assert.match(source, /const artifactVersion =/);
  assert.match(source, /const updaterVersion =/);
  assert.match(source, /latestYmlAdvertisesVersion\(latest, updaterVersion\)/);
  assert.match(source, /Khaos-Nexus-Setup-\$\{artifactVersion\}-\$\{arch\}\.exe/);
  assert.match(source, /Khaos-Nexus-Portable-\$\{artifactVersion\}-\$\{arch\}\.exe/);
  assert.doesNotMatch(source, /latestYmlAdvertisesVersion\(latest, artifactVersion\)/);
  assert.doesNotMatch(source, /\(\?m\)/);
});
