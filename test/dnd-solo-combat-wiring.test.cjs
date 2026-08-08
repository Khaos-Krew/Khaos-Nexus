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

test('solo combat is production-authorized with no automatic Discord path', () => {
  const main = read('main/dnd-solo-combat-extension.cjs');
  const shared = read('shared/dnd-solo-combat.cjs');
  const renderer = read('renderer/dnd-solo-combat.js');
  assert.match(main, /releaseAuthorized:\s*true/);
  assert.match(main, /privateDevelopmentOnly:\s*false/);
  assert.match(renderer, /Production D&D runtime/);
  assert.doesNotMatch(renderer, /Release prohibited|Private development slice/);
  assert.doesNotMatch(`${main}\n${shared}`, /electron-updater|publish always|createRelease|webhook|discord\.js/);
});
