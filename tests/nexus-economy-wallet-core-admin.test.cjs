'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');

class MemoryRepo {
  constructor() {
    this.links = new Map();
    this.wallets = new Map();
    this.ledger = new Map();
    this.nextId = 1;
  }
  link(discordUserId, economicIdentityId = `econ_${discordUserId}`, { status = 'verified' } = {}) {
    this.links.set(`discord:${discordUserId}`, {
      economic_identity_id: economicIdentityId,
      status,
      verified_at: status === 'verified' ? '2026-09-12T00:00:00.000Z' : null
    });
    return economicIdentityId;
  }
  async getIdentityByLink(provider, externalId) { return this.links.get(`${provider}:${externalId}`) || null; }
  async getWalletByDiscord(discordUserId, currency) {
    const identity = this.links.get(`discord:${discordUserId}`);
    if (!identity || (identity.status !== 'verified' && identity.status !== 'restricted')) return null;
    return this.wallets.get(`${identity.economic_identity_id}:${currency}`) || null;
  }
  async transact(economicIdentityId, currency, fn) {
    const walletKey = `${economicIdentityId}:${currency}`;
    const tx = {
      findLedgerByKey: async (key) => this.ledger.get(key) || null,
      getOrCreateWallet: async () => {
        if (!this.wallets.has(walletKey)) this.wallets.set(walletKey, { economic_identity_id: economicIdentityId, currency, balance: 0 });
        return this.wallets.get(walletKey);
      },
      appendLedger: async (entry) => {
        const saved = { id: `tx-${this.nextId++}`, ...entry };
        this.ledger.set(entry.idempotencyKey, saved);
        return saved;
      },
      setBalance: async (_identityId, _currency, balance) => {
        this.wallets.set(walletKey, { economic_identity_id: economicIdentityId, currency, balance });
      }
    };
    return fn(tx);
  }
}

test('adminCredit allows restricted Shadow Recruit wallets', async () => {
  const repository = new MemoryRepo();
  repository.link('777', 'econ_777', { status: 'restricted' });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  await assert.rejects(
    wallet.credit({ discordUserId: '777', amount: 1, idempotencyKey: 'normal' }),
    /Verified economic identity/
  );
  const result = await wallet.adminCredit({
    discordUserId: '777',
    amount: 10,
    idempotencyKey: 'admin_add_1',
    currency: 'NEXUS_POINTS'
  });
  assert.equal(result.ok, true);
  assert.equal(result.balance, 10);
  assert.equal(repository.ledger.get('admin_add_1').type, 'admin-credit');
  assert.equal(repository.ledger.get('admin_add_1').source, 'discord-guild-owner-adjust');
});

test('adminSpend uses idempotencyKey and type admin-debit', async () => {
  const repository = new MemoryRepo();
  repository.link('888', 'econ_888', { status: 'restricted' });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  await wallet.adminCredit({ discordUserId: '888', amount: 20, idempotencyKey: 'seed', currency: 'NEXUS_COINS' });
  const first = await wallet.adminSpend({
    discordUserId: '888',
    amount: 5,
    idempotencyKey: 'admin_rm_1',
    currency: 'NEXUS_COINS'
  });
  const second = await wallet.adminSpend({
    discordUserId: '888',
    amount: 5,
    idempotencyKey: 'admin_rm_1',
    currency: 'NEXUS_COINS'
  });
  assert.equal(first.balance, 15);
  assert.equal(second.duplicate, true);
  assert.equal(repository.ledger.get('admin_rm_1').type, 'admin-debit');
  assert.equal(repository.ledger.get('admin_rm_1').amount, -5);
});

test('admin adjust fails closed on disabled and quarantine denylist', async () => {
  const repository = new MemoryRepo();
  repository.link('disabled1', 'econ_disabled', { status: 'disabled' });
  repository.link('deny1', 'econ_denied', { status: 'restricted' });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  await assert.rejects(
    wallet.adminCredit({ discordUserId: 'disabled1', amount: 1, idempotencyKey: 'd1' }),
    /disabled/
  );
  await assert.rejects(
    wallet.adminCredit({
      discordUserId: 'deny1',
      amount: 1,
      idempotencyKey: 'd2',
      env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_denied,other' }
    }),
    /quarantine-denylisted/
  );
  const overridden = await wallet.adminCredit({
    discordUserId: 'deny1',
    amount: 2,
    idempotencyKey: 'd3',
    allowOverride: true,
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_denied' }
  });
  assert.equal(overridden.balance, 2);
});
