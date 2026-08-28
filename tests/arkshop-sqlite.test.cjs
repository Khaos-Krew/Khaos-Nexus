'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  sqliteStatusFromFile,
  sqliteSchemaFromFile,
  lookupPlayerFromFile,
  normalizeSqliteValue
} = require('../src/sentinel/arkshop-sqlite.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-sqlite-test-'));
  const file = path.join(root, 'ArkShop.db');
  const database = new DatabaseSync(file);
  database.exec("CREATE TABLE Players (Id INTEGER PRIMARY KEY AUTOINCREMENT, EosId TEXT NOT NULL UNIQUE, Kits TEXT DEFAULT '{}', Points INTEGER DEFAULT 0, TotalSpent INTEGER DEFAULT 0)");
  database.prepare('INSERT INTO Players (EosId, Kits, Points, TotalSpent) VALUES (?, ?, ?, ?)')
    .run('0002aabbccddeeff0011223344556677', '{"starter":1}', 250, 40);
  database.close();
  return { root, file, config: { table: 'Players', remoteFile: '/server/ArkShop.db' } };
}

test('SQLite status validates the snapshot and detects the ArkShop player table', () => {
  const item = fixture();
  try {
    const status = sqliteStatusFromFile(item.file, item.config);
    assert.equal(status.backend, 'sqlite');
    assert.equal(status.connected, true);
    assert.equal(status.tableExists, true);
    assert.equal(status.database, '/server/ArkShop.db');
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('SQLite schema and player lookup preserve EOS IDs and integer values safely', () => {
  const item = fixture();
  try {
    const schema = sqliteSchemaFromFile(item.file, item.config);
    assert.ok(schema.columns.some((column) => column.COLUMN_NAME === 'EosId'));
    const result = lookupPlayerFromFile(item.file, '0002aabbccddeeff0011223344556677', item.config);
    assert.equal(result.player.EosId, '0002aabbccddeeff0011223344556677');
    assert.equal(result.player.Points, '250');
    assert.equal(result.idColumn, 'EosId');
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('SQLite values are normalized for safe JSON and Discord rendering', () => {
  assert.equal(normalizeSqliteValue(9007199254740993n), '9007199254740993');
  assert.equal(normalizeSqliteValue(Buffer.from('abc')), '<blob:3>');
  assert.equal(normalizeSqliteValue('plain'), 'plain');
});
