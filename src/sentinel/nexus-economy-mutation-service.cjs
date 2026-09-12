'use strict';

const { assertEconomyMutationAllowed } = require('./economy-mutation-guard.cjs');

function cleanActor(value) {
  const actor = String(value || '').trim();
  if (!actor || actor.length > 160) throw new Error('Actor is required.');
  return actor;
}

class NexusEconomyMutationService {
  constructor({ wallet, audit, env = process.env, now = () => new Date() } = {}) {
    if (!wallet || typeof wallet.credit !== 'function' || typeof wallet.spend !== 'function') {
      throw new Error('Wallet with credit() and spend() is required.');
    }
    if (!audit || typeof audit.record !== 'function') throw new Error('Audit sink with record() is required.');
    this.wallet = wallet;
    this.audit = audit;
    this.env = env;
    this.now = now;
  }

  async credit(input = {}, context = {}) {
    return this.#mutate('wallet-credit', input, context, () => this.wallet.credit(input));
  }

  async spend(input = {}, context = {}) {
    return this.#mutate('wallet-spend', input, context, () => this.wallet.spend(input));
  }

  async #mutate(operation, input, context, execute) {
    const decision = assertEconomyMutationAllowed(operation, this.env);
    const actor = cleanActor(context.actor);
    const at = this.now().toISOString();
    const target = String(input.discordUserId || '').trim();
    const idempotencyKey = operation === 'wallet-credit'
      ? String(input.idempotencyKey || '').trim()
      : String(input.orderId || '').trim();

    await this.audit.record({
      type: 'economy.mutation.attempt',
      operation,
      actor,
      target,
      idempotencyKey,
      authority: decision.authority,
      walletAuthority: decision.walletAuthority,
      at,
      metadata: context.metadata || {}
    });

    const result = await execute();

    await this.audit.record({
      type: 'economy.mutation.result',
      operation,
      actor,
      target,
      idempotencyKey,
      ok: result?.ok === true,
      duplicate: result?.duplicate === true,
      reason: result?.reason || '',
      transactionId: result?.transactionId || null,
      balance: Number.isFinite(Number(result?.balance)) ? Number(result.balance) : null,
      at: this.now().toISOString()
    });

    return result;
  }
}

module.exports = { NexusEconomyMutationService };
