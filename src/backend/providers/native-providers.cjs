'use strict';

const { WarframeProvider } = require('./warframe-provider.cjs');
const { Division2Provider, DIVISION2_ACTIONS } = require('./division2-provider.cjs');

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
  if (config.modules?.division2?.enabled !== false) {
    const division2 = new Division2Provider({ fetchImpl: options.fetchImpl });
    division2.supportedActions = [...DIVISION2_ACTIONS];
    providers.division2 = division2;
  }
  return providers;
}

module.exports = { nativeProvidersFromConfig, WARFRAME_ACTIONS, DIVISION2_ACTIONS };
