'use strict';

const { WarframeProvider, WARFRAME_ACTIONS } = require('./warframe-provider.cjs');
const { Division2Provider, DIVISION2_ACTIONS } = require('./division2-provider.cjs');
const { IdleOnProvider, IDLEON_ACTIONS } = require('./idleon-provider.cjs');
const { PokemonGoProvider, POGO_ACTIONS } = require('./pokemon-go-provider.cjs');
const { attachOfficialPokemonGoEvents } = require('./pokemon-go-official-events.cjs');
const {
  DeadByDaylightProvider, Diablo4Provider, CallOfDutyProvider,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS
} = require('./game-companion-providers.cjs');

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

  if (config.modules?.deadbydaylight?.enabled !== false) {
    providers.deadbydaylight = new DeadByDaylightProvider({
      stateFile: config.modules?.deadbydaylight?.stateFile,
      catalogBase: config.modules?.deadbydaylight?.catalogBase,
      statsBase: config.modules?.deadbydaylight?.statsBase,
      fetchImpl: options.fetchImpl
    });
  }

  if (config.modules?.diablo4?.enabled !== false) {
    providers.diablo4 = new Diablo4Provider({
      stateFile: config.modules?.diablo4?.stateFile,
      newsUrl: config.modules?.diablo4?.newsUrl
    });
  }

  if (config.modules?.callofduty?.enabled !== false) {
    providers.callofduty = new CallOfDutyProvider({
      stateFile: config.modules?.callofduty?.stateFile,
      newsUrl: config.modules?.callofduty?.newsUrl
    });
  }

  return providers;
}

module.exports = {
  nativeProvidersFromConfig,
  WARFRAME_ACTIONS, DIVISION2_ACTIONS, IDLEON_ACTIONS, POGO_ACTIONS,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS
};
