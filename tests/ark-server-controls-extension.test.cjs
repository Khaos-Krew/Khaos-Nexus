'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  arkServerCommand,
  configuredPrefixes,
  safeError,
  formatMysqlResult
} = require('../src/sentinel/ark-server-controls-extension.cjs');

test('arkserver exposes status, save, restart and mysql-sync controls', () => {
  const command = arkServerCommand().toJSON();
  assert.equal(command.name, 'arkserver');
  const names = command.options.map((option) => option.name);
  assert.deepEqual(names, ['status', 'save', 'restart', 'mysql-sync']);
  const restart = command.options.find((option) => option.name === 'restart');
  const mysql = command.options.find((option) => option.name === 'mysql-sync');
  assert.equal(restart.options[0].name, 'confirm');
  assert.equal(restart.options[0].required, true);
  assert.equal(mysql.options[0].name, 'confirm');
  assert.equal(mysql.options[0].required, true);
});

test('configuredPrefixes uses every enabled ArkShop server and removes duplicates', () => {
  const registry = {
    list: () => [
      { enabled: true, shopEnabled: true, envPrefix: 'ARK_GEN1' },
      { enabled: true, shopEnabled: true, envPrefix: 'ARK_MAP2' },
      { enabled: true, shopEnabled: true, envPrefix: 'ARK_MAP2' },
      { enabled: true, shopEnabled: false, envPrefix: 'ARK_DISABLED_SHOP' }
    ]
  };
  assert.deepEqual(configuredPrefixes(registry), ['ARK_GEN1', 'ARK_MAP2']);
});

test('configuredPrefixes safely falls back to ARK_GEN1 for an empty registry', () => {
  assert.deepEqual(configuredPrefixes({ list: () => [] }), ['ARK_GEN1']);
});

test('safeError redacts protected connection values', () => {
  const before = {
    password: process.env.ARKSHOP_DB_PASSWORD,
    host: process.env.ARKSHOP_DB_HOST,
    user: process.env.ARKSHOP_DB_USER
  };
  process.env.ARKSHOP_DB_PASSWORD = 'super-secret-password';
  process.env.ARKSHOP_DB_HOST = 'private-db-host';
  process.env.ARKSHOP_DB_USER = 'private-db-user';
  try {
    const text = safeError(new Error('failed private-db-user@private-db-host with super-secret-password'));
    assert.equal(text.includes('super-secret-password'), false);
    assert.equal(text.includes('private-db-host'), false);
    assert.equal(text.includes('private-db-user'), false);
    assert.match(text, /\[redacted\]/);
  } finally {
    if (before.password === undefined) delete process.env.ARKSHOP_DB_PASSWORD; else process.env.ARKSHOP_DB_PASSWORD = before.password;
    if (before.host === undefined) delete process.env.ARKSHOP_DB_HOST; else process.env.ARKSHOP_DB_HOST = before.host;
    if (before.user === undefined) delete process.env.ARKSHOP_DB_USER; else process.env.ARKSHOP_DB_USER = before.user;
  }
});

test('successful MySQL sync output explicitly states no game restart occurred', () => {
  const text = formatMysqlResult({
    ok: true,
    prefixes: ['ARK_GEN1'],
    writes: [{ ok: true, changed: true, backupCreated: true }],
    audit: { ok: true, mode: 'shared-mysql-ready' },
    reloads: [{ ok: true }]
  });
  assert.match(text, /shared MySQL verified/i);
  assert.match(text, /No ARK server restart was performed/i);
});
