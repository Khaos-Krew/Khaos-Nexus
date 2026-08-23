'use strict';

const DEFAULT_WORLDSTATE_BASE = 'https://api.warframestat.us';
const DEFAULT_MARKET_BASE = 'https://api.warframe.market/v2';
const DEFAULT_TIMEOUT_MS = 10000;
const WARFRAME_ACTIONS = Object.freeze([
  'news', 'events', 'alerts', 'fissures', 'sortie', 'arbitration', 'nightwave',
  'invasions', 'void-trader', 'steel-path', 'kuva', 'cycles', 'market', 'builds'
]);

function cleanText(value, max = 220) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function marketSlug(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function takeArray(value, limit = 12) {
  return (Array.isArray(value) ? value : []).slice(0, limit);
}

function rewardText(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanText(value);
  return cleanText(value.asString || value.itemString || value.items?.join?.(', ') || value.countedItems?.map?.((item) => `${item.count || 1} ${item.type || ''}`).join(', ') || '');
}

function summarizeAlerts(data) {
  return takeArray(data, 12).map((alert) => ({
    node: cleanText(alert?.mission?.node || alert?.node || 'Unknown node'),
    type: cleanText(alert?.mission?.type || alert?.missionType || ''),
    faction: cleanText(alert?.mission?.faction || alert?.faction || ''),
    reward: rewardText(alert?.mission?.reward || alert?.reward),
    eta: cleanText(alert?.eta || ''),
    expired: Boolean(alert?.expired)
  }));
}

function summarizeFissures(data) {
  return takeArray(data, 40)
    .filter((item) => !item?.expired)
    .slice(0, 20)
    .map((item) => ({
      tier: cleanText(item?.tier || ''), node: cleanText(item?.node || ''), mission: cleanText(item?.missionType || ''),
      enemy: cleanText(item?.enemy || ''), eta: cleanText(item?.eta || ''), storm: Boolean(item?.isStorm), hard: Boolean(item?.isHard)
    }));
}

function summarizeSortie(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    boss: cleanText(data.boss || ''), faction: cleanText(data.faction || ''), eta: cleanText(data.eta || ''),
    variants: takeArray(data.variants, 6).map((variant) => ({
      node: cleanText(variant?.node || ''), mission: cleanText(variant?.missionType || ''),
      modifier: cleanText(variant?.modifier || variant?.modifierDescription || '')
    }))
  };
}

function summarizeArbitration(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    node: cleanText(data.node || ''), enemy: cleanText(data.enemy || ''), mission: cleanText(data.type || data.missionType || ''),
    eta: cleanText(data.eta || ''), expired: Boolean(data.expired)
  };
}

function summarizeNightwave(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    season: Number.isFinite(Number(data.season)) ? Number(data.season) : null,
    phase: Number.isFinite(Number(data.phase)) ? Number(data.phase) : null,
    tag: cleanText(data.tag || ''), eta: cleanText(data.eta || ''),
    challenges: takeArray(data.activeChallenges || data.challenges, 20).map((challenge) => ({
      title: cleanText(challenge?.title || ''), description: cleanText(challenge?.desc || challenge?.description || '', 320),
      reputation: Number(challenge?.reputation || 0), daily: Boolean(challenge?.isDaily || challenge?.daily),
      elite: Boolean(challenge?.isElite || challenge?.elite), eta: cleanText(challenge?.eta || '')
    }))
  };
}

function summarizeNews(data) {
  return takeArray(data, 12).map((item) => ({
    title: cleanText(item?.message || item?.title || ''), date: cleanText(item?.date || item?.timestamp || ''),
    link: cleanText(item?.link || '', 500), primeAccess: Boolean(item?.primeAccess), update: Boolean(item?.update)
  }));
}

function summarizeEvents(data) {
  return takeArray(data, 15).filter((item) => !item?.expired).map((item) => ({
    description: cleanText(item?.description || item?.name || item?.tooltip || ''), node: cleanText(item?.node || ''),
    eta: cleanText(item?.eta || ''), scoreLocTag: cleanText(item?.scoreLocTag || ''), health: Number(item?.health || 0) || null
  }));
}

