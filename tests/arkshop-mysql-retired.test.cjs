'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../src/sentinel/arkshop-database.cjs');
const mysql = require('../src/sentinel/arkshop-mysql.cjs');

const MODE_KEY = 'ARKSHOP_DB_MODE';
const FLAG_KEY = 'NEXUS_ARKSHOP_MYSQL_ENABLED';

function snapshotEnv() {
  return { mode: process.env[MODE_KEY], flag: process.env[FLAG_KEY] };
}

function restoreEnv(saved) {
  if (saved.mode == null) delete process.env[MODE_KEY];
  else process.env[MODE_KEY] = saved.mode;
  if (saved.flag == null) delete process.env[FLAG_KEY];
  else process.env[FLAG_KEY] = saved.flag;
}

test('ARKSHOP_DB_MODE=disabled retires ArkShop MySQL without connecting', async () => {
  const saved = snapshotEnv();
  let connectMysqlCalls = 0;
  const originalConnect = mysql.connectMysql;
  mysql.connectMysql = async (...args) => {
    connectMysqlCalls += 1;
    return originalConnect(...args);
  };

  try {
    for (const mode of ['disabled', 'off', 'retired', 'none', 'false', '0']) {
      process.env[MODE_KEY] = mode;
      delete process.env[FLAG_KEY];
      assert.equal(db.isArkShopMysqlRetired(), true, mode);
      assert.equal(mysql.isRetired(), true, mode);
      assert.equal(db.databaseModeFromEnv(), 'retired', mode);
    }

    process.env[MODE_KEY] = 'mysql';
    process.env[FLAG_KEY] = 'false';
    assert.equal(db.isArkShopMysqlRetired(), true);
    assert.equal(db.databaseModeFromEnv(), 'retired');

    process.env[MODE_KEY] = 'disabled';
    delete process.env[FLAG_KEY];
    delete process.env.ARKSHOP_DB_HOST;
    delete process.env.ARKSHOP_DB_NAME;
    delete process.env.ARKSHOP_DB_USER;
    delete process.env.ARKSHOP_DB_PASSWORD;

    assert.doesNotThrow(() => mysql.validateMysqlConfig({ host: '', database: '', user: '', password: '' }));
    const status = await db.databaseStatus();
    assert.deepEqual(status, { backend: 'retired', connected: false });
    assert.equal(connectMysqlCalls, 0);

    const opened = await originalConnect();
    assert.deepEqual(opened, { retired: true, connection: null, config: null });
    const directStatus = await mysql.mysqlStatus();
    assert.equal(directStatus.connected, false);
    assert.equal(directStatus.retired, true);
    assert.equal(directStatus.database, undefined);

    process.env[MODE_KEY] = 'mysql';
    delete process.env[FLAG_KEY];
    await assert.rejects(() => originalConnect(), /ArkShop MySQL variables are incomplete/);

    const preloadPath = require.resolve('../src/sentinel/arkshop-mysql-only-preload.cjs');
    delete require.cache[preloadPath];
    process.env[MODE_KEY] = 'disabled';
    require(preloadPath);
    assert.equal(process.env[MODE_KEY], 'disabled');
  } finally {
    mysql.connectMysql = originalConnect;
    restoreEnv(saved);
  }
});
