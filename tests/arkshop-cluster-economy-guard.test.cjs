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
      ...overrides
    }
  };
}

test('database fingerprint compares connection identity without exposing values', () => {
  const config = mysqlConfig();
  assert.equal(mysqlEnabled(config), true);
  const fingerprint = databaseFingerprint(config);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes('db.internal'), false);
  assert.equal(fingerprint, databaseFingerprint(mysqlConfig()));
  assert.notEqual(fingerprint, databaseFingerprint(mysqlConfig({ MysqlDB: 'other' })));
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

test('cluster database guard fails closed for local SQLite or mismatched MySQL', () => {
  const fp = databaseFingerprint(mysqlConfig());
  const other = databaseFingerprint(mysqlConfig({ MysqlDB: 'other' }));
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
  assert.equal(JSON.stringify(result).includes('db.internal'), false);
  assert.equal(JSON.stringify(result).includes('arkshop'), false);
});
