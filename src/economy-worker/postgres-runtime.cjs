'use strict';

const { Pool } = require('pg');
const { NexusEconomyWalletCore } = require('../sentinel/nexus-economy-wallet-core.cjs');
const { NexusEconomyPostgresRuntimeRepository } = require('../sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { NexusEconomyPostgresShopService } = require('../sentinel/nexus-economy-postgres-shop-service.cjs');
const { verifyIdentityProof } = require('../sentinel/nexus-economy-identity-proof.cjs');
const { assertO9EligibilityForVerifiedMint } = require('../sentinel/nexus-economy-o9-eligibility.cjs');
const { PostgresEconomyAccrual } = require('./postgres-accrual.cjs');
const { isShadowRecruitEligibleRank } = require('../shared/ranks.cjs');
const { routeWalletCredit } = require('../sentinel/nexus-economy-community-level-coins.cjs');

function postgresEnabled(env = process.env) {
  return String(env.NEXUS_ECONOMY_STORAGE || '').trim().toLowerCase() === 'postgres';
}

function databaseUrl(env = process.env) {
  return String(env.NEXUS_ECONOMY_DATABASE_URL || env.DATABASE_URL || '').trim();
}

async function createPostgresEconomyRuntime({ env = process.env, now } = {}) {
  const connectionString = databaseUrl(env);
  if (!connectionString) throw new Error('Postgres economy storage requires NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL.');
  const schema = String(env.NEXUS_ECONOMY_SCHEMA || 'public').trim() || 'public';
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool, schema });
  const nowFn = now ? () => Number(now()) : Date.now;
  const accrual = new PostgresEconomyAccrual({ pool, schema, now: nowFn });
  try {
    await pool.query(NexusEconomyPostgresRuntimeRepository.runtimeSchemaSql({ schema }));
    await accrual.ensureSchema();
    await pool.query('SELECT 1 AS ok');
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }

  const walletCore = new NexusEconomyWalletCore({ repository, now: now ? () => new Date(now()) : undefined });
  async function syncRankAndEnsure(discordUserId, rankId) {
    const rank = rankId || 'shadow-recruit';
    const synced = await accrual.syncRank(discordUserId, rank);
    if (isShadowRecruitEligibleRank(rank)) {
      try {
        await repository.ensureShadowRecruitWallet(discordUserId, rank, { env });
      } catch (error) {
        console.warn(`[Nexus Economy] ensureShadowRecruitWallet after syncRank failed: ${String(error?.message || error).slice(0, 240)}`);
      }
    }
    return synced;
  }

  const worker = Object.freeze({
    backend: 'postgres',
    health() { return { ok: true }; },
    balance(discordUserId) { return walletCore.balance(discordUserId, 'NEXUS_POINTS'); },
    balances(discordUserId) { return walletCore.balances(discordUserId); },
    credit(input = {}) { return routeWalletCredit(walletCore, input, env); },
    spend(input = {}) { return walletCore.spend({ ...input, currency: input.currency || 'NEXUS_POINTS' }); },
    adminCredit(input = {}) {
      return walletCore.adminCredit({ ...input, currency: input.currency || 'NEXUS_POINTS', env });
    },
    adminSpend(input = {}) {
      return walletCore.adminSpend({ ...input, currency: input.currency || 'NEXUS_POINTS', env });
    },
    recordPresence(input = {}) { return accrual.recordPresence(input); },
    accrueOffline(discordUserId) { return accrual.accrueOffline(discordUserId); },
    syncRank(discordUserId, rankId) { return syncRankAndEnsure(discordUserId, rankId); },
    ensureShadowRecruitWallet(discordUserId, rankId = 'shadow-recruit') {
      return repository.ensureShadowRecruitWallet(discordUserId, rankId, { env });
    },
    async linkArkIdentity(input) {
      if (env.NEXUS_ECONOMY_IDENTITY_LINKS_ENABLED !== 'true') throw new Error('Economic identity linking is disabled.');
      const verified = verifyIdentityProof(input, { secret: env.NEXUS_ECONOMY_IDENTITY_PROOF_SECRET, now: now ? now() : Date.now() });
      // O9: repository is source of truth for status elevation (restricted vs verified).
      // Early-clear ark-link-required only; Discord stub unresolved still calls repo (restricted path).
      const eligibility = assertO9EligibilityForVerifiedMint(verified);
      if (!eligibility.ok && eligibility.reason === 'ark-link-required') {
        throw new Error(eligibility.reason);
      }
      const linked = await repository.linkVerifiedIdentity(verified);
      await syncRankAndEnsure(verified.discordUserId, input.rankId || 'shadow-recruit');
      return linked;
    },
    demoteIdentityToRestricted(discordUserId) {
      return repository.demoteVerifiedIdentityToRestricted(String(discordUserId || ''));
    }
  });
  const shop = new NexusEconomyPostgresShopService({ wallet: walletCore, repository });

  return Object.freeze({
    pool,
    repository,
    walletCore,
    accrual,
    worker,
    shop,
    async close() { await pool.end(); }
  });
}

module.exports = { postgresEnabled, databaseUrl, createPostgresEconomyRuntime };
