'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const {
  COMMUNITY_LEVEL_UP_SOURCE,
  isCommunityLevelCoinGrant,
  routeWalletCredit
} = require('../src/sentinel/nexus-economy-community-level-coins.cjs');

class MemoryRepo {
  constructor() {
    this.links = new Map();
    this.wallets = new Map();
    this.ledger = new Map();
    this.nextId = 1;
    this.ensureCalls = 0;
  }

  link(discordUserId, economicIdentityId = `econ_${discordUserId}`, { status = 'verified', verified = null } = {}) {
    const resolved = verified == null ? status : (verified ? 'verified' : 'restricted');
    this.links.set(`discord:${discordUserId}`, {
      economic_identity_id: economicIdentityId,
      status: resolved,
      verified_at: resolved === 'verified' ? '2026-09-12T00:00:00.000Z' : null
    });
    return economicIdentityId;
  }

  async getIdentityByLink(provider, externalId) {
    return this.links.get(`${provider}:${externalId}`) || null;
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
        const current = this.wallets.get(walletKey) || { economic_identity_id: economicIdentityId, currency };
        this.wallets.set(walletKey, { ...current, balance });
      }
    };
    return fn(tx);
  }
}

function walletFor(repository = new MemoryRepo()) {
  return new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-24T00:00:00Z') });
}

function grantInput(discordUserId, amount, key = `community-level-up:${discordUserId}:9:10`) {
  return {
    discordUserId,
    amount,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    type: 'credit',
    idempotencyKey: key,
    metadata: { reason: COMMUNITY_LEVEL_UP_SOURCE, beforeLevel: 9, afterLevel: 10 }
  };
}

test('community level Coin grants credit Nexus Coins and leave Nexus Points unchanged', async () => {
  const repository = new MemoryRepo();
  repository.link('111');
  const wallet = walletFor(repository);
  await wallet.credit({ discordUserId: '111', amount: 20, idempotencyKey: 'points-seed', currency: 'NEXUS_POINTS' });
  const first = await wallet.grantCommunityLevelCoins(grantInput('111', 50));
  const second = await wallet.grantCommunityLevelCoins(grantInput('111', 50));
  assert.equal(first.ok, true);
  assert.equal(first.currency, 'NEXUS_COINS');
  assert.equal(first.balance, 50);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.balance, 50);
  assert.equal(repository.ledger.size, 2);
  assert.equal(repository.wallets.get('econ_111:NEXUS_COINS').balance, 50);
  assert.equal(repository.wallets.get('econ_111:NEXUS_POINTS').balance, 20);
  const coinEntry = [...repository.ledger.values()].find((entry) => entry.currency === 'NEXUS_COINS');
  assert.equal(coinEntry.source, COMMUNITY_LEVEL_UP_SOURCE);
  assert.equal(coinEntry.type, 'credit');
  assert.equal(coinEntry.metadata.reason, COMMUNITY_LEVEL_UP_SOURCE);
  assert.equal(coinEntry.metadata.adminAdjust, undefined);
});

test('restricted Shadow Recruit wallets can receive level-up Coins and ordinary credit stays verified-only', async () => {
  const repository = new MemoryRepo();
  repository.link('555', 'econ_555', { verified: false });
  const wallet = walletFor(repository);
  const result = await wallet.grantCommunityLevelCoins(grantInput('555', 95, 'community-level-up:555:8:10'));
  assert.equal(result.ok, true);
  assert.equal(result.balance, 95);
  assert.equal(result.currency, 'NEXUS_COINS');
  assert.equal(repository.ensureCalls, 0);
  assert.equal(repository.wallets.has('econ_555:NEXUS_POINTS'), false);
  await assert.rejects(
    wallet.credit({ discordUserId: '555', amount: 1, idempotencyKey: 'points-blocked', currency: 'NEXUS_POINTS' }),
    /Verified economic identity/
  );
  assert.equal(repository.wallets.has('econ_555:NEXUS_POINTS'), false);
});

