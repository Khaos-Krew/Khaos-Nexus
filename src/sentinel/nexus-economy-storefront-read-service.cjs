'use strict';

const { createNexusEconomyWalletReadService } = require('./nexus-economy-wallet-read-service.cjs');
const { loadNexusEconomyShopCatalog } = require('./nexus-economy-shop-catalog.cjs');

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

function projectStorefrontItem(item, balance) {
  const affordable = balance >= item.price;
  return Object.freeze({
    ...item,
    affordable,
    shortfall: affordable ? 0 : item.price - balance,
    canPurchase: false
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

  return Object.freeze({
    async getStorefront(discordUserId) {
      const wallet = await walletService.getBalance(discordUserId);
      if (!wallet.available) return unavailable(wallet);

      let catalog;
      try {
        catalog = await loadNexusEconomyShopCatalog({ catalogPath, readFile });
      } catch {
        return unavailable(wallet, 'shop-catalog-unavailable');
      }

      const items = catalog.items.map((item) => projectStorefrontItem(item, wallet.balance));
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
  projectStorefrontItem
};
