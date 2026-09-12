'use strict';

const { DINO_BALL_BLUEPRINT, PACKS } = require('./arkshop-nexus-launch-v2-startup.cjs');
const { kitDefinitions } = require('./arkshop-nexus-launch-v3-kits-startup.cjs');
const { REBUNDLED_BUYS } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { BUILDER_RESOURCES, blueprintFor } = require('./arkshop-nexus-launch-v10-native-item-delivery-startup.cjs');
const { SHOP_ITEMS } = require('./arkshop-nexus-launch-v13-potion-balance-startup.cjs');

const PRODUCTION_CATALOG_MARKER = '@arkshop-production';

function rawBlueprint(value) {
  const text = String(value || '').trim();
  const wrapped = text.match(/^Blueprint'(.+)'$/);
  return wrapped ? wrapped[1] : text;
}

function potionBlueprint(asset) {
  const raw = String(asset || '').trim();
  const leaf = raw.split('/').at(-1);
  return `${raw}.${leaf}`;
}

function deliveryItem(input = {}) {
  return {
    blueprint: rawBlueprint(input.Blueprint || input.blueprint),
    amount: Number(input.Amount ?? input.amount ?? 1),
    quality: Number(input.Quality ?? input.quality ?? 0),
    forceBlueprint: input.ForceBlueprint === true || input.forceBlueprint === true
  };
}

function resourceCatalog() {
  return Object.entries(REBUNDLED_BUYS).map(([id, spec]) => {
    const [description, price, gfi, amount] = spec;
    return {
      id,
      name: description,
      description: 'ArkShop production resource bundle',
      category: 'Resources',
      kind: 'resource',
      blueprint: rawBlueprint(blueprintFor(gfi)),
      baseQuantity: amount,
      buyPrice: price,
      buyable: true,
      sellable: false
    };
  });
}

function dinoSupplyCatalog() {
  return Object.entries(PACKS).map(([id, spec]) => ({
    id,
    name: spec.description,
    description: 'Dino Depot Dino Balls from the former in-game ArkShop',
    category: 'Dino Supplies',
    kind: 'dino-supply',
    blueprint: rawBlueprint(DINO_BALL_BLUEPRINT),
    baseQuantity: spec.amount,
    buyPrice: spec.price,
    buyable: true,
    sellable: false
  }));
}

function kitCatalog() {
  const definitions = kitDefinitions();
  return Object.entries(definitions).map(([id, definition]) => {
    let items = (definition.Items || []).map(deliveryItem);
    if (id === 'builder') {
      items = [
        ...items,
        ...BUILDER_RESOURCES.map(([gfi, amount]) => deliveryItem({ Blueprint: blueprintFor(gfi), Amount: amount }))
      ];
    }
    return {
      id: `kit-${id}`,
      name: definition.Description || `${id} kit`,
      description: definition.Description || `${id} kit`,
      category: 'Kits',
      kind: 'kit',
      baseQuantity: 1,
      buyPrice: Number(definition.Price || 0),
      buyable: true,
      sellable: false,
      deliveryItems: items
    };
  });
}

function apothecaryCatalog() {
  return Object.entries(SHOP_ITEMS).map(([id, spec]) => ({
    id,
    name: String(spec.description || id).replace(/^Nexus Apothecary\s*-\s*/i, ''),
    description: spec.description,
    category: 'Apothecary',
    kind: 'potion',
    blueprint: potionBlueprint(spec.asset),
    baseQuantity: 1,
    buyPrice: spec.price,
    buyable: true,
    sellable: false
  }));
}

const PRODUCTION_CLUSTER_SHOP_CATALOG = Object.freeze([
  ...resourceCatalog(),
  ...dinoSupplyCatalog(),
  ...kitCatalog(),
  ...apothecaryCatalog()
].map((entry) => Object.freeze(entry)));

module.exports = {
  PRODUCTION_CATALOG_MARKER,
  PRODUCTION_CLUSTER_SHOP_CATALOG,
  rawBlueprint,
  resourceCatalog,
  dinoSupplyCatalog,
  kitCatalog,
  apothecaryCatalog
};
