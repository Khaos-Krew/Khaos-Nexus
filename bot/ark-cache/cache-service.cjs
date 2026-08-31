'use strict';

const { freezePurchase } = require('./cache-engine.cjs');
const { animateCacheReveal } = require('./discord-roller.cjs');

/**
 * Records and reveals a cache that the caller has already authorized/paid for.
 * Economy debit is intentionally outside this module until Sentinel's canonical
 * Nexus Points provider is selected; callers must not invoke this before debit succeeds.
 */
async function recordPurchasedCache(options = {}) {
  const {
    store,
    cache,
    discordId,
    eosId,
    message,
    source = 'SHOP',
    rng,
    now,
    animate = animateCacheReveal,
    announce,
    logger = console,
  } = options;

  if (!store || typeof store.createPurchase !== 'function' || typeof store.markAwaiting !== 'function') {
    throw new Error('A Dino Cache store implementing createPurchase() and markAwaiting() is required.');
  }

  const purchase = freezePurchase({ cache, discordId, eosId, source, rng, now });
  const persisted = await store.createPurchase(purchase);
  if (!persisted?.cacheId) throw new Error('Dino Cache ledger did not persist the frozen reward.');

  let revealError = null;
  try {
    await animate(message, purchase, cache, options.animation || {});
  } catch (error) {
    revealError = error;
    logger.warn?.('[ark-cache] Discord reveal failed after reward was persisted; reward will still be queued.', {
      cacheId: purchase.cacheId,
      error: error?.message,
    });
  }

  const queued = await store.markAwaiting(purchase.cacheId);
  if (!queued) throw new Error(`Dino Cache ${purchase.cacheId} could not transition from ROLLING to AWAITING_LOGIN.`);

  if (purchase.announce && typeof announce === 'function') {
    try {
      await announce(purchase);
    } catch (error) {
      logger.warn?.('[ark-cache] Announcement failed; delivery remains queued.', { cacheId: purchase.cacheId, error: error?.message });
    }
  }

  return { purchase, queued, revealError };
}

module.exports = { recordPurchasedCache };
