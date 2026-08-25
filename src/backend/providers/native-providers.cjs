'use strict';

const { WarframeProvider, WARFRAME_ACTIONS } = require('./warframe-provider.cjs');
const { LiveDivision2Provider: Division2Provider, DIVISION2_ACTIONS } = require('./division2-live-provider.cjs');
const { IdleOnProvider, IDLEON_ACTIONS } = require('./idleon-provider.cjs');
const { PokemonGoProvider, POGO_ACTIONS } = require('./pokemon-go-provider.cjs');
const { attachOfficialPokemonGoEvents } = require('./pokemon-go-official-events.cjs');
const { createRuneScapeProviders, RS_ACTIONS } = require('./runescape-provider.cjs');
const { OnceHumanProvider, ONCE_HUMAN_ACTIONS } = require('./once-human-provider.cjs');
const {
  DeadByDaylightProvider,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS
} = require('./game-companion-providers.cjs');
const {
  EnhancedDiablo4Provider: Diablo4Provider,
  EnhancedCallOfDutyProvider: CallOfDutyProvider
} = require('./news-enhanced-providers.cjs');

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
      targetedLootUrl: config.modules?.division2?.targetedLootUrl,
      targetedPageUrl: config.modules?.division2?.targetedPageUrl,
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

  if (config.modules?.osrs?.enabled !== false || config.modules?.runescape3?.enabled !== false) {
    const runescape = createRuneScapeProviders({
      stateFile: config.modules?.runescape?.stateFile || config.modules?.osrs?.stateFile || config.modules?.runescape3?.stateFile,
      userAgent: config.modules?.runescape?.userAgent,
      osrsWikiApi: config.modules?.osrs?.wikiApi,
      rs3WikiApi: config.modules?.runescape3?.wikiApi,
      osrsPriceBase: config.modules?.osrs?.priceBase,
      rs3GeBase: config.modules?.runescape3?.geBase,
      fetchImpl: options.fetchImpl
    });
    if (config.modules?.osrs?.enabled !== false) providers.osrs = runescape.osrs;
    if (config.modules?.runescape3?.enabled !== false) providers.runescape3 = runescape.runescape3;
  }

  if (config.modules?.oncehuman?.enabled !== false) {
    providers.oncehuman = new OnceHumanProvider({
      stateFile: config.modules?.oncehuman?.stateFile,
      newsUrl: config.modules?.oncehuman?.newsUrl,
      userAgent: config.modules?.oncehuman?.userAgent,
      fetchImpl: options.fetchImpl
    });
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
      newsUrl: config.modules?.diablo4?.newsUrl,
      fetchImpl: options.fetchImpl
    });
  }

  if (config.modules?.callofduty?.enabled !== false) {
    providers.callofduty = new CallOfDutyProvider({
      stateFile: config.modules?.callofduty?.stateFile,
      newsUrl: config.modules?.callofduty?.newsUrl,
      fetchImpl: options.fetchImpl
    });
  }

  return providers;
}

module.exports = {
  nativeProvidersFromConfig,
  WARFRAME_ACTIONS, DIVISION2_ACTIONS, IDLEON_ACTIONS, POGO_ACTIONS,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS,
  RS_ACTIONS, ONCE_HUMAN_ACTIONS
};
