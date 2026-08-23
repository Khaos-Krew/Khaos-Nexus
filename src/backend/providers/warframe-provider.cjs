'use strict';

const DEFAULT_WORLDSTATE_BASE = 'https://api.warframestat.us';
const DEFAULT_MARKET_BASE = 'https://api.warframe.market/v2';
const DEFAULT_TIMEOUT_MS = 10000;

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function marketSlug(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function compact(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null);
  return value;
}

function summarizeAlerts(data) {
  const alerts = Array.isArray(data) ? data : [];
  return alerts.slice(0, 12).map((alert) => ({
    node: cleanText(alert?.mission?.node || alert?.node || 'Unknown node'),
    type: cleanText(alert?.mission?.type || alert?.missionType || ''),
    faction: cleanText(alert?.mission?.faction || alert?.faction || ''),
    reward: cleanText(alert?.mission?.reward?.asString || alert?.mission?.reward?.itemString || alert?.reward || ''),
    eta: cleanText(alert?.eta || ''),
    expired: Boolean(alert?.expired)
  }));
}

function summarizeFissures(data) {
  const fissures = Array.isArray(data) ? data : [];
  return fissures
    .filter((item) => !item?.expired)
    .slice(0, 20)
    .map((item) => ({
      tier: cleanText(item?.tier || ''),
      node: cleanText(item?.node || ''),
      mission: cleanText(item?.missionType || ''),
      enemy: cleanText(item?.enemy || ''),
      eta: cleanText(item?.eta || ''),
      storm: Boolean(item?.isStorm)
    }));
}

function summarizeSortie(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    boss: cleanText(data.boss || ''),
    faction: cleanText(data.faction || ''),
    eta: cleanText(data.eta || ''),
    variants: compact((data.variants || []).slice(0, 6).map((variant) => ({
      node: cleanText(variant?.node || ''),
      mission: cleanText(variant?.missionType || ''),
      modifier: cleanText(variant?.modifier || variant?.modifierDescription || '')
    })))
  };
}

function summarizeArbitration(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    node: cleanText(data.node || ''),
    enemy: cleanText(data.enemy || ''),
    mission: cleanText(data.type || data.missionType || ''),
    eta: cleanText(data.eta || ''),
    expired: Boolean(data.expired)
  };
}

function summarizeNightwave(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    season: Number.isFinite(Number(data.season)) ? Number(data.season) : null,
    phase: Number.isFinite(Number(data.phase)) ? Number(data.phase) : null,
    tag: cleanText(data.tag || ''),
    eta: cleanText(data.eta || ''),
    challenges: (data.activeChallenges || data.challenges || []).slice(0, 20).map((challenge) => ({
      title: cleanText(challenge?.title || ''),
      description: cleanText(challenge?.desc || challenge?.description || '', 260),
      reputation: Number(challenge?.reputation || 0),
      daily: Boolean(challenge?.isDaily || challenge?.daily),
      elite: Boolean(challenge?.isElite || challenge?.elite),
      eta: cleanText(challenge?.eta || '')
    }))
  };
}

function summarizeMarketOrder(order) {
  return {
    platinum: Number(order?.platinum || 0),
    quantity: Number(order?.quantity || 0),
    rank: order?.rank ?? null,
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

  worldstateUrl(path) {
    return `${this.worldstateBase}/${encodeURIComponent(this.platform)}/${path}?language=en`;
  }

  async worldstate(path) {
    return this.requestJson(this.worldstateUrl(path));
  }

  async market(payload = {}) {
    const input = cleanText(payload.item || payload.query || payload.input || '', 120);
    if (!input) {
      return {
        usage: 'Use /nexus run module:warframe action:market input:<item name>.',
        example: 'Arcane Energize'
      };
    }
    const slug = marketSlug(input);
    if (!slug) throw new Error('Enter a valid Warframe Market item name.');
    const body = await this.requestJson(`${this.marketBase}/orders/item/${encodeURIComponent(slug)}/top`, { Platform: this.marketPlatform });
    const data = body?.data || {};
    return {
      item: input,
      slug,
      sell: (data.sell || []).slice(0, 5).map(summarizeMarketOrder),
      buy: (data.buy || []).slice(0, 5).map(summarizeMarketOrder)
    };
  }

  async builds(payload = {}) {
    const input = cleanText(payload.query || payload.input || '', 120);
    if (!input) {
      return {
        usage: 'Use /nexus run module:warframe action:builds input:<frame, weapon, or mod>.',
        examples: ['Gyre', 'Torid', 'Cathode Current'],
        note: 'This backend helper resolves live Warframe data so build recommendations can be layered on top without the desktop app.'
      };
    }
    const query = encodeURIComponent(input);
    const [warframes, weapons, mods] = await Promise.all([
      this.requestJson(`${this.worldstateBase}/warframes/search/${query}`).catch(() => []),
      this.requestJson(`${this.worldstateBase}/weapons/search/${query}`).catch(() => []),
      this.requestJson(`${this.worldstateBase}/mods/search/${query}`).catch(() => [])
    ]);
    return {
      query: input,
      warframes: firstData(warframes),
      weapons: firstData(weapons),
      mods: firstData(mods)
    };
  }

  async invoke(actionId, payload = {}) {
    switch (actionId) {
      case 'alerts': return { platform: this.platform, alerts: summarizeAlerts(await this.worldstate('alerts')) };
      case 'fissures': return { platform: this.platform, fissures: summarizeFissures(await this.worldstate('fissures')) };
      case 'sortie': return { platform: this.platform, sortie: summarizeSortie(await this.worldstate('sortie')) };
      case 'arbitration': return { platform: this.platform, arbitration: summarizeArbitration(await this.worldstate('arbitration')) };
      case 'nightwave': return { platform: this.platform, nightwave: summarizeNightwave(await this.worldstate('nightwave')) };
      case 'market': return this.market(payload);
      case 'builds': return this.builds(payload);
      default: throw new Error(`Warframe provider does not support ${actionId}.`);
    }
  }
}

module.exports = {
  WarframeProvider,
  cleanText,
  marketSlug,
  summarizeAlerts,
  summarizeFissures,
  summarizeSortie,
  summarizeArbitration,
  summarizeNightwave,
  summarizeMarketOrder
};
