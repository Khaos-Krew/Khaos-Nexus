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
  link(discordUserId, economicIdentityId = `econ_${discordUserId}`, { verified = true } = {}) {
    this.links.set(`discord:${discordUserId}`, {
      economic_identity_id: economicIdentityId,
      status: verified ? 'verified' : 'restricted',
      verified_at: verified ? '2026-09-12T00:00:00.000Z' : null
    });
    return economicIdentityId;
  }
  async getIdentityByLink(provider, externalId) { return this.links.get(`${provider}:${externalId}`) || null; }
  async getWalletByDiscord(discordUserId, currency) {
    const identity = this.links.get(`discord:${discordUserId}`);
    if (!identity || identity.status !== 'verified') return null;
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

function fixture() {
  const repository = new MemoryRepo();
  for (const id of ['111', '222', '333', '444']) repository.link(id);
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-10T23:30:00Z') });
  return { repository, wallet };
}

test('credit is idempotent and returns the original balance', async () => {
  const { wallet, repository } = fixture();
  const first = await wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'cache_abc' });
  const second = await wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'cache_abc' });
  assert.equal(first.balance, 100);
  assert.equal(first.currency, 'NEXUS_POINTS');
  assert.equal(second.duplicate, true);
  assert.equal(second.balance, 100);
  assert.equal(repository.ledger.size, 1);
});

test('spend is idempotent and cannot double debit an order', async () => {
  const { wallet, repository } = fixture();
  await wallet.credit({ discordUserId: '222', amount: 80, idempotencyKey: 'seed_222' });
  const first = await wallet.spend({ discordUserId: '222', amount: 25, orderId: 'ORDER_1' });
  const second = await wallet.spend({ discordUserId: '222', amount: 25, orderId: 'ORDER_1' });
  assert.equal(first.balance, 55);
  assert.equal(second.duplicate, true);
  assert.equal(second.balance, 55);
  assert.equal(await wallet.balance('222'), 55);
  assert.equal(repository.ledger.size, 2);
});

test('insufficient funds fails closed without recording a debit', async () => {
  const { wallet, repository } = fixture();
  const result = await wallet.spend({ discordUserId: '333', amount: 10, orderId: 'ORDER_2' });
  assert.deepEqual(result, { ok: false, reason: 'insufficient-funds', currency: 'NEXUS_POINTS', balance: 0 });
  assert.equal(repository.ledger.size, 0);
  assert.equal(await wallet.balance('333'), 0);
});

test('one economic identity owns separate currency wallets', async () => {
  const { wallet, repository } = fixture();
  await wallet.credit({ discordUserId: '111', amount: 20, idempotencyKey: 'points', currency: 'Nexus Points' });
  await wallet.credit({ discordUserId: '111', amount: 7, idempotencyKey: 'coins', currency: 'Nexus Coins' });
  await wallet.credit({ discordUserId: '111', amount: 5, idempotencyKey: 'cache', currency: 'Dino Cache Tokens' });
  assert.deepEqual(await wallet.balances('111'), {
    NEXUS_COINS: 7,
    NEXUS_POINTS: 20,
    DINO_CACHE_TOKENS: 5
  });
  assert.equal(repository.wallets.size, 3);
});

test('Dino Cache grant supports quantities greater than one as one ledger credit', async () => {
  const { wallet, repository } = fixture();
  const result = await wallet.credit({
    discordUserId: '111',
    amount: 12,
    idempotencyKey: 'cache_grant_12',
    currency: 'DINO_CACHE_TOKENS',
    source: 'admin-cachetoken',
    type: 'admin-grant'
  });
  assert.equal(result.balance, 12);
  assert.equal(result.currency, 'DINO_CACHE_TOKENS');
  assert.equal(repository.ledger.size, 1);
});

test('unverified or unlinked Discord identities cannot create spendable wallets', async () => {
  const { wallet, repository } = fixture();
  repository.link('999', 'econ_999', { verified: false });
  await assert.rejects(wallet.credit({ discordUserId: '999', amount: 1, idempotencyKey: 'blocked' }), /Verified economic identity/);
  await assert.rejects(wallet.credit({ discordUserId: '888', amount: 1, idempotencyKey: 'blocked2' }), /Verified economic identity/);
  assert.equal(repository.wallets.has('econ_999:NEXUS_POINTS'), false);
});

test('invalid identifiers and non-whole amounts are rejected before persistence', async () => {
  const { wallet, repository } = fixture();
  await assert.rejects(wallet.credit({ discordUserId: 'bad id', amount: 1, idempotencyKey: 'x' }), /invalid/);
  await assert.rejects(wallet.credit({ discordUserId: '444', amount: 1.5, idempotencyKey: 'x' }), /positive whole number/);
  await assert.rejects(wallet.spend({ discordUserId: '444', amount: 1, orderId: '' }), /invalid/);
  assert.equal(repository.ledger.size, 0);
});

test('idempotency keys cannot cross identities, currencies, or amounts', async () => {
  const { wallet, repository } = fixture();
  await wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'grant' });
  await assert.rejects(wallet.credit({ discordUserId: '222', amount: 100, idempotencyKey: 'grant' }), /different wallet mutation/);
  await assert.rejects(wallet.credit({ discordUserId: '111', amount: 200, idempotencyKey: 'grant' }), /different wallet mutation/);
  await assert.rejects(wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'grant', currency: 'Nexus Coins' }), /different wallet mutation/);
  await wallet.spend({ discordUserId: '111', amount: 5, orderId: 'order' });
  await assert.rejects(wallet.spend({ discordUserId: '111', amount: 10, orderId: 'order' }), /different wallet mutation/);
  await assert.rejects(wallet.spend({ discordUserId: '222', amount: 5, orderId: 'order' }), /different wallet mutation/);
  assert.equal(repository.ledger.size, 2);
  assert.equal(await wallet.balance('111'), 95);
  assert.equal(await wallet.balance('222'), 0);
});

test('malformed amounts and balance overflow fail before ledger mutation', async () => {
  const { wallet, repository } = fixture();
  for (const amount of [true, [1], {}, '1e2', ' 1 ', '0x10', Infinity, NaN, -1, 0]) {
    await assert.rejects(wallet.credit({ discordUserId: '111', amount, idempotencyKey: 'bad' }), /positive whole number/);
  }
  await wallet.credit({ discordUserId: '111', amount: Number.MAX_SAFE_INTEGER, idempotencyKey: 'max' });
  await assert.rejects(wallet.credit({ discordUserId: '111', amount: 1, idempotencyKey: 'overflow' }), /supported range/);
  assert.equal(repository.ledger.size, 1);
});

test('caller metadata cannot replace the ledger order correlation', async () => {
  const { wallet, repository } = fixture();
  await wallet.credit({ discordUserId: '111', amount: 10, idempotencyKey: 'seed' });
  await wallet.spend({ discordUserId: '111', amount: 5, orderId: 'real', metadata: { orderId: 'spoofed' } });
  assert.equal(repository.ledger.get('purchase_real').metadata.orderId, 'real');
});

test('unsupported currencies fail closed before a wallet mutation', async () => {
  const { wallet, repository } = fixture();
  for (const currency of ['NP', 'ARK_POINTS', '', 'USD']) {
    await assert.rejects(wallet.credit({ discordUserId: '111', amount: 5, idempotencyKey: 'seed', currency }), /Unsupported Nexus economy currency/);
  }
  assert.equal(repository.ledger.size, 0);
});
