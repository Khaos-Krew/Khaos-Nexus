'use strict';

const { readConfig } = require('./ark-config-manager.cjs');
const { fromLiveConfig, counts } = require('./arkshop-profiles.cjs');

const timer = setTimeout(() => {
  void (async () => {
    try {
      const result = await readConfig('ARK_GEN1', 'arkshop');
      const parsed = JSON.parse(result.text);
      const safe = fromLiveConfig(parsed);
      console.log(`[Nexus Sentinal] ArkShop live snapshot counts: ${JSON.stringify(counts(safe))}`);
      console.log(`[Nexus Sentinal] ArkShop live snapshot General: ${JSON.stringify(safe.General)}`);
      console.log(`[Nexus Sentinal] ArkShop live snapshot Kits: ${JSON.stringify(safe.Kits)}`);
      console.log(`[Nexus Sentinal] ArkShop live snapshot ShopItems: ${JSON.stringify(safe.ShopItems)}`);
      console.log(`[Nexus Sentinal] ArkShop live snapshot SellItems: ${JSON.stringify(safe.SellItems)}`);
    } catch (error) {
      console.warn(`[Nexus Sentinal] ArkShop live snapshot failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
    }
  })();
}, 7000);
timer.unref?.();