function summarizeInvasions(data) {
  return takeArray(data, 15).filter((item) => !item?.completed).map((item) => ({
    node: cleanText(item?.node || ''), description: cleanText(item?.desc || item?.description || ''),
    attacker: cleanText(item?.attackingFaction || item?.attacker?.faction || ''), attackerReward: rewardText(item?.attacker?.reward),
    defender: cleanText(item?.defendingFaction || item?.defender?.faction || ''), defenderReward: rewardText(item?.defender?.reward),
    completion: Number(item?.completion || 0), eta: cleanText(item?.eta || '')
  }));
}

function summarizeVoidTrader(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    character: cleanText(data.character || 'Baro Ki\'Teer'), location: cleanText(data.location || ''),
    active: Boolean(data.active), activation: cleanText(data.activation || ''), expiry: cleanText(data.expiry || ''), eta: cleanText(data.eta || ''),
    inventory: takeArray(data.inventory, 20).map((item) => ({ item: cleanText(item?.item || ''), ducats: Number(item?.ducats || 0), credits: Number(item?.credits || 0) }))
  };
}

function summarizeSteelPath(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    currentReward: cleanText(data.currentReward?.name || data.currentReward || ''),
    remaining: cleanText(data.remaining || data.eta || ''),
    rotation: takeArray(data.rotation, 8).map((item) => ({ name: cleanText(item?.name || item), cost: Number(item?.cost || 0) || null }))
  };
}

function summarizeKuva(data) {
  return takeArray(data, 20).map((item) => ({
    node: cleanText(item?.node || ''), mission: cleanText(item?.type || item?.missionType || ''),
    enemy: cleanText(item?.enemy || ''), eta: cleanText(item?.eta || '')
  }));
}

function summarizeCycle(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    state: cleanText(data.state || data.cycle || ''), timeLeft: cleanText(data.timeLeft || data.eta || ''),
    shortString: cleanText(data.shortString || ''), isDay: data.isDay ?? null, isCetus: data.isCetus ?? null
  };
}

function summarizeMarketOrder(order) {
  return {
    platinum: Number(order?.platinum || 0), quantity: Number(order?.quantity || 0), rank: order?.rank ?? null,
    user: cleanText(order?.user?.ingameName || order?.user?.ingame_name || order?.user?.slug || ''),
    status: cleanText(order?.user?.status || order?.user?.lastSeen || '')
  };
}

function firstData(value) {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data.slice(0, 5);
  if (Array.isArray(data?.items)) return data.items.slice(0, 5);
  return data;
}

