'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { latestYmlAdvertisesVersion } = require('../scripts/release-metadata.cjs');

test('latest.yml version matcher tolerates YAML spacing without matching other fields', () => {
  assert.equal(latestYmlAdvertisesVersion('version:    0.40.1   \nreleaseDate: now\n', '0.40.1'), true);
  assert.equal(latestYmlAdvertisesVersion('notes: version: 0.40.1\nversion: 0.40.0\n', '0.40.1'), false);
});
