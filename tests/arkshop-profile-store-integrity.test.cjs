'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkShopProfileStore } = require('../src/sentinel/arkshop-profiles.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-integrity-'));
}

function fileFor(root) {
  return path.join(root, 'data', 'arkshop-profiles.json');
}

test('missing ArkShop profile state initializes logically empty without creating a file', () => {
  const root = tempRoot();
  const store = new ArkShopProfileStore(root);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.health(), { ok: true, profileCount: 0, version: 1 });
  assert.equal(fs.existsSync(fileFor(root)), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed existing ArkShop profile state fails closed and is never overwritten as empty', () => {
  const root = tempRoot();
  fs.mkdirSync(path.dirname(fileFor(root)), { recursive: true });
  const corrupt = '{"version":1,"profiles":';
  fs.writeFileSync(fileFor(root), corrupt);
  const store = new ArkShopProfileStore(root);
  assert.throws(() => store.list(), /unreadable or malformed/i);
  assert.throws(() => store.create({ id: 'replacement', data: {} }), /unreadable or malformed/i);
  assert.equal(fs.readFileSync(fileFor(root), 'utf8'), corrupt);
  assert.deepEqual(store.health(), { ok: false, profileCount: 0, version: 1 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('invalid persisted profile records fail closed instead of being silently deleted', () => {
  const root = tempRoot();
  fs.mkdirSync(path.dirname(fileFor(root)), { recursive: true });
  const state = {
    version: 1,
    profiles: {
      'arkshop-live': { id: 'arkshop-live', name: 'Live', revision: 1, data: {} },
      broken: 'not-an-object'
    }
  };
  fs.writeFileSync(fileFor(root), JSON.stringify(state));
  const store = new ArkShopProfileStore(root);
  assert.throws(() => store.get('arkshop-live'), /integrity validation/i);
  assert.equal(store.health().ok, false);
  assert.match(fs.readFileSync(fileFor(root), 'utf8'), /not-an-object/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('non-canonical persisted ids fail closed to prevent alias collisions', () => {
  const root = tempRoot();
  fs.mkdirSync(path.dirname(fileFor(root)), { recursive: true });
  fs.writeFileSync(fileFor(root), JSON.stringify({
    version: 1,
    profiles: {
      'ARKSHOP LIVE': { id: 'ARKSHOP LIVE', name: 'Unsafe Alias', revision: 1, data: {} }
    }
  }));
  const store = new ArkShopProfileStore(root);
  assert.throws(() => store.read(), /integrity validation/i);
  assert.equal(store.health().ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop profile health is bounded and does not expose corrupt payloads or paths', () => {
  const root = tempRoot();
  fs.mkdirSync(path.dirname(fileFor(root)), { recursive: true });
  fs.writeFileSync(fileFor(root), '{SUPER-SECRET malformed');
  const store = new ArkShopProfileStore(root);
  const health = store.health();
  const serialized = JSON.stringify(health);
  assert.equal(health.ok, false);
  assert.equal(serialized.includes('SUPER-SECRET'), false);
  assert.equal(serialized.includes(root), false);
  assert.deepEqual(Object.keys(health).sort(), ['ok', 'profileCount', 'version']);
  fs.rmSync(root, { recursive: true, force: true });
});
