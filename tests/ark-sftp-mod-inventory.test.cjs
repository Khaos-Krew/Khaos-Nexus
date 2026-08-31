'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseInstalledModEntries,
  inspectInstalledArkMods
} = require('../src/sentinel/ark-sftp-mod-inventory.cjs');

test('ASA disk inventory extracts project and installed file ids without duplicates', () => {
  assert.deepEqual(parseInstalledModEntries([
    { name: '928548_5507937', type: 'd' },
    { name: '942249_6567374', type: 'd' },
    { name: '928548.mod', type: '-' },
    { name: 'unrelated.txt', type: '-' }
  ]), [
    { projectId: '928548', fileId: '5507937' },
    { projectId: '942249', fileId: '6567374' }
  ]);
});

test('ASA disk inventory reads only the bounded map-local CurseForge directory', async () => {
  const listed = [];
  const result = await inspectInstalledArkMods('ARK_TEST', {
    settings: { host: 'example', username: 'user', password: 'secret', root: '.', port: 22, readyTimeout: 1000 },
    shooterGameRoot: 'map1/ShooterGame',
    client: {
      async list(remote) {
        listed.push(remote);
        if (remote.endsWith('/Mods/83374')) return [{ name: '928548_5507937', type: 'd' }];
        throw new Error('unexpected path');
      }
    }
  });
  assert.deepEqual(listed, ['map1/ShooterGame/Mods/83374']);
  assert.deepEqual(result.modIds, ['928548']);
  assert.equal(result.accessible, true);
});
