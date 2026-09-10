'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');

class MemoryRepo {
  constructor() { this.accounts = new Map(); this.ledger = new Map(); this.nextId = 1; }
  async getAccount(id) { return this.accounts.get(id) || null; }
  async transact(_id, fn) {
    const tx = {
      findLedgerByKey: async (key) => this.ledger.get(key) || null,
      getOrCreateAccount: async (id) => {
        if (!this.accounts.has(id)) this.accounts.set(id, { discordUserId: id, balance: 0 });
        return this.accounts.get(id);
      },
      appendLedger: async (entry) => {
        const saved = { id: `tx-${this.nextId++}`, ...entry };
        this.ledger.set(entry.idempotencyKey, saved);
        return saved;
      },
      setBalance: async (id, balance) => { this.accounts.set(id, { ...(this.accounts.get(id) || {}), discordUserId: id, balance }); }
    };
    return fn(tx);
  }
}

function fixture() {
  const repository = new MemoryRepo();
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-10T23:30:00Z') });
  return { repository, wallet };
}

test('credit is idempotent and returns the original balance', async () => {
  const { wallet, repository } = fixture();
  const first = await wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'cache_abc' });
  const second = await wallet.credit({ discordUserId: '111', amount: 100, idempotencyKey: 'cache_abc' });
  assert.equal(first.balance, 100);
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
  assert.deepEqual(result, { ok: false, reason: 'insufficient-funds', balance: 0 });
  assert.equal(repository.ledger.size, 0);
  assert.equal(await wallet.balance('333'), 0);
});

test('invalid identifiers and non-whole amounts are rejected before persistence', async () => {
  const { wallet, repository } = fixture();
  await assert.rejects(wallet.credit({ discordUserId: 'bad id', amount: 1, idempotencyKey: 'x' }), /invalid/);
  await assert.rejects(wallet.credit({ discordUserId: '444', amount: 1.5, idempotencyKey: 'x' }), /positive whole number/);
  await assert.rejects(wallet.spend({ discordUserId: '444', amount: 1, orderId: '' }), /invalid/);
  assert.equal(repository.ledger.size, 0);
});
