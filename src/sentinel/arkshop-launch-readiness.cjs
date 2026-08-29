'use strict';

const { KIT_PRICES } = require('./arkshop-nexus-launch-v3-kits-startup.cjs');
const { REBUNDLED_BUYS, BASIC_SELLS } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { BOSS_TROPHY_SELLS } = require('./arkshop-nexus-launch-v8-boss-sell-startup.cjs');
const { APEX_TRIBUTE_SELLS } = require('./arkshop-nexus-launch-v9-apex-tribute-sell-startup.cjs');
const { CACHE_IDS, cacheShopId } = require('./arkshop-nexus-launch-v11-inshop-caches-startup.cjs');

const REQUIRED_DINO_BALL_ITEMS = Object.freeze(['dinoballs5', 'dinoballs25', 'dinoballs100']);

function launchReadiness(profile) {
  const data = profile?.data || profile || {};
  const kits = data.Kits || {};
  const shop = data.ShopItems || {};
  const sells = data.SellItems || {};
  const missing = [];

  if (!kits.starter || Number(kits.starter.Price) !== 0 || Number(kits.starter.DefaultAmount) !== 1) missing.push('starter-kit');
  for (const [id, price] of Object.entries(KIT_PRICES)) if (Number(kits[id]?.Price) !== Number(price)) missing.push(`kit:${id}`);
  for (const id of REQUIRED_DINO_BALL_ITEMS) if (!shop[id]) missing.push(`shop:${id}`);
  for (const id of Object.keys(REBUNDLED_BUYS)) if (!shop[id]) missing.push(`resource-buy:${id}`);
  for (const cacheId of CACHE_IDS) if (!shop[cacheShopId(cacheId)]) missing.push(`dino-cache:${cacheId}`);
  for (const id of Object.keys(BASIC_SELLS)) if (!sells[id]) missing.push(`resource-sell:${id}`);
  for (const id of Object.keys(BOSS_TROPHY_SELLS)) if (!sells[id]) missing.push(`boss-sell:${id}`);
  for (const id of Object.keys(APEX_TRIBUTE_SELLS)) if (!sells[id]) missing.push(`apex-tribute-sell:${id}`);

  if (data?.General?.TimedPointsReward?.Enabled !== true) missing.push('timed-points:enabled');
  if (Number(data?.General?.TimedPointsReward?.Interval) !== 5) missing.push('timed-points:interval');
  if (Number(data?.General?.TimedPointsReward?.Groups?.Default?.Amount) !== 2) missing.push('timed-points:default');
  if (Number(data?.General?.TimedPointsReward?.Groups?.Premiums?.Amount) !== 4) missing.push('timed-points:premium');
  if (data?.General?.GiveDinosInCryopods !== false) missing.push('give-dinos-in-cryopods:false');

  return {
    ready: missing.length === 0,
    missing,
    counts: {
      kits: Object.keys(kits).length,
      shopItems: Object.keys(shop).length,
      sellItems: Object.keys(sells).length,
      requiredKits: 1 + Object.keys(KIT_PRICES).length,
      requiredResourceBuys: Object.keys(REBUNDLED_BUYS).length,
      requiredInShopCaches: CACHE_IDS.length,
      requiredResourceSells: Object.keys(BASIC_SELLS).length,
      requiredBossSells: Object.keys(BOSS_TROPHY_SELLS).length,
      requiredApexTributeSells: Object.keys(APEX_TRIBUTE_SELLS).length
    }
  };
}

module.exports = { REQUIRED_DINO_BALL_ITEMS, launchReadiness };
