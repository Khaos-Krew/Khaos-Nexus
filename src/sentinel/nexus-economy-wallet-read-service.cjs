'use strict';

const { createNexusEconomyWallet } = require('./nexus-economy-composition.cjs');
const { inspectNexusEconomyRuntimeStatus } = require('./nexus-economy-runtime-status.cjs');
const { ledgerLimit } = require('./nexus-economy-postgres-repository.cjs');

function unavailable(status, includeEntries = false) {
  return Object.freeze({
    ok: false,
    available: false,
    mode: status.mode,
    reason: status.reason,
    balance: null,
    ...(includeEntries ? { entries: Object.freeze([]) } : {})
  });
}

function createNexusEconomyWalletReadService({ pool, schema = 'public', env = process.env, now } = {}) {
  const { wallet, repository } = createNexusEconomyWallet({ pool, schema, now });

  return Object.freeze({
    async getBalance(discordUserId) {
      const status = await inspectNexusEconomyRuntimeStatus({ pool, schema, env });
      if (!status.ready) return unavailable(status);

      const balance = await wallet.balance(discordUserId);
      return Object.freeze({
        ok: true,
        available: true,
        mode: status.mode,
        reason: status.reason,
        balance
      });
    },

    async getSnapshot(discordUserId, { limit = 10 } = {}) {
      const safeLimit = ledgerLimit(limit);
      const status = await inspectNexusEconomyRuntimeStatus({ pool, schema, env });
      if (!status.ready) return unavailable(status, true);

      const balance = await wallet.balance(discordUserId);
      const entries = await repository.listLedger(discordUserId, { limit: safeLimit });
      return Object.freeze({
        ok: true,
        available: true,
        mode: status.mode,
        reason: status.reason,
        balance,
        entries: Object.freeze(entries)
      });
    }
  });
}

module.exports = { createNexusEconomyWalletReadService };
