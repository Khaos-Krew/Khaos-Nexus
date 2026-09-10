'use strict';

const { ECONOMY_AUTHORITY, resolveEconomyAuthorityPolicy, envBool } = require('./economy-authority-policy.cjs');

const CLUSTER_SHOP_DELIVERY_ENV = 'NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED';
const DINO_CACHE_DELIVERY_ENV = 'NEXUS_DINO_CACHE_DELIVERY_ENABLED';

function deny(reason, policy, operation) {
  return Object.freeze({
    allowed: false,
    reason,
    operation,
    authority: policy.authority,
    walletAuthority: policy.walletAuthority
  });
}

function allow(policy, operation) {
  return Object.freeze({
    allowed: true,
    reason: 'allowed',
    operation,
    authority: policy.authority,
    walletAuthority: policy.walletAuthority
  });
}

function economyMutationDecision(operation, env = process.env) {
  const policy = resolveEconomyAuthorityPolicy(env);
  const op = String(operation || '').trim().toLowerCase();

  if (!op) return deny('operation-required', policy, op);
  if (policy.authority !== ECONOMY_AUTHORITY.NEXUS) return deny('nexus-authority-required', policy, op);
  if (policy.legacyArkShop.mutationsAllowed) return deny('legacy-arkshop-mutations-must-remain-disabled', policy, op);

  if (op === 'cluster-shop-delivery') {
    return envBool(env[CLUSTER_SHOP_DELIVERY_ENV], false)
      ? allow(policy, op)
      : deny('cluster-shop-delivery-not-enabled', policy, op);
  }

  if (op === 'dino-cache-delivery') {
    return envBool(env[DINO_CACHE_DELIVERY_ENV], false)
      ? allow(policy, op)
      : deny('dino-cache-delivery-not-enabled', policy, op);
  }

  if (op === 'arkshop-mutation' || op === 'mysql-economy-mutation') {
    return deny('legacy-economy-mutation-forbidden', policy, op);
  }

  return deny('unsupported-economy-mutation', policy, op);
}

function assertEconomyMutationAllowed(operation, env = process.env) {
  const decision = economyMutationDecision(operation, env);
  if (!decision.allowed) {
    const error = new Error(`Economy mutation denied: ${decision.reason}`);
    error.code = 'NEXUS_ECONOMY_MUTATION_DENIED';
    error.reason = decision.reason;
    throw error;
  }
  return decision;
}

module.exports = {
  CLUSTER_SHOP_DELIVERY_ENV,
  DINO_CACHE_DELIVERY_ENV,
  economyMutationDecision,
  assertEconomyMutationAllowed
};
