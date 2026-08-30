'use strict';

const { readConfig } = require('./ark-config-manager.cjs');

const SOURCE_PREFIX = 'ARK_GEN1';
const LOVE_SHOP_ID = 'apoth_love';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }

function buildNatureShopExport(config = {}) {
  const shopItems = clone(config.ShopItems || {});
  delete shopItems[LOVE_SHOP_ID];
  return {
    ShopItems: shopItems,
    VIPShopItems: clone(config.VIPShopItems || {}),
    Kits: clone(config.Kits || {}),
    SellItems: clone(config.SellItems || {})
  };
}

async function run() {
  const source = JSON.parse((await readConfig(SOURCE_PREFIX, 'arkshop')).text);
  const payload = buildNatureShopExport(source);
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  const chunkSize = 3500;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += chunkSize) chunks.push(encoded.slice(i, i + chunkSize));
  console.log(`[Nexus Sentinal] NATURESHOP_EXPORT_BEGIN chunks=${chunks.length} shopItems=${Object.keys(payload.ShopItems || {}).length} vipShopItems=${Object.keys(payload.VIPShopItems || {}).length} kits=${Object.keys(payload.Kits || {}).length} sellItems=${Object.keys(payload.SellItems || {}).length}`);
  chunks.forEach((chunk, index) => console.log(`[Nexus Sentinal] NATURESHOP_EXPORT_CHUNK ${index + 1}/${chunks.length} ${chunk}`));
  console.log('[Nexus Sentinal] NATURESHOP_EXPORT_END');
  return payload;
}

if (require.main === module) run().catch((error) => {
  console.error(`[Nexus Sentinal] NatureShop export FAILED: ${cleanError(error)}`);
  process.exitCode = 1;
});

module.exports = { SOURCE_PREFIX, LOVE_SHOP_ID, buildNatureShopExport, run, cleanError };
