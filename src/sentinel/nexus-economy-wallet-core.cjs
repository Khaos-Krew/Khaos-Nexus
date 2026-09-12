'use strict';

const { createNexusEconomyPurchaseActionRequest } = require('./nexus-economy-purchase-action-request.cjs');

function cleanId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function positiveWhole(value, label = 'Amount') {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole number.`);
  return amount;
}

function priorResult(prior, { discordUserId, amount, type, source }) {
  if (prior.discordUserId !== discordUserId || prior.amount !== amount || prior.type !== type || prior.source !== source) {
    throw new Error('Idempotency key is already bound to a different wallet mutation.');
  }
  return { ok: true, duplicate: true, balance: Number(prior.balanceAfter), transactionId: prior.id };
}

function accountBalance(account) {
  const balance = Number(account?.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Wallet balance is invalid.');
  return balance;
}

class NexusEconomyWalletCore {
  constructor({ repository, now = () => new Date() } = {}) {
    if (!repository || typeof repository.transact !== 'function') throw new Error('Economy repository with transact() is required.');
    this.repository = repository;
    this.now = now;
  }

  async balance(discordUserId) {
    const id = cleanId(discordUserId, 'Discord user ID');
    const account = await this.repository.getAccount(id);
    return account ? accountBalance(account) : 0;
  }

  async credit({ discordUserId, amount, idempotencyKey, source = 'nexus', type = 'credit', currency = 'Nexus Points', metadata = {} } = {}) {
    if (currency !== 'Nexus Points') throw new Error('This account only supports Nexus Points.');
    const id = cleanId(discordUserId, 'Discord user ID');
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    return this.repository.transact(id, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) return priorResult(prior, { discordUserId: id, amount: value, type, source });
      const account = await tx.getOrCreateAccount(id);
      const balance = accountBalance(account) + value;
      if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range.');
      const entry = await tx.appendLedger({ discordUserId: id, amount: value, balanceAfter: balance, type, source, idempotencyKey: key, metadata: { ...metadata, currency }, at: this.now().toISOString() });
      await tx.setBalance(id, balance);
      return { ok: true, duplicate: false, balance, transactionId: entry?.id || null };
    });
  }

  async spend({ discordUserId, amount, orderId, source = 'cluster-shop', currency = 'Nexus Points', metadata = {} } = {}) {
    if (currency !== 'Nexus Points') throw new Error('This account only supports Nexus Points.');
    const id = cleanId(discordUserId, 'Discord user ID');
    const value = positiveWhole(amount);
    const order = cleanId(orderId, 'Order ID');
    const key = `purchase_${order}`;
    return this.repository.transact(id, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) return priorResult(prior, { discordUserId: id, amount: -value, type: 'purchase', source });
      const account = await tx.getOrCreateAccount(id);
      const current = accountBalance(account);
      if (current < value) return { ok: false, reason: 'insufficient-funds', balance: current };
      const balance = current - value;
      const entry = await tx.appendLedger({ discordUserId: id, amount: -value, balanceAfter: balance, type: 'purchase', source, idempotencyKey: key, metadata: { ...metadata, orderId: order, currency }, at: this.now().toISOString() });
      await tx.setBalance(id, balance);
      return { ok: true, duplicate: false, balance, transactionId: entry?.id || null };
    });
  }

  async commitPurchase({ record, eosId, quote, validateQuote } = {}) {
    record = structuredClone(record);
    quote = structuredClone(quote);
    const projection = createNexusEconomyPurchaseActionRequest().prepare(record);
    if (!projection.ok) throw new Error(`Purchase record rejected: ${projection.reason}`);
    const eos = cleanId(eosId, 'EOS ID');
    if (typeof validateQuote !== 'function') throw new Error('Current quote validation is required.');
    const { discordUserId, totalPrice, projectedBalance } = record.payload;
    return this.repository.transact(discordUserId, async (tx) => {
      const prior = await tx.findOrder(record.orderId);
      if (prior) {
        if (prior.recordDigest !== record.recordDigest || prior.discordUserId !== discordUserId || prior.eosId !== eos) {
          throw new Error('Order idempotency key is already bound to another purchase.');
        }
        return { ok: true, duplicate: true, order: prior, balance: prior.balance };
      }
      if (!await tx.findIdentity(discordUserId, eos)) throw new Error('Verified economic identity is required.');
      // Validate inside the transaction, before any debit/order/outbox write.
      await validateQuote(quote, record);
      const account = await tx.getOrCreateAccount(discordUserId);
      const current = accountBalance(account);
      if (current < totalPrice) return { ok: false, reason: 'insufficient-funds', balance: current };
      const balance = current - totalPrice;
      if (balance !== projectedBalance) throw new Error('Purchase balance changed; prepare a fresh quote.');
      const key = `purchase_${record.orderId}`;
      if (await tx.findLedgerByKey(key)) throw new Error('Purchase debit exists without its atomic order.');
      const at = this.now().toISOString();
      const entry = await tx.appendLedger({
        discordUserId, amount: -totalPrice, balanceAfter: balance,
        type: 'purchase', source: 'cluster-shop', idempotencyKey: key,
        metadata: { orderId: record.orderId, requestId: record.requestId, currency: record.payload.currency }, at
      });
      await tx.setBalance(discordUserId, balance);
      const order = {
        orderId: record.orderId, requestId: record.requestId, discordUserId, eosId: eos,
        type: 'BUY', status: 'PAID_QUEUED', recordDigest: record.recordDigest,
        transactionId: entry.id, balance, quote, createdAt: at, updatedAt: at
      };
      await tx.appendOrder(order);
      await tx.appendOutbox(record);
      return { ok: true, duplicate: false, order, balance };
    });
  }
}

module.exports = { NexusEconomyWalletCore, positiveWhole };
