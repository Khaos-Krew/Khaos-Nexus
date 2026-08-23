'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../src/backend/core/account-store.cjs');
const { assertLoopbackRedirect } = require('../src/desktop/discord-account-link.cjs');

function temporaryStore(now = () => Date.now()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-accounts-'));
  return { root, store: new AccountStore({ filePath: path.join(root, 'accounts.json'), now }) };
}

test('first pairing code creates exactly one Owner and later codes create Co-Owners', () => {
  const { root, store } = temporaryStore();
  try {
    const ownerCode = store.createPairingCode('owner');
    const owner = store.redeemPairingCode(ownerCode.code, { id: '123456789012345678', username: 'owner', globalName: 'Owner' });
    assert.equal(owner.role, 'owner');
    assert.equal(store.findByDiscordId('123456789012345678').id, owner.id);
    assert.throws(() => store.createPairingCode('owner'), /already exists/i);

    const coOwnerCode = store.createPairingCode('co-owner');
    const coOwner = store.redeemPairingCode(coOwnerCode.code, { id: '223456789012345678', username: 'coowner', globalName: 'Co Owner' });
    assert.equal(coOwner.role, 'co-owner');
    assert.equal(store.list().length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pairing codes expire, are one-time, and are stored hashed', () => {
  let clock = 1_000_000;
  const { root, store } = temporaryStore(() => clock);
  try {
    const pairing = store.createPairingCode('owner', 60_000);
    const rawState = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8');
    assert.equal(rawState.includes(pairing.code), false);
    store.redeemPairingCode(pairing.code, { id: '323456789012345678', username: 'one' });
    assert.throws(() => store.redeemPairingCode(pairing.code, { id: '423456789012345678', username: 'two' }), /invalid or expired/i);

    const next = store.createPairingCode('co-owner', 60_000);
    clock += 60_001;
    assert.throws(() => store.redeemPairingCode(next.code, { id: '523456789012345678', username: 'late' }), /invalid or expired/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('primary Owner cannot be removed while Co-Owner can be removed', () => {
  const { root, store } = temporaryStore();
  try {
    const owner = store.redeemPairingCode(store.createPairingCode('owner').code, { id: '623456789012345678', username: 'owner' });
    const coOwner = store.redeemPairingCode(store.createPairingCode('co-owner').code, { id: '723456789012345678', username: 'co' });
    assert.throws(() => store.remove(owner.id), /primary Owner/i);
    assert.equal(store.remove(coOwner.id), true);
    assert.equal(store.list().length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Discord OAuth redirect is restricted to fixed loopback HTTP addresses', () => {
  assert.equal(assertLoopbackRedirect('http://127.0.0.1:53117/callback').pathname, '/callback');
  assert.throws(() => assertLoopbackRedirect('https://example.com/callback'), /loopback/i);
  assert.throws(() => assertLoopbackRedirect('http://127.0.0.1/callback'), /fixed loopback port/i);
});

test('desktop and Sentinal expose both account-link paths', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'accounts-ui.js'), 'utf8');
  const sentinal = fs.readFileSync(path.join(__dirname, '..', 'src', 'sentinel', 'bot.cjs'), 'utf8');
  assert.match(main, /nexus:link-discord-oauth/);
  assert.match(preload, /createAccountLinkCode/);
  assert.match(ui, /Accounts & Access/);
  assert.match(sentinal, /setName\('link'\)/);
  assert.match(sentinal, /backend\.linkAccount/);
  assert.match(sentinal, /accountByDiscord/);
});
