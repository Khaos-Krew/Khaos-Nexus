'use strict';

function cleanId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function positiveWhole(value, label = 'Amount') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole number.`);
  return amount;
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
    return account ? Number(account.balance) || 0 : 0;
  }

  async credit({ discordUserId, amount, idempotencyKey, source = 'nexus', type = 'credit', metadata = {} } = {}) {
    const id = cleanId(discordUserId, 'Discord user ID');
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    return this.repository.transact(id, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) return { ok: true, duplicate: true, balance: Number(prior.balanceAfter) || 0, transactionId: prior.id || null };
      const account = await tx.getOrCreateAccount(id);
      const balance = (Number(account.balance) || 0) + value;
      const entry = await tx.appendLedger({ discordUserId: id, amount: value, balanceAfter: balance, type, source, idempotencyKey: key, metadata, at: this.now().toISOString() });
      await tx.setBalance(id, balance);
      return { ok: true, duplicate: false, balance, transactionId: entry?.id || null };
    });
  }

  async spend({ discordUserId, amount, orderId, source = 'cluster-shop', metadata = {} } = {}) {
    const id = cleanId(discordUserId, 'Discord user ID');
    const value = positiveWhole(amount);
    const order = cleanId(orderId, 'Order ID');
    const key = `purchase_${order}`;
    return this.repository.transact(id, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) return { ok: true, duplicate: true, balance: Number(prior.balanceAfter) || 0, transactionId: prior.id || null };
      const account = await tx.getOrCreateAccount(id);
      const current = Number(account.balance) || 0;
      if (current < value) return { ok: false, reason: 'insufficient-funds', balance: current };
      const balance = current - value;
      const entry = await tx.appendLedger({ discordUserId: id, amount: -value, balanceAfter: balance, type: 'purchase', source, idempotencyKey: key, metadata: { orderId: order, ...metadata }, at: this.now().toISOString() });
      await tx.setBalance(id, balance);
      return { ok: true, duplicate: false, balance, transactionId: entry?.id || null };
    });
  }
}

module.exports = { NexusEconomyWalletCore, positiveWhole };
