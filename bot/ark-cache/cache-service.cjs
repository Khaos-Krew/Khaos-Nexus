'use strict';

const { freezePurchase } = require('./cache-engine.cjs');
const { animateCacheReveal } = require('./discord-roller.cjs');

function requirePurchaseDependencies(store, pointsGateway) {
  if (!store || typeof store.createPurchase !== 'function' || typeof store.markAwaiting !== 'function') {
    throw new Error('A Dino Cache store implementing createPurchase() and markAwaiting() is required.');
  }
  if (!pointsGateway || typeof pointsGateway.debitForCache !== 'function' || typeof pointsGateway.refundCacheDebit !== 'function') {
    throw new Error('An ArkShop points gateway implementing debitForCache() and refundCacheDebit() is required. Cache RNG is blocked without it.');
  }
}

async function refundBeforePersistence(pointsGateway, debit, cause, logger) {
  try {
    await pointsGateway.refundCacheDebit({
      eosId: debit.eosId,
      cost: debit.cost,
      preferredServer: debit.serverId || debit.serverName,
    });
  } catch (refundError) {
    logger.error?.('[ark-cache] CRITICAL: pre-persistence failure occurred after ArkShop debit and automatic refund could not be verified.', {
      eosId: debit.eosId,
      cost: debit.cost,
      purchaseError: cause?.message,
      refundError: refundError?.message,
    });
    const error = new Error(`Dino Cache purchase failed after ArkShop debit and refund verification also failed. Manual point reconciliation is required. Purchase error: ${cause?.message}; refund error: ${refundError?.message}`);
    error.code = 'ARKSHOP_MANUAL_RECONCILIATION_REQUIRED';
    error.purchaseError = cause;
    error.refundError = refundError;
    throw error;
  }
  throw cause;
}

/**
 * The only supported paid Dino Cache purchase entry point.
 *
 * Security invariant:
 *   1. Read ArkShop balance for the linked EOS account.
 *   2. Deduct the full configured cache cost through ArkShop RCON.
 *   3. Re-read ArkShop and verify the exact post-debit balance.
 *   4. Only after steps 1-3 succeed may RNG execute.
 *
 * There is deliberately no administrator/owner bypass. Discord permissions never
 * participate in point charging. An admin purchasing a cache is charged exactly
 * like every other player.
 */
async function purchaseDinoCache(options = {}) {
  const {
    store,
    pointsGateway,
    cache,
    discordId,
    eosId,
    message,
    preferredServer,
    rng,
    now,
    animate = animateCacheReveal,
    announce,
    logger = console,
  } = options;

  requirePurchaseDependencies(store, pointsGateway);

  const cost = Number(cache?.cost);
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new Error('Paid Dino Cache purchases require a positive integer ArkShop point cost. Free/admin grants must not use the shop-purchase path.');
  }

  // CRITICAL: No RNG call is allowed above this point or inside debitForCache().
  // Every caller, including Owner/Admin accounts, executes this same debit.
  const debit = await pointsGateway.debitForCache({ eosId, cost, preferredServer });
  if (!debit || debit.afterBalance !== debit.beforeBalance - cost) {
    throw new Error('ArkShop debit was not positively verified. Dino Cache RNG blocked.');
  }

  let purchase;
  try {
    const frozen = freezePurchase({ cache, discordId, eosId, source: 'SHOP', rng, now });
    purchase = Object.freeze({
      ...frozen,
      metadata: Object.freeze({
        paymentProvider: 'ARKSHOP',
        debitVerified: true,
        debitCost: cost,
        balanceBefore: debit.beforeBalance,
        balanceAfter: debit.afterBalance,
        debitServerId: debit.serverId || null,
        debitServerName: debit.serverName || null,
      }),
    });
  } catch (error) {
    return refundBeforePersistence(pointsGateway, debit, error, logger);
  }

  let persisted;
  try {
    persisted = await store.createPurchase(purchase);
    if (!persisted?.cacheId) throw new Error('Dino Cache ledger did not persist the frozen reward.');
  } catch (error) {
    return refundBeforePersistence(pointsGateway, debit, error, logger);
  }

  // Once the reward is persisted, points stay spent. Any Discord/reveal problem
  // cannot produce a refund exploit because the exact reward remains owed/queued.
  let revealError = null;
  try {
    await animate(message, purchase, cache, options.animation || {});
  } catch (error) {
    revealError = error;
    logger.warn?.('[ark-cache] Discord reveal failed after paid reward was persisted; reward remains owed and will still be queued.', {
      cacheId: purchase.cacheId,
      eosId: purchase.eosId,
      error: error?.message,
    });
  }

  const queued = await store.markAwaiting(purchase.cacheId);
  if (!queued) throw new Error(`Dino Cache ${purchase.cacheId} could not transition from ROLLING to AWAITING_LOGIN.`);

  if (purchase.announce && typeof announce === 'function') {
    try {
      await announce(purchase);
    } catch (error) {
      logger.warn?.('[ark-cache] Announcement failed; paid delivery remains queued.', { cacheId: purchase.cacheId, error: error?.message });
    }
  }

  return { purchase, queued, debit, revealError };
}

module.exports = { purchaseDinoCache };
