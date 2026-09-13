'use strict';

const MAX_SELECT_OPTIONS = 25;
const MAX_LABEL_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_VALUE_LENGTH = 100;

function truncate(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function assertSafeStorefront(storefront) {
  if (!storefront || storefront.ok !== true || storefront.available !== true) {
    throw new Error('cluster-shop-storefront-unavailable');
  }
  if (storefront.currency !== 'Nexus Points') {
    throw new Error('cluster-shop-currency-mismatch');
  }
  if (!Array.isArray(storefront.items)) {
    throw new Error('cluster-shop-items-invalid');
  }

  for (const item of storefront.items) {
    if (!item || item.fulfillment !== 'rewards-ascended-item') {
      throw new Error('cluster-shop-fulfillment-invalid');
    }
    if (item.kind === 'dino-cache' || item.kind === 'creature') {
      throw new Error('cluster-shop-dino-cache-forbidden');
    }
    if (item.sellbackEnabled === true) {
      throw new Error('cluster-shop-sellback-must-remain-disabled');
    }
    if (String(item.id ?? '').length === 0 || String(item.id).length > MAX_VALUE_LENGTH) {
      throw new Error('cluster-shop-item-id-invalid');
    }
  }
}

function projectOption(item) {
  const price = Number(item.price);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new Error('cluster-shop-item-price-invalid');
  }

  const displayName = truncate(item.displayName || item.id, MAX_LABEL_LENGTH);
  const affordable = item.affordable === true;
  const detail = affordable
    ? `${price.toLocaleString('en-US')} Nexus Points`
    : `${price.toLocaleString('en-US')} NP • Need ${Number(item.shortfall || 0).toLocaleString('en-US')} more`;

  return Object.freeze({
    label: displayName,
    value: String(item.id),
    description: truncate(detail, MAX_DESCRIPTION_LENGTH),
    default: false
  });
}

function chunk(items, size) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function buildNexusClusterShopDiscordView(storefront) {
  assertSafeStorefront(storefront);

  const optionPages = chunk(storefront.items.map(projectOption), MAX_SELECT_OPTIONS);
  const pages = optionPages.map((options, index) => Object.freeze({
    page: index + 1,
    pageCount: optionPages.length,
    content: Object.freeze({
      title: '#cluster-shop',
      description: 'Browse ARK items purchasable with Nexus Points. Purchases remain disabled until the guarded fulfillment path is explicitly activated.',
      balanceText: `${Number(storefront.balance || 0).toLocaleString('en-US')} Nexus Points`,
      mode: 'browse-only'
    }),
    components: Object.freeze([
      Object.freeze({
        type: 'string-select',
        customId: `nexus:cluster-shop:browse:${index + 1}`,
        placeholder: 'Choose an item to inspect',
        minValues: 1,
        maxValues: 1,
        disabled: options.length === 0,
        options: Object.freeze(options)
      }),
      Object.freeze({
        type: 'button',
        style: 'primary',
        customId: 'nexus:cluster-shop:buy',
        label: 'Buy',
        disabled: true
      })
    ])
  }));

  return Object.freeze({
    ok: true,
    channel: '#cluster-shop',
    currency: 'Nexus Points',
    balance: storefront.balance,
    interactionMode: 'browse-only',
    purchasePermitted: false,
    sellbackPermitted: false,
    dinoCacheFlowIncluded: false,
    pages: Object.freeze(pages)
  });
}

module.exports = {
  buildNexusClusterShopDiscordView,
  MAX_SELECT_OPTIONS
};
