'use strict';

const { NexusEconomyWalletCore } = require('./nexus-economy-wallet-core.cjs');
const { NexusEconomyPostgresRepository } = require('./nexus-economy-postgres-repository.cjs');

/**
 * Inert composition boundary for the Nexus economy.
 *
 * Construction performs no schema migration, query, startup registration, or
 * network connection. The caller owns the Postgres pool lifecycle and must
 * explicitly invoke wallet operations before any database work occurs.
 */
function createNexusEconomyWallet({ pool, schema = 'public', now } = {}) {
  const repository = new NexusEconomyPostgresRepository({ pool, schema });
  const wallet = new NexusEconomyWalletCore({ repository, now });
  return { wallet, repository };
}

module.exports = { createNexusEconomyWallet };