test('missing wallets are ensured once, and failed ensures soft-fail without a Coin or Point credit', async () => {
  const created = new MemoryRepo();
  created.ensureShadowRecruitWallet = async (discordUserId) => {
    created.ensureCalls += 1;
    created.link(discordUserId, 'econ_new', { verified: false });
    return { ok: true, economicIdentityId: 'econ_new' };
  };
  const createdWallet = walletFor(created);
  const ensured = await createdWallet.grantCommunityLevelCoins(grantInput('777', 10, 'community-level-up:777:1:2'));
  assert.equal(ensured.ok, true);
  assert.equal(ensured.balance, 10);
  assert.equal(created.ensureCalls, 1);
  assert.equal(created.wallets.get('econ_new:NEXUS_COINS').balance, 10);
  assert.equal(created.wallets.has('econ_new:NEXUS_POINTS'), false);

  const rejected = new MemoryRepo();
  rejected.ensureShadowRecruitWallet = async () => {
    rejected.ensureCalls += 1;
    return { ok: false, rejected: 'quarantine-denylist' };
  };
  const rejectedWallet = walletFor(rejected);
  const skipped = await rejectedWallet.grantCommunityLevelCoins(grantInput('888', 10, 'community-level-up:888:1:2'));
  assert.equal(skipped.ok, false);
  assert.equal(skipped.skipped, 'wallet-identity-missing');
  assert.equal(skipped.reason, 'quarantine-denylist');
  assert.equal(rejected.ledger.size, 0);
  assert.equal(rejected.wallets.size, 0);

  const thrown = new MemoryRepo();
  thrown.ensureShadowRecruitWallet = async () => { throw new Error('database unavailable'); };
  const thrownWallet = walletFor(thrown);
  const failed = await thrownWallet.grantCommunityLevelCoins(grantInput('999', 10, 'community-level-up:999:1:2'));
  assert.equal(failed.ok, false);
  assert.equal(failed.skipped, 'wallet-identity-missing');
  assert.equal(thrown.ledger.size, 0);
});

test('disabled, quarantined, and non-coin requests do not mint Nexus Coins', async () => {
  const repository = new MemoryRepo();
  repository.link('321', 'econ_disabled', { status: 'disabled' });
  repository.link('654', 'econ_quarantine', { verified: false });
  const wallet = walletFor(repository);
  const disabled = await wallet.grantCommunityLevelCoins(grantInput('321', 15, 'community-level-up:321:2:3'));
  assert.equal(disabled.ok, false);
  assert.equal(disabled.skipped, 'wallet-identity-disabled');
  const quarantined = await wallet.grantCommunityLevelCoins({
    ...grantInput('654', 15, 'community-level-up:654:2:3'),
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_quarantine' }
  });
  assert.equal(quarantined.ok, false);
  assert.equal(quarantined.reason, 'quarantine-denylist');
  repository.link('111');
  const points = await wallet.grantCommunityLevelCoins({
    ...grantInput('111', 15, 'community-level-up:111:2:3'),
    currency: 'NEXUS_POINTS'
  });
  assert.equal(points.ok, false);
  assert.equal(points.skipped, 'coins-only');
  assert.equal(repository.ledger.size, 0);
  assert.equal(repository.wallets.size, 0);
});

test('wallet credit routing sends community level-ups to Coins and other credits to their own currency', async () => {
  const calls = [];
  const wallet = {
    async grantCommunityLevelCoins(input) {
      calls.push(['coins', input.currency, input.source, input.env.marker]);
      return { ok: true, currency: 'NEXUS_COINS' };
    },
    async credit(input) {
      calls.push(['credit', input.currency, input.source || '']);
      return { ok: true, currency: input.currency };
    }
  };
  assert.equal(isCommunityLevelCoinGrant({ source: COMMUNITY_LEVEL_UP_SOURCE, currency: 'NEXUS_COINS' }), true);
  await routeWalletCredit(wallet, { source: COMMUNITY_LEVEL_UP_SOURCE, currency: 'NEXUS_COINS', amount: 50 }, { marker: 'env' });
  await routeWalletCredit(wallet, { amount: 4, source: 'nexus' });
  await routeWalletCredit(wallet, { amount: 2, currency: 'NEXUS_POINTS', source: 'playtime' });
  assert.deepEqual(calls, [
    ['coins', 'NEXUS_COINS', COMMUNITY_LEVEL_UP_SOURCE, 'env'],
    ['credit', 'NEXUS_POINTS', 'nexus'],
    ['credit', 'NEXUS_POINTS', 'playtime']
  ]);
});

test('legacy single-balance economy worker does not turn level-up Coins into Nexus Points', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-level-coins-'));
  try {
    const worker = new NexusEconomyWorker({ store: new NexusEconomyStore(root), now: () => Date.parse('2026-09-24T00:00:00Z') });
    worker.linkArkIdentity({ discordUserId: '444', eosId: 'EOS_level444', rankId: 'shadow-recruit' });
    const skipped = await worker.credit({
      discordUserId: '444',
      amount: 50,
      currency: 'NEXUS_COINS',
      source: COMMUNITY_LEVEL_UP_SOURCE,
      idempotencyKey: 'community-level-up:444:9:10'
    });
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, 'coins-wallet-unavailable');
    assert.equal(skipped.currency, 'NEXUS_COINS');
    assert.equal(worker.balance('444'), 0);
    await worker.credit({ discordUserId: '444', amount: 3, idempotencyKey: 'points-only' });
    assert.equal(worker.balance('444'), 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
