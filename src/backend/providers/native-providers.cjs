'use strict';

const { WarframeProvider } = require('./warframe-provider.cjs');

const WARFRAME_ACTIONS = Object.freeze([
  'alerts', 'fissures', 'sortie', 'arbitration', 'nightwave', 'market', 'builds'
]);

function nativeProvidersFromConfig(config = {}, options = {}) {
  const providers = {};
  if (config.modules?.warframe?.enabled !== false) {
    const warframe = new WarframeProvider({
      platform: config.modules?.warframe?.platform,
      marketPlatform: config.modules?.warframe?.marketPlatform,
      fetchImpl: options.fetchImpl
    });
    warframe.supportedActions = [...WARFRAME_ACTIONS];
    providers.warframe = warframe;
  }
  return providers;
}

module.exports = { nativeProvidersFromConfig, WARFRAME_ACTIONS };
