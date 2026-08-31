'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { inspectFile } = require('../src/sentinel/ark-dino-cache-sqlite-probe.cjs');

test('SQLite receipt probe inspects schema only and recognizes the required purchase columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cache-probe-'));
  const file = path.join(dir, 'ArkShop.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE Players (Id INTEGER PRIMARY KEY, EosId TEXT); CREATE TABLE ArkShopLogTransactions (Id INTEGER PRIMARY KEY, EosId TEXT, ItemName TEXT, ItemAmount INTEGER, TotalPrice INTEGER, ServersId TEXT)');
  db.prepare('INSERT INTO ArkShopLogTransactions VALUES (1, ?, ?, 1, 800, ?)').run('private-player-id', 'nexus_cache_coastal', 'map-secret');
  db.close();
  try {
    const result = inspectFile(file);
    assert.equal(result.receiptReady, true);
    assert.equal(result.tableCount, 2);
    assert.equal(JSON.stringify(result).includes('private-player-id'), false);
    assert.equal(JSON.stringify(result).includes('nexus_cache_coastal'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
