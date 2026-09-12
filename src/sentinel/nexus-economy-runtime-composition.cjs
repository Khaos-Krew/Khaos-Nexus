'use strict';

const { createNexusEconomyWallet } = require('./nexus-economy-composition.cjs');
const { NexusEconomyPostgresAudit } = require('./nexus-economy-postgres-audit.cjs');
const { NexusEconomyMutationService } = require('./nexus-economy-mutation-service.cjs');

/**
 * Inert composition boundary for the guarded Nexus economy mutation stack.
 *
 * Construction performs no queries, migrations, startup registration, network
 * connection, Discord/ARK action, or wallet mutation. The caller owns the
 * Postgres pool lifecycle and must explicitly invoke a mutation method before
 * any database work occurs.
 */
function createNexusEconomyMutationRuntime({
  pool,
  schema = 'public',
  env = process.env,
  now
} = {}) {
  const { wallet, repository } = createNexusEconomyWallet({ pool, schema, now });
  const audit = new NexusEconomyPostgresAudit({ pool, schema });
  const mutations = new NexusEconomyMutationService({ wallet, audit, env, now });

  return Object.freeze({ wallet, repository, audit, mutations });
}

module.exports = { createNexusEconomyMutationRuntime };
