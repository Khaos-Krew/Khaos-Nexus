'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public release label is displayed globally without exposing rollback inventory', () => {
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'update-history-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'release-label-display.js'), 'utf8');
  assert.match(extension, /update-history:identity/);
  assert.match(extension, /currentVersion/);
  assert.match(extension, /currentLabel/);
  assert.match(extension, /channel/);
  assert.match(extension, /addScript\('release-label-display\.js'\)/);
  assert.match(renderer, /versionLabel/);
  assert.match(renderer, /Version \$\{identity\.currentLabel\}/);
  assert.doesNotMatch(renderer, /update-history:rollback/);
  assert.doesNotMatch(renderer, /releaseUrl|browser_download_url|assetSha256/);
});
