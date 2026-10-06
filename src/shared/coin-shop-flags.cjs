'use strict';

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function coinShopFlags(env = process.env) {
  return Object.freeze({
    shopEnabled: flagOn(env.COIN_SHOP_ENABLED),
    spendEnabled: flagOn(env.NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED)
  });
}

function purchaseCeiling(env = process.env) {
  const raw = env.NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING;
  if (raw == null || String(raw).trim() === '') return null;
  const ceiling = Number(String(raw).trim());
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) return null;
  return ceiling;
}

module.exports = { flagOn, coinShopFlags, purchaseCeiling };
