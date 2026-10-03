'use strict';

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function mcPointsFlags(env = process.env) {
  const dryRaw = env.MC_PLAYTIME_DRY_RUN;
  const dryRun = dryRaw == null || String(dryRaw).trim() === '' ? true : flagOn(dryRaw);
  const pointsEnabled = flagOn(env.MC_POINTS_ENABLED);
  const playtimeEnabled = flagOn(env.MC_PLAYTIME_NP_ENABLED);
  const shopEnabled = flagOn(env.MC_SHOP_ENABLED);
  const shopDeliveryEnabled = flagOn(env.MC_SHOP_DELIVERY_ENABLED);
  const starterKitEnabled = flagOn(env.MC_STARTER_KIT_ENABLED);
  return Object.freeze({
    pointsEnabled,
    playtimeEnabled,
    dryRun,
    shopEnabled,
    shopDeliveryEnabled,
    starterKitEnabled,
    trackingEnabled: pointsEnabled || playtimeEnabled,
    playtimeWrites: pointsEnabled && playtimeEnabled && dryRun === false
  });
}

module.exports = { flagOn, mcPointsFlags };