class WarframeProvider {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('Warframe provider requires fetch support.');
    this.platform = cleanText(options.platform || process.env.NEXUS_WARFRAME_PLATFORM || 'pc', 20).toLowerCase() || 'pc';
    this.marketPlatform = cleanText(options.marketPlatform || process.env.NEXUS_WARFRAME_MARKET_PLATFORM || 'pc', 20).toLowerCase() || 'pc';
    this.worldstateBase = String(options.worldstateBase || DEFAULT_WORLDSTATE_BASE).replace(/\/$/, '');
    this.marketBase = String(options.marketBase || DEFAULT_MARKET_BASE).replace(/\/$/, '');
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    this.native = true;
    this.connected = false;
    this.providerKind = 'public-data';
    this.supportedActions = [...WARFRAME_ACTIONS];
  }

  async requestJson(url, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'Khaos-Nexus/0.1 Warframe backend', ...headers },
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Warframe data request failed with HTTP ${response.status}.`);
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Warframe data request timed out after ${this.timeoutMs} ms.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  worldstateUrl(pathname) {
    return `${this.worldstateBase}/${encodeURIComponent(this.platform)}/${pathname}?language=en`;
  }

  async worldstate(pathname) { return this.requestJson(this.worldstateUrl(pathname)); }

  async market(payload = {}) {
    const input = cleanText(payload.item || payload.query || payload.input || '', 120);
    if (!input) return { usage: 'Use /nexus run module:warframe action:market input:<item name>.', example: 'Arcane Energize' };
    const slug = marketSlug(input);
    if (!slug) throw new Error('Enter a valid Warframe Market item name.');
    const body = await this.requestJson(`${this.marketBase}/orders/item/${encodeURIComponent(slug)}/top`, { Platform: this.marketPlatform });
    const data = body?.data || {};
    return { item: input, slug, sell: takeArray(data.sell, 5).map(summarizeMarketOrder), buy: takeArray(data.buy, 5).map(summarizeMarketOrder) };
  }

  async builds(payload = {}) {
    const input = cleanText(payload.query || payload.input || '', 120);
    if (!input) {
      return { usage: 'Use /nexus run module:warframe action:builds input:<frame, weapon, or mod>.', examples: ['Gyre', 'Torid', 'Cathode Current'] };
    }
    const query = encodeURIComponent(input);
    const [warframes, weapons, mods] = await Promise.all([
      this.requestJson(`${this.worldstateBase}/warframes/search/${query}`).catch(() => []),
      this.requestJson(`${this.worldstateBase}/weapons/search/${query}`).catch(() => []),
      this.requestJson(`${this.worldstateBase}/mods/search/${query}`).catch(() => [])
    ]);
    return { query: input, warframes: firstData(warframes), weapons: firstData(weapons), mods: firstData(mods) };
  }

  async cycles() {
    const paths = { earth: 'earthCycle', cetus: 'cetusCycle', cambion: 'cambionCycle', zariman: 'zarimanCycle', duviri: 'duviriCycle' };
    const entries = await Promise.all(Object.entries(paths).map(async ([name, pathname]) => [name, summarizeCycle(await this.worldstate(pathname))]));
    return Object.fromEntries(entries);
  }

  async invoke(actionId, payload = {}) {
    switch (actionId) {
      case 'news': return { platform: this.platform, news: summarizeNews(await this.worldstate('news')) };
      case 'events': return { platform: this.platform, events: summarizeEvents(await this.worldstate('events')) };
      case 'alerts': return { platform: this.platform, alerts: summarizeAlerts(await this.worldstate('alerts')) };
      case 'fissures': return { platform: this.platform, fissures: summarizeFissures(await this.worldstate('fissures')) };
      case 'sortie': return { platform: this.platform, sortie: summarizeSortie(await this.worldstate('sortie')) };
      case 'arbitration': return { platform: this.platform, arbitration: summarizeArbitration(await this.worldstate('arbitration')) };
      case 'nightwave': return { platform: this.platform, nightwave: summarizeNightwave(await this.worldstate('nightwave')) };
      case 'invasions': return { platform: this.platform, invasions: summarizeInvasions(await this.worldstate('invasions')) };
      case 'void-trader': return { platform: this.platform, voidTrader: summarizeVoidTrader(await this.worldstate('voidTrader')) };
      case 'steel-path': return { platform: this.platform, steelPath: summarizeSteelPath(await this.worldstate('steelPath')) };
      case 'kuva': return { platform: this.platform, kuva: summarizeKuva(await this.worldstate('kuva')) };
      case 'cycles': return { platform: this.platform, cycles: await this.cycles() };
      case 'market': return this.market(payload);
      case 'builds': return this.builds(payload);
      default: throw new Error(`Warframe provider does not support ${actionId}.`);
    }
  }
}

module.exports = {
  WarframeProvider, WARFRAME_ACTIONS, cleanText, marketSlug, summarizeAlerts, summarizeFissures,
  summarizeSortie, summarizeArbitration, summarizeNightwave, summarizeNews, summarizeEvents,
  summarizeInvasions, summarizeVoidTrader, summarizeSteelPath, summarizeKuva, summarizeCycle, summarizeMarketOrder
};
