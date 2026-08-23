'use strict';

const { WarframeProvider, WARFRAME_ACTIONS } = require('./warframe-provider.cjs');
const { Division2Provider, DIVISION2_ACTIONS } = require('./division2-provider.cjs');
const { IdleOnProvider, IDLEON_ACTIONS } = require('./idleon-provider.cjs');
const { PokemonGoProvider, POGO_ACTIONS } = require('./pokemon-go-provider.cjs');
const { attachOfficialPokemonGoEvents } = require('./pokemon-go-official-events.cjs');

function nativeProvidersFromConfig(config = {}, options = {}) {
  const providers = {};

  if (config.modules?.warframe?.enabled !== false) {
    providers.warframe = new WarframeProvider({
      platform: config.modules?.warframe?.platform,
      marketPlatform: config.modules?.warframe?.marketPlatform,
      worldstateBase: config.modules?.warframe?.worldstateBase,
      marketBase: config.modules?.warframe?.marketBase,
      fetchImpl: options.fetchImpl
    });
  }

  if (config.modules?.division2?.enabled !== false) {
    providers.division2 = new Division2Provider({
      baseUrl: config.modules?.division2?.dataBaseUrl,
      newsUrl: config.modules?.division2?.newsUrl,
      stateFile: config.modules?.division2?.stateFile,
      fetchImpl: options.fetchImpl
    });
  }

  if (config.modules?.idleon?.enabled !== false) {
    providers.idleon = new IdleOnProvider({ stateFile: config.modules?.idleon?.stateFile });
  }

  if (config.modules?.pokemongo?.enabled !== false) {
    providers.pokemongo = attachOfficialPokemonGoEvents(
      new PokemonGoProvider({ stateFile: config.modules?.pokemongo?.stateFile }),
      { fetchImpl: options.fetchImpl, newsUrl: config.modules?.pokemongo?.newsUrl }
    );
  }

  return providers;
}

module.exports = { nativeProvidersFromConfig, WARFRAME_ACTIONS, DIVISION2_ACTIONS, IDLEON_ACTIONS, POGO_ACTIONS };
