'use strict';

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function mcPointsFlags(env = process.env) {
  const dryRaw = env.MC_PLAYTIME_DRY_RUN;
  const dryRun = dryRaw == null || String(dryRaw).trim() === '' ? true : flagOn(dryRaw);
  const shopDryRaw = env.MC_SHOP_DRY_RUN;
  const shopDryRun = shopDryRaw == null || String(shopDryRaw).trim() === '' ? true : flagOn(shopDryRaw);
  const pointsEnabled = flagOn(env.MC_POINTS_ENABLED);
  const playtimeEnabled = flagOn(env.MC_PLAYTIME_NP_ENABLED);
  const shopEnabled = flagOn(env.MC_SHOP_ENABLED);
  const shopDeliveryEnabled = flagOn(env.MC_SHOP_DELIVERY_ENABLED);
  const starterKitEnabled = flagOn(env.MC_STARTER_KIT_ENABLED);
  const playtimeWrites = pointsEnabled && playtimeEnabled && dryRun === false;
  // The kit's 15 minutes use the dry-run clock. That records link playtime and
  // writes no Points ledger row, so the kit does not need MC_PLAYTIME_NP_ENABLED.
  const kitPlaytimeObservation = pointsEnabled && starterKitEnabled && dryRun === true && playtimeEnabled === false;
  return Object.freeze({
    pointsEnabled,
    playtimeEnabled,
    dryRun,
    shopDryRun,
    shopEnabled,
    shopDeliveryEnabled,
    starterKitEnabled,
    trackingEnabled: pointsEnabled || playtimeEnabled,
    playtimeWrites,
    kitPlaytimeObservation
  });
}

module.exports = { flagOn, mcPointsFlags };
