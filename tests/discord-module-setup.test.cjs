'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MODULES } = require('../src/backend/modules/catalog.cjs');
const { LAYOUTS, layoutFor } = require('../src/sentinel/module-layouts.cjs');
const { StateStore } = require('../src/sentinel/state-store.cjs');

const EXPECTED = ['ark', 'callofduty', 'deadbydaylight', 'diablo4', 'palworld', 'minecraft', 'oncehuman', 'osrs', 'runescape3', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'pokemongo', 'dnd'];

test('every registered game module has a Discord layout and join-to-build channel', () => {
  assert.deepEqual(MODULES.map((module) => module.id).sort(), [...EXPECTED].sort());
  for (const id of EXPECTED) {
    const layout = layoutFor(id);
    assert.ok(layout.category);
    assert.ok(layout.consoleChannel);
    assert.ok(layout.text.includes(layout.consoleChannel));
    assert.match(layout.lobbyBuilder, /Join to Create/);
  }
  assert.deepEqual(Object.keys(LAYOUTS).sort(), [...EXPECTED].sort());
});

test('OSRS, RuneScape 3, and Once Human keep independent user-facing Discord categories', () => {
  assert.equal(layoutFor('osrs').category, 'Old School RuneScape');
  assert.equal(layoutFor('runescape3').category, 'RuneScape 3');
  assert.equal(layoutFor('oncehuman').category, 'Once Human');
  assert.notEqual(layoutFor('osrs').consoleChannel, layoutFor('runescape3').consoleChannel);
  assert.ok(layoutFor('oncehuman').text.includes('once-human-lfg'));
  assert.ok(layoutFor('oncehuman').text.includes('once-human-reference'));
});

test('Sentinal state persists module setup and temporary lobby ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sentinal-'));
  const store = new StateStore(root);
  store.setModuleSetup('division2', {
    moduleId: 'division2', guildId: '1', categoryId: '2', consoleChannelId: '3', lobbyBuilderChannelId: '4'
  });
  store.setTempLobby('5', { channelId: '5', moduleId: 'division2', guildId: '1', ownerId: '6' });
  assert.equal(store.getModuleSetup('division2').consoleChannelId, '3');
  assert.equal(store.findTempLobbyByOwner('division2', '6').channelId, '5');
  assert.equal(store.removeTempLobby('5').ownerId, '6');
  assert.equal(store.getTempLobby('5'), null);
});
