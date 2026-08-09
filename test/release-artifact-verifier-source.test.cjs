'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release artifact verifier delegates latest.yml matching to the shared portable matcher', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release-artifacts.cjs'), 'utf8');
  assert.match(source, /latestYmlAdvertisesVersion\(latest, version\)/);
  assert.doesNotMatch(source, /\(\?m\)/);
});
