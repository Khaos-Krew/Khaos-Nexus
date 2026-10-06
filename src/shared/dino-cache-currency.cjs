'use strict';

const NEXUS_POINTS = 'NEXUS_POINTS';
const CACHE_TOKENS = 'DINO_CACHE_TOKENS';
const ARN_TOKENS = 'ARN_TOKENS';
const CACHE_TOKEN_PRICE = 1;
const ARN_TOKEN_PRICE = 1;
const POINTS_CURRENCIES = Object.freeze([NEXUS_POINTS]);
const ARN_CURRENCIES = Object.freeze([ARN_TOKENS]);

function expectedPrices() {
  return require('./ark-np-catalog.cjs').EXPECTED_PRICES;
}

function isArnCache(cacheId) {
  return String(cacheId || '').trim().toLowerCase() === 'arn';
}

function acceptedCurrencies(cacheId) {
  return isArnCache(cacheId) ? ARN_CURRENCIES : POINTS_CURRENCIES;
}

function normalizeShopCurrency(currency, fallback = NEXUS_POINTS) {
  const value = String(currency || '').trim();
  return value || fallback;
}

function pointPriceOf(cacheId, pointPrices = expectedPrices()) {
  if (isArnCache(cacheId)) return ARN_TOKEN_PRICE;
  const price = pointPrices[String(cacheId || '').trim().toLowerCase()];
  return Number.isInteger(price) && price > 0 ? price : null;
}

// One rule for the catalog currencies field, the hub copy, and resolveCachePayment.
// ARN caches take ARN tokens. Every other cache charges Nexus Points at its existing price.
// The catalog still stores a DINO_CACHE_TOKENS price so that spend can be added later.
// That price is not accepted until the cache-token spend path ships.
function resolveCachePayment(cacheId, currency, pointPrices = expectedPrices()) {
  const sku = String(cacheId || '').trim().toLowerCase();
  const accepted = [...acceptedCurrencies(sku)];
  const wanted = normalizeShopCurrency(currency, isArnCache(sku) ? ARN_TOKENS : NEXUS_POINTS);
  if (!accepted.includes(wanted)) {
    return { ok: false, reason: 'currency-not-accepted', cacheId: sku, currency: wanted, accepted, debited: false };
  }
  const points = pointPriceOf(sku, pointPrices);
  const price = wanted === CACHE_TOKENS ? CACHE_TOKEN_PRICE : (wanted === ARN_TOKENS ? ARN_TOKEN_PRICE : points);
  if (!Number.isInteger(price) || price <= 0) {
    return { ok: false, reason: 'unknown-item', cacheId: sku, currency: wanted, accepted, debited: false };
  }
  return { ok: true, cacheId: sku, currency: wanted, price, accepted, debited: false };
}

function shopCurrencyCopy(cacheId, pointPrice) {
  if (isArnCache(cacheId)) {
    return Object.freeze({
      accepted: 'ARN tokens only',
      price: '1 ARN token',
      button: 'Buy • 1 ARN token',
      detail: 'Accepted currency: ARN tokens only. Price: 1 ARN token.'
    });
  }
  const points = Math.max(0, Number(pointPrice) || 0).toLocaleString('en-US');
  return Object.freeze({
    accepted: 'Nexus Points',
    price: `${points} Nexus Points`,
    button: `Buy • ${points} Nexus Points`,
    detail: `Accepted currency: Nexus Points. Price: ${points} Nexus Points.`
  });
}

module.exports = {
  NEXUS_POINTS,
  CACHE_TOKENS,
  ARN_TOKENS,
  CACHE_TOKEN_PRICE,
  ARN_TOKEN_PRICE,
  POINTS_CURRENCIES,
  STANDARD_CURRENCIES: POINTS_CURRENCIES,
  ARN_CURRENCIES,
  isArnCache,
  acceptedCurrencies,
  normalizeShopCurrency,
  pointPriceOf,
  resolveCachePayment,
  shopCurrencyCopy
};
