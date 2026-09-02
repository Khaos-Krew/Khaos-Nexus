'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTargetConfig,
  targetRelativePath,
  databaseFingerprint
} = require('../src/sentinel/arkshop-map2-shared-prebind.cjs');

const database = Object.freeze({
  host: 'mysql.internal',
  port: 3306,
  user: 'arkshop',
  password: 'secret',
  name: 'khaos_nexus',
  playersTable: 'ArkShopPlayers',
  logTable: 'ArkShopLogTransactions'
});

test('Astraeos prebind copies catalog while preserving unrelated target config and binding shared MySQL', () => {
  const source = {
    Kits: { starter: { Amount: 1 } },
    ShopItems: {
      metal: { Type: 'item' },
      apoth_love: { Type: 'item' }
    },
    SellItems: { stone: { Price: 1 } }
  };
  const target = {
    General: { ServerName: 'Astraeos' },
    Mysql: { OldField: 'preserved' },
    Kits: { old: {} },
    ShopItems: { old: {} },
    SellItems: { old: {} }
  };

  const next = buildTargetConfig(source, target, database);
  assert.deepEqual(next.Kits, source.Kits);
  assert.deepEqual(next.SellItems, source.SellItems);
  assert.deepEqual(next.ShopItems, { metal: { Type: 'item' } });
  assert.deepEqual(next.General, target.General);
  assert.equal(next.Mysql.OldField, 'preserved');
  assert.equal(next.Mysql.UseMysql, true);
  assert.equal(next.Mysql.MysqlHost, database.host);
  assert.equal(next.Mysql.MysqlPort, database.port);
  assert.equal(next.Mysql.MysqlUser, database.user);
  assert.equal(next.Mysql.MysqlPass, database.password);
  assert.equal(next.Mysql.MysqlDB, database.name);
  assert.equal(next.Mysql.MysqlPlayersTable, database.playersTable);
  assert.equal(next.Mysql.MysqlLogTable, database.logTable);
});

test('Astraeos prebind preserves its existing catalog if Gen1 SFTP is unavailable while still binding shared MySQL', () => {
  const target = {
    Kits: { existingKit: { Amount: 2 } },
    ShopItems: { existingItem: { Type: 'item' } },
    SellItems: { existingSell: { Price: 4 } },
    Mysql: { UseMysql: false, MysqlDB: 'local' }
  };
  const next = buildTargetConfig(null, target, database);
  assert.deepEqual(next.Kits, target.Kits);
  assert.deepEqual(next.ShopItems, target.ShopItems);
  assert.deepEqual(next.SellItems, target.SellItems);
  assert.equal(next.Mysql.UseMysql, true);
  assert.equal(next.Mysql.MysqlDB, database.name);
  assert.equal(next.Mysql.MysqlPlayersTable, database.playersTable);
});

test('Astraeos prebind accepts the live root-level ArkApi config path and rejects traversal', () => {
  const previous = process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH;
  try {
    process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH = 'ArkApi/Plugins/ArkShop/config.json';
    assert.equal(targetRelativePath(), 'ArkApi/Plugins/ArkShop/config.json');
    process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH = '../ArkApi/Plugins/ArkShop/config.json';
    assert.throws(() => targetRelativePath(), /invalid|outside/i);
  } finally {
    if (previous === undefined) delete process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH;
    else process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH = previous;
  }
});

test('database fingerprint is stable and never contains connection values', () => {
  const fingerprint = databaseFingerprint(database);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes(database.host), false);
  assert.equal(fingerprint.includes(database.password), false);
  assert.equal(fingerprint, databaseFingerprint({ ...database }));
});
