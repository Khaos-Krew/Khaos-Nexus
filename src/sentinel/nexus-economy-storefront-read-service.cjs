'use strict';

const { createNexusEconomyWalletReadService } = require('./nexus-economy-wallet-read-service.cjs');
const { loadNexusEconomyShopCatalog } = require('./nexus-economy-shop-catalog.cjs');
const { loadNexusClusterShopCatalog } = require('./nexus-cluster-shop-catalog.cjs');

function unavailable(wallet, reason = wallet.reason) {
  return Object.freeze({
    ok: false,
    available: false,
    mode: wallet.mode,
    reason,
    currency: 'Nexus Points',
    balance: wallet.balance,
    purchasingEnabled: false,
    items: Object.freeze([])
  });
}

function projectLegacyStorefrontItem(item, balance) {
  const affordable = balance >= item.price;
  return Object.freeze({
    ...item,
    affordable,
    shortfall: affordable ? 0 : item.price - balance,
    canPurchase: false
  });
}

function projectClusterStorefrontItem(item, balance) {
  const price = item.buyPrice;
  const affordable = balance >= price;
  return Object.freeze({
    id: item.id,
    displayName: item.name,
    description: item.description,
    category: item.category,
    kind: item.kind,
    baseQuantity: item.baseQuantity,
    price,
    minBundles: item.minBundles,
    maxBundles: item.maxBundles,
    fulfillment: item.fulfillment,
    affordable,
    shortfall: affordable ? 0 : price - balance,
    canPurchase: false,
    sellbackEnabled: false
  });
}

function createNexusEconomyStorefrontReadService({
  pool,
  schema = 'public',
  env = process.env,
  now,
  catalogPath,
  readFile
} = {}) {
  const walletService = createNexusEconomyWalletReadService({ pool, schema, env, now });
  const explicitLegacyCatalogFixture = Boolean(catalogPath || readFile);

  return Object.freeze({
    async getStorefront(discordUserId) {
      const wallet = await walletService.getBalance(discordUserId);
      if (!wallet.available) return unavailable(wallet);

      let catalog;
      let items;
      try {
        // Explicit file-backed catalog injection is retained only as a compatibility
        // seam for existing tests/migration callers. The production/default
        // #cluster-shop path must use the dedicated Cluster Shop catalog and can
        // never fall through to the Dino Cache catalog.
        if (explicitLegacyCatalogFixture) {
          catalog = await loadNexusEconomyShopCatalog({ catalogPath, readFile });
          items = catalog.items.map((item) => projectLegacyStorefrontItem(item, wallet.balance));
        } else {
          catalog = loadNexusClusterShopCatalog({ env });
          items = catalog.items.map((item) => projectClusterStorefrontItem(item, wallet.balance));
        }
      } catch {
        return unavailable(wallet, 'shop-catalog-unavailable');
      }

      return Object.freeze({
        ok: true,
        available: true,
        mode: wallet.mode,
        reason: wallet.reason,
        currency: catalog.currency,
        balance: wallet.balance,
        purchasingEnabled: false,
        items: Object.freeze(items)
      });
    }
  });
}

module.exports = {
  createNexusEconomyStorefrontReadService,
  projectLegacyStorefrontItem,
  projectClusterStorefrontItem
};
