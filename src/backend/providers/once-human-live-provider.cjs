'use strict';

const {
  OnceHumanProvider,
  ONCE_HUMAN_ACTIONS,
  OFFICIAL_NEWS_URL,
  clean
} = require('./once-human-provider.cjs');

const ONCE_HUMAN_STEAM_APP_ID = 2139460;
const STEAM_NEWS_URL = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${ONCE_HUMAN_STEAM_APP_ID}&count=12&maxlength=360&feeds=steam_community_announcements`;

function normalizeSteamNews(payload = {}) {
  const items = Array.isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
  return items.slice(0, 12).map((item) => ({
    title:clean(item?.title || 'Once Human announcement', 240),
    url:clean(item?.url || '', 500),
    date:Number(item?.date || 0) ? new Date(Number(item.date) * 1000).toISOString() : null,
    author:clean(item?.author || '', 100) || null,
    feed:clean(item?.feedlabel || item?.feedname || '', 120) || null,
    summary:clean(item?.contents || '', 360) || null
  })).filter((item) => item.url && item.title);
}

async function fetchSteamAnnouncements(fetchImpl, url = STEAM_NEWS_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers:{ accept:'application/json,*/*;q=0.5', 'user-agent':'Khaos-Nexus/0.1 Once Human news fallback' },
      signal:controller.signal
    });
    if (!response.ok) throw new Error(`Steam News HTTP ${response.status}`);
    return normalizeSteamNews(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

class LiveOnceHumanProvider extends OnceHumanProvider {
  constructor(options = {}) {
    super(options);
    this.steamNewsUrl = String(options.steamNewsUrl || STEAM_NEWS_URL);
    this.providerKind = 'official-public-web+steam-announcement-fallback+safe-local-companion';
    this.supportedActions = [...ONCE_HUMAN_ACTIONS];
  }

  async officialNews() {
    const primary = await super.officialNews();
    if (Array.isArray(primary?.items) && primary.items.length) return primary;

    if (typeof this.fetchImpl !== 'function') return primary;
    try {
      const items = await fetchSteamAnnouncements(this.fetchImpl, this.steamNewsUrl);
      if (!items.length) {
        return {
          ...primary,
          degraded:true,
          fallbackSource:'Steam app announcements',
          note:`${clean(primary?.note || '', 300)} Steam fallback was reachable but returned no announcement items.`.trim()
        };
      }
      return {
        source:'Once Human Official / Steam Announcements',
        url:primary?.url || OFFICIAL_NEWS_URL,
        items,
        degraded:false,
        fallback:true,
        fallbackSource:'Steam public ISteamNews app announcements',
        fallbackUrl:`https://store.steampowered.com/app/${ONCE_HUMAN_STEAM_APP_ID}/Once_Human/`,
        note:`${clean(primary?.note || 'Official Once Human news discovery was unavailable.', 220)} Sentinel is using the public Steam announcement feed for the official Once Human app until the primary page is readable again.`
      };
    } catch (error) {
      return {
        ...primary,
        degraded:true,
        fallbackSource:'Steam public ISteamNews app announcements',
        note:`${clean(primary?.note || '', 220)} Steam fallback is also temporarily unavailable (${clean(error?.message || error, 120)}).`.trim()
      };
    }
  }
}

module.exports = {
  ONCE_HUMAN_STEAM_APP_ID,
  STEAM_NEWS_URL,
  normalizeSteamNews,
  fetchSteamAnnouncements,
  LiveOnceHumanProvider
};
