'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readConfig, updateArkShopConfig } = require('./ark-config-manager.cjs');

const VERSION = 'arkshop-map2-clone-from-gen1';
const SOURCE_PREFIX = 'ARK_GEN1';
const TARGET_PREFIX = 'ARK_MAP2';
const LOVE_SHOP_ID = 'apoth_love';
const MANAGED_SECTIONS = Object.freeze(['Kits', 'ShopItems', 'SellItems']);

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function buildTargetConfig(source, target) {
  const next = clone(target || {});
  for (const section of MANAGED_SECTIONS) {
    next[section] = clone(source?.[section] || {});
  }
  next.ShopItems ||= {};
  delete next.ShopItems[LOVE_SHOP_ID];
  return next;
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };

  const sourceRead = await readConfig(SOURCE_PREFIX, 'arkshop');
  const targetRead = await readConfig(TARGET_PREFIX, 'arkshop');
  const source = JSON.parse(sourceRead.text);
  const target = JSON.parse(targetRead.text);
  const expected = buildTargetConfig(source, target);

  const result = await updateArkShopConfig({
    prefix: TARGET_PREFIX,
    transform: () => expected
  });

  const verify = JSON.parse((await readConfig(TARGET_PREFIX, 'arkshop')).text);
  for (const section of MANAGED_SECTIONS) {
    const expectedSection = JSON.stringify(expected?.[section] || {});
    const actualSection = JSON.stringify(verify?.[section] || {});
    if (expectedSection !== actualSection) throw new Error(`Verification failed for ${section}.`);
  }
  if (verify?.ShopItems && Object.prototype.hasOwnProperty.call(verify.ShopItems, LOVE_SHOP_ID)) {
    throw new Error('Verification failed: Love Potion was copied to MAP2.');
  }

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    sourcePrefix: SOURCE_PREFIX,
    targetPrefix: TARGET_PREFIX,
    sections: MANAGED_SECTIONS,
    kitCount: Object.keys(verify?.Kits || {}).length,
    shopItemCount: Object.keys(verify?.ShopItems || {}).length,
    sellItemCount: Object.keys(verify?.SellItems || {}).length,
    backup: result?.backup || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  return stamp;
}

if (require.main === module) run().catch((error) => {
  console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`);
  process.exitCode = 1;
});

module.exports = {
  VERSION,
  SOURCE_PREFIX,
  TARGET_PREFIX,
  LOVE_SHOP_ID,
  MANAGED_SECTIONS,
  buildTargetConfig,
  run,
  cleanError
};
