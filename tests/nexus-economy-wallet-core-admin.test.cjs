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

function trackEnsure(repository, impl) {
  const calls = [];
  repository.ensureShadowRecruitWallet = async (discordUserId, rankId, options) => {
    calls.push({ discordUserId, rankId, env: options?.env });
    return impl(discordUserId, rankId, options);
  };
  return calls;
}

test('adminCredit ensures a Shadow Recruit wallet when the discord identity is missing', async () => {
  const repository = new MemoryRepo();
  const calls = trackEnsure(repository, async (discordUserId) => {
    repository.link(discordUserId, 'econ_new', { status: 'restricted' });
    return { ok: true, economicIdentityId: 'econ_new', status: 'restricted', rankId: 'shadow-recruit' };
  });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const env = { NEXUS_ECONOMY_QUARANTINE_DENYLIST: '' };
  const result = await wallet.adminCredit({
    discordUserId: '555',
    amount: 4,
    idempotencyKey: 'missing_1',
    currency: 'NEXUS_POINTS',
    env
  });
  assert.equal(result.ok, true);
  assert.equal(result.balance, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].discordUserId, '555');
  assert.equal(calls[0].rankId, 'shadow-recruit');
  assert.equal(calls[0].env, env);
  assert.equal(repository.ledger.get('missing_1').metadata.identityStatus, 'restricted');
  assert.equal(repository.ledger.get('missing_1').type, 'admin-credit');

  const replay = await wallet.adminCredit({
    discordUserId: '555',
    amount: 4,
    idempotencyKey: 'missing_1',
    currency: 'NEXUS_POINTS',
    env
  });
  assert.equal(replay.duplicate, true);
  assert.equal(calls.length, 1);
});

test('adminSpend ensures once then reports insufficient funds for an empty baseline wallet', async () => {
  const repository = new MemoryRepo();
  const calls = trackEnsure(repository, async (discordUserId) => {
    repository.link(discordUserId, 'econ_empty', { status: 'restricted' });
    return { ok: true, economicIdentityId: 'econ_empty', status: 'restricted' };
  });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const spent = await wallet.adminSpend({
    discordUserId: '556',
    amount: 1,
    idempotencyKey: 'spend_missing',
    currency: 'NEXUS_COINS'
  });
  assert.equal(spent.ok, false);
  assert.equal(spent.reason, 'insufficient-funds');
  assert.equal(spent.balance, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rankId, 'shadow-recruit');
});

test('admin adjust does not ensure when an identity already exists', async () => {
  const repository = new MemoryRepo();
  repository.link('777', 'econ_777', { status: 'verified' });
  repository.link('disabled1', 'econ_disabled', { status: 'disabled' });
  repository.link('deny1', 'econ_denied', { status: 'restricted' });
  const calls = trackEnsure(repository, async () => {
    throw new Error('ensure must not run for an existing identity');
  });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const credited = await wallet.adminCredit({
    discordUserId: '777',
    amount: 10,
    idempotencyKey: 'existing_1',
    currency: 'NEXUS_POINTS'
  });
  assert.equal(credited.balance, 10);
  await assert.rejects(
    wallet.adminCredit({ discordUserId: 'disabled1', amount: 1, idempotencyKey: 'existing_disabled' }),
    /Economic identity is disabled/
  );
  await assert.rejects(
    wallet.adminCredit({
      discordUserId: 'deny1',
      amount: 1,
      idempotencyKey: 'existing_deny',
      env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_denied' }
    }),
    /quarantine-denylisted/
  );
  const overridden = await wallet.adminCredit({
    discordUserId: 'deny1',
    amount: 2,
    idempotencyKey: 'existing_override',
    allowOverride: true,
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_denied' }
  });
  assert.equal(overridden.balance, 2);
  assert.equal(calls.length, 0);
});

test('adminCredit returns a baseline-wallet failure when ensure is blocked', async () => {
  const repository = new MemoryRepo();
  const calls = trackEnsure(repository, async () => ({ ok: false, rejected: 'quarantine-denylist', economicIdentityId: 'econ_blocked' }));
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const blocked = await wallet.adminCredit({
    discordUserId: '901',
    amount: 3,
    idempotencyKey: 'blocked_1',
    allowOverride: true,
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_blocked' }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'baseline-wallet-unavailable');
  assert.equal(blocked.rejected, 'quarantine-denylist');
  assert.equal(repository.ledger.size, 0);
  assert.equal(calls.length, 1);

  const throwing = new MemoryRepo();
  trackEnsure(throwing, async () => {
    throw new Error('Verified economic identity is required.');
  });
  const thrown = await new NexusEconomyWalletCore({ repository: throwing, now: () => new Date('2026-09-15T00:00:00Z') }).adminCredit({
    discordUserId: '902',
    amount: 1,
    idempotencyKey: 'blocked_throw'
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, 'baseline-wallet-unavailable');
  assert.equal(thrown.rejected, 'ensure-failed');
  assert.equal(throwing.ledger.size, 0);

  const ghost = new MemoryRepo();
  trackEnsure(ghost, async () => ({ ok: true, economicIdentityId: 'econ_ghost', status: 'restricted' }));
  const stillMissing = await new NexusEconomyWalletCore({ repository: ghost, now: () => new Date('2026-09-15T00:00:00Z') }).adminSpend({
    discordUserId: '903',
    amount: 1,
    idempotencyKey: 'blocked_ghost'
  });
  assert.equal(stillMissing.ok, false);
  assert.equal(stillMissing.rejected, 'identity-still-missing');
  assert.doesNotMatch(JSON.stringify(stillMissing), /Verified economic identity is required/);
});

test('missing identity without an ensure hook does not throw the raw identity error', async () => {
  const repository = new MemoryRepo();
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const result = await wallet.adminCredit({
    discordUserId: '904',
    amount: 1,
    idempotencyKey: 'no_ensure'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'baseline-wallet-unavailable');
  assert.equal(result.rejected, 'ensure-unsupported');
});

test('invalid admin adjust input does not ensure a wallet', async () => {
  const repository = new MemoryRepo();
  const calls = trackEnsure(repository, async () => ({ ok: true, economicIdentityId: 'econ_bad' }));
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  await assert.rejects(
    wallet.adminCredit({ discordUserId: '905', amount: 0, idempotencyKey: 'bad_amount' }),
    /positive whole number/
  );
  assert.equal(calls.length, 0);
});
