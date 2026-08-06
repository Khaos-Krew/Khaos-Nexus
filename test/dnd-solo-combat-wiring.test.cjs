'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('solo combat extension installs after the campaign runtime', () => {
  const entry = read('main/entry.cjs');
  const foundation = entry.indexOf("require('./dnd-campaign-runtime-extension.cjs').install();");
  const solo = entry.indexOf("require('./dnd-solo-combat-extension.cjs').install();");
  assert.ok(foundation >= 0);
  assert.ok(solo > foundation);
});

test('solo combat slice contains no release or automatic Discord path', () => {
  const main = read('main/dnd-solo-combat-extension.cjs');
  const shared = read('shared/dnd-solo-combat.cjs');
  const renderer = read('renderer/dnd-solo-combat.js');
  assert.match(main, /releaseAuthorized:\s*false/);
  assert.match(renderer, /Release prohibited/);
  assert.doesNotMatch(`${main}\n${shared}`, /electron-updater|publish always|createRelease|webhook|discord\.js/);
});
