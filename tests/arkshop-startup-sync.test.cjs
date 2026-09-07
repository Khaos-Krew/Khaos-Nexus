'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { unsupportedReload, syncArkShopMysqlIfRequested } = require('../src/sentinel/arkshop-startup-sync.cjs');

test('ArkShop reload rejects only command-not-supported responses', () => {
  assert.equal(unsupportedReload('Unknown command: ArkShop.Reload'), true);
  assert.equal(unsupportedReload('ArkShop config reloaded'), false);
  assert.equal(unsupportedReload(''), false);
});

test('MySQL sync stamp is written only after the live ArkShop reload succeeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-sync-'));
  const previous = process.env.ARK_GEN1_ARKSHOP_MYSQL_SYNC_ONCE;
  process.env.ARK_GEN1_ARKSHOP_MYSQL_SYNC_ONCE = 'reload-test-v1';
  try {
    await assert.rejects(
      syncArkShopMysqlIfRequested({
        stampDirectory: dir,
        syncer: async () => ({ changed: true, remoteFile: '/config.json', backup: '/backup.json' }),
        reloader: async () => { throw new Error('RCON unavailable'); }
      }),
      /RCON unavailable/
    );
    assert.equal(fs.readdirSync(dir).length, 0);

    const result = await syncArkShopMysqlIfRequested({
      stampDirectory: dir,
      syncer: async () => ({ changed: false, remoteFile: '/config.json', backup: null }),
      reloader: async () => ({ reloaded: true, responseBytes: 12 })
    });
    assert.equal(result.reloaded, true);
    assert.equal(result.restartRequired, false);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    if (previous == null) delete process.env.ARK_GEN1_ARKSHOP_MYSQL_SYNC_ONCE;
    else process.env.ARK_GEN1_ARKSHOP_MYSQL_SYNC_ONCE = previous;
  }
});
