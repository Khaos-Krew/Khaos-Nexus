'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  STORE_VERSION,
  ArkShopApplyStore,
  applyArkShopProfile
} = require('../src/sentinel/arkshop-profile-service.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-apply-store-')); }
function writeStore(store, value) {
  fs.mkdirSync(store.dir, { recursive: true });
  fs.writeFileSync(store.file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function sampleTransaction(id = 'tx-1') {
  return {
    id,
    serverId: 'gen1',
    envPrefix: 'ARK_GEN1',
    profileId: 'arkshop-live',
    profileRevision: 1,
    status: 'applied',
    backup: 'backup.json',
    rolledBackAt: ''
  };
}

test('ArkShop apply store treats only a missing file as empty history', () => {
  const root = tempRoot();
  const store = new ArkShopApplyStore(root);
  assert.deepEqual(store.read(), { version: STORE_VERSION, transactions: [] });
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed existing ArkShop apply history fails closed and is preserved', () => {
  const root = tempRoot();
  const store = new ArkShopApplyStore(root);
  writeStore(store, '{ definitely-not-json');
  const before = fs.readFileSync(store.file, 'utf8');

  assert.throws(() => store.read(), /invalid JSON/i);
  assert.throws(() => store.add(sampleTransaction('new-tx')), /invalid JSON/i);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  assert.deepEqual(store.health(), { ok: false, transactionCount: 0, version: STORE_VERSION });

  fs.rmSync(root, { recursive: true, force: true });
});

test('unsupported ArkShop apply history versions fail closed instead of being rewritten', () => {
  const root = tempRoot();
  const store = new ArkShopApplyStore(root);
  writeStore(store, { version: 99, transactions: [sampleTransaction()] });
  const before = fs.readFileSync(store.file, 'utf8');

  assert.throws(() => store.read(), /unsupported store version/i);
  assert.throws(() => store.add(sampleTransaction('tx-2')), /unsupported store version/i);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);

  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicate ArkShop apply transaction ids fail closed', () => {
  const root = tempRoot();
  const store = new ArkShopApplyStore(root);
  writeStore(store, { version: STORE_VERSION, transactions: [sampleTransaction('dup'), sampleTransaction('dup')] });
  assert.throws(() => store.read(), /duplicate transaction ids/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop apply preflight blocks writer and reload when apply history is corrupt', async () => {
  const root = tempRoot();
  const store = new ArkShopApplyStore(root);
  writeStore(store, '{ corrupt-journal');

  let writerCalled = false;
  let reloaderCalled = false;
  const server = { id: 'gen1', envPrefix: 'ARK_GEN1' };
  const profile = {
    id: 'arkshop-live',
    revision: 1,
    data: {
      General: {},
      managedSections: ['Kits'],
      Kits: { starter: { DefaultAmount: 1, Price: 0 } }
    }
  };
  const current = { General: {}, Kits: {} };

  await assert.rejects(
    applyArkShopProfile({
      server,
      profile,
      applyStore: store,
      reader: async () => ({ text: JSON.stringify(current), remoteFile: 'config.json' }),
      writer: async () => {
        writerCalled = true;
        return { changed: true, backup: 'backup.json', remoteFile: 'config.json' };
      },
      reloader: async () => {
        reloaderCalled = true;
        return { response: 'ok' };
      }
    }),
    /invalid JSON/i
  );

  assert.equal(writerCalled, false);
  assert.equal(reloaderCalled, false);
  fs.rmSync(root, { recursive: true, force: true });
});
