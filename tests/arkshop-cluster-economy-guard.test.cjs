'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mysqlEnabled, databaseFingerprint, evaluateClusterDatabase, auditArkShopClusterDatabase
} = require('../src/sentinel/arkshop-cluster-economy-guard.cjs');

function mysqlConfig(overrides = {}) {
  return {
    Mysql: {
      UseMysql: true,
      MysqlHost: 'db.internal',
      MysqlPort: 3306,
      MysqlDB: 'arkshop',
      MysqlUser: 'shop',
      MysqlPlayersTable: 'ArkShopPlayers',
      ...overrides
    }
  };
}

test('database fingerprint compares deployed connection identity without exposing values', () => {
  const config = mysqlConfig();
  assert.equal(mysqlEnabled(config), true);
  assert.equal(mysqlEnabled(mysqlConfig({ UseMysql: 'true' })), true);
  assert.equal(mysqlEnabled(mysqlConfig({ UseMysql: false })), false);
  const fingerprint = databaseFingerprint(config);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes('db.internal'), false);
  assert.equal(fingerprint, databaseFingerprint(mysqlConfig()));
  assert.notEqual(fingerprint, databaseFingerprint(mysqlConfig({ MysqlDB: 'other' })));
  assert.notEqual(fingerprint, databaseFingerprint(mysqlConfig({ MysqlPlayersTable: 'OtherPlayers' })));
});

test('cluster database guard approves one shared MySQL backend', () => {
  const fp = databaseFingerprint(mysqlConfig());
  const result = evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp },
    { id: 'ragnarok', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'shared-cluster-mysql');
  assert.equal(result.servers, 2);
});

test('cluster database guard distinguishes read failures, local SQLite, and mismatched MySQL', () => {
  const fp = databaseFingerprint(mysqlConfig());
  const other = databaseFingerprint(mysqlConfig({ MysqlDB: 'other' }));
  assert.equal(evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: false, fingerprint: '', readFailed: true }
  ]).mode, 'config-read-failed');
  assert.equal(evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp },
    { id: 'ragnarok', enabled: true, shopEnabled: true, mysqlEnabled: false, fingerprint: '' }
  ]).mode, 'non-shared-database');
  assert.equal(evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp },
    { id: 'ragnarok', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: other }
  ]).mode, 'database-mismatch');
});

test('audit reads every enabled shop server and returns only safe connection fingerprints', async () => {
  const servers = [
    { id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true, shopEnabled: true },
    { id: 'rag', envPrefix: 'ARK_RAG', enabled: true, shopEnabled: true }
  ];
  const registry = { list: () => servers };
  const reader = async () => ({ text: JSON.stringify(mysqlConfig()) });
  const result = await auditArkShopClusterDatabase({ registry, reader });
  assert.equal(result.ok, true);
  assert.equal(result.servers, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].useMysqlType, 'boolean');
  assert.equal(JSON.stringify(result).includes('db.internal'), false);
  assert.equal(JSON.stringify(result).includes('arkshop'), false);
  assert.equal(JSON.stringify(result).includes('ArkShopPlayers'), false);
});

test('audit reports a live-config transport failure separately from MySQL disabled', async () => {
  const registry = { list: () => [{ id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true, shopEnabled: true }] };
  const result = await auditArkShopClusterDatabase({ registry, reader: async () => { throw new Error('SFTP timeout'); } });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'config-read-failed');
  assert.equal(result.records[0].readFailed, true);
});
