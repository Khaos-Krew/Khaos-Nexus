'use strict';

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function arkNpFlags(env = process.env) {
  const dryRaw = env.ARK_SHOP_DRY_RUN;
  const dryRun = dryRaw == null || String(dryRaw).trim() === '' ? true : flagOn(dryRaw);
  return Object.freeze({
    shopEnabled: flagOn(env.ARK_SHOP_ENABLED),
    shopDeliveryEnabled: flagOn(env.ARK_SHOP_DELIVERY_ENABLED),
    starterKitEnabled: flagOn(env.ARK_STARTER_KIT_ENABLED),
    dryRun,
    npShopWritesEnabled: flagOn(env.NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED)
  });
}

module.exports = { flagOn, arkNpFlags };
