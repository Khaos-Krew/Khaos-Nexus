'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('group runtime installs after solo combat runtime', () => {
  const entry = read('main/entry.cjs');
  const solo = entry.indexOf("require('./dnd-solo-combat-extension.cjs').install();");
  const group = entry.indexOf("require('./dnd-group-runtime-extension.cjs').install();");
  assert.ok(solo >= 0);
  assert.ok(group > solo);
});

test('group runtime has no automatic Discord or release path', () => {
  const main = read('main/dnd-group-runtime-extension.cjs');
  const delivery = read('shared/dnd-group-delivery.cjs');
  const renderer = read('renderer/dnd-group-runtime.js');
  assert.match(main, /automaticDiscordPublication:\s*false/);
  assert.match(main, /releaseAuthorized:\s*false/);
  assert.match(delivery, /discordPublished:\s*false/);
  assert.match(renderer, /No Discord message is sent automatically/);
  assert.doesNotMatch(`${main}\n${delivery}`, /electron-updater|publish always|createRelease|WebhookClient|new Client\(/);
});
