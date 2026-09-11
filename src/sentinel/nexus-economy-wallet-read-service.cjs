'use strict';

const { createNexusEconomyWallet } = require('./nexus-economy-composition.cjs');
const { inspectNexusEconomyRuntimeStatus } = require('./nexus-economy-runtime-status.cjs');

function createNexusEconomyWalletReadService({ pool, schema = 'public', env = process.env, now } = {}) {
  const { wallet } = createNexusEconomyWallet({ pool, schema, now });

  return Object.freeze({
    async getBalance(discordUserId) {
      const status = await inspectNexusEconomyRuntimeStatus({ pool, schema, env });

      if (!status.ready) {
        return Object.freeze({
          ok: false,
          available: false,
          mode: status.mode,
          reason: status.reason,
          balance: null
        });
      }

      const balance = await wallet.balance(discordUserId);
      return Object.freeze({
        ok: true,
        available: true,
        mode: status.mode,
        reason: status.reason,
        balance
      });
    }
  });
}

module.exports = { createNexusEconomyWalletReadService };
