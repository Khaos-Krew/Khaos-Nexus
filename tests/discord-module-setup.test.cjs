'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LAYOUTS, layoutFor } = require('../src/sentinel/module-layouts.cjs');
const { StateStore } = require('../src/sentinel/state-store.cjs');

const EXPECTED = ['ark', 'palworld', 'minecraft', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'dnd'];

test('every registered game module has a Discord layout and join-to-build channel', () => {
  for (const id of EXPECTED) {
    const layout = layoutFor(id);
    assert.ok(layout.category);
    assert.ok(layout.consoleChannel);
    assert.ok(layout.text.includes(layout.consoleChannel));
    assert.match(layout.lobbyBuilder, /Join to Create/);
  }
  assert.deepEqual(Object.keys(LAYOUTS).sort(), [...EXPECTED].sort());
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
