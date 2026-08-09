'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { latestYmlAdvertisesVersion } = require('../scripts/release-metadata.cjs');

test('latest.yml version matcher accepts LF and CRLF metadata', () => {
  assert.equal(latestYmlAdvertisesVersion('version: 0.40.1\npath: installer.exe\n', '0.40.1'), true);
  assert.equal(latestYmlAdvertisesVersion('version: 0.40.1\r\npath: installer.exe\r\n', '0.40.1'), true);
});

test('latest.yml version matcher escapes regex metacharacters and rejects mismatches', () => {
  assert.equal(latestYmlAdvertisesVersion('version: 0.40.1-B+hotfix\n', '0.40.1-B+hotfix'), true);
  assert.equal(latestYmlAdvertisesVersion('version: 0x40x1-B+hotfix\n', '0.40.1-B+hotfix'), false);
  assert.equal(latestYmlAdvertisesVersion('version: 0.40.0\n', '0.40.1'), false);
  assert.equal(latestYmlAdvertisesVersion('version: 0.40.1-beta\n', '0.40.1'), false);
});
