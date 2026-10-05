'use strict';

const PROVIDERS = Object.freeze({
  coins: Object.freeze({ id: 'coins', live: true }),
  'gift-b': Object.freeze({ id: 'gift-b', live: false }),
  'gift-c': Object.freeze({ id: 'gift-c', live: false })
});

function listBirthdayProviders() {
  return Object.values(PROVIDERS).map((provider) => ({ id: provider.id, live: provider.live === true }));
}

function liveBirthdayProviders() {
  return listBirthdayProviders().filter((provider) => provider.live).map((provider) => provider.id);
}

async function grantBirthdayProvider(providerId, economy, input) {
  const provider = PROVIDERS[providerId];
  if (!provider || provider.live !== true || provider.id !== 'coins') {
    return { ok: false, skipped: 'provider-unavailable' };
  }
  if (!economy || typeof economy.credit !== 'function') {
    return { ok: false, skipped: 'economy-unconfigured' };
  }
  return economy.credit({
    ...input,
    source: 'birthday-gift',
    type: 'credit',
    currency: 'NEXUS_COINS'
  });
}

module.exports = {
  PROVIDERS,
  listBirthdayProviders,
  liveBirthdayProviders,
  grantBirthdayProvider
};
