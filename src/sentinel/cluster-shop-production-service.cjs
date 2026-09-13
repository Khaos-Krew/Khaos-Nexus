'use strict';

const { ClusterShopService, loadCatalog } = require('./cluster-shop-service.cjs');
const {
  PRODUCTION_CATALOG_MARKER,
  PRODUCTION_CLUSTER_SHOP_CATALOG
} = require('./cluster-shop-production-catalog.cjs');

function catalogSource(env = process.env) {
  return String(env.NEXUS_CLUSTER_SHOP_CATALOG_JSON || '[]').trim();
}

function productionCatalogMap() {
  const serializable = PRODUCTION_CLUSTER_SHOP_CATALOG.map((entry) => ({
    ...entry,
    metadata: {
      ...(entry.metadata || {}),
      ...(Array.isArray(entry.deliveryItems) ? { deliveryItems: entry.deliveryItems } : {})
    }
  }));
  return loadCatalog(JSON.stringify(serializable));
}

class ProductionClusterShopService extends ClusterShopService {
  constructor({ economy, store } = {}) {
    super({ economy, store, catalog: productionCatalogMap() });
  }

  quote(input = {}) {
    const quote = super.quote(input);
    const item = this.item(input.itemId);
    return {
      ...quote,
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    };
  }
}

function createConfiguredClusterShop({ economy, store, env = process.env } = {}) {
  if (catalogSource(env) === PRODUCTION_CATALOG_MARKER) {
    return new ProductionClusterShopService({ economy, store });
  }
  return new ClusterShopService({ economy, store });
}

module.exports = {
  PRODUCTION_CATALOG_MARKER,
  catalogSource,
  productionCatalogMap,
  ProductionClusterShopService,
  createConfiguredClusterShop
};
