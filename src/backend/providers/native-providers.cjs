'use strict';

const { WarframeProvider } = require('./warframe-provider.cjs');

function nativeProvidersFromConfig(config = {}, options = {}) {
  const providers = {};
  if (config.modules?.warframe?.enabled !== false) {
    providers.warframe = new WarframeProvider({
      platform: config.modules?.warframe?.platform,
      marketPlatform: config.modules?.warframe?.marketPlatform,
      fetchImpl: options.fetchImpl
    });
  }
  return providers;
}

module.exports = { nativeProvidersFromConfig };
