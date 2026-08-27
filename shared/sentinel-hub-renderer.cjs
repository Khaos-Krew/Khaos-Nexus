'use strict';

const { healthLabel, normalizeHealthState } = require('./sentinel-health.cjs');

const EMBED_COLOR = 0xe3264f;

function cleanText(value, max = 1024, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveBannerUrl(bannerKey, bannerMap = {}) {
  const key = cleanText(bannerKey, 120);
  if (!key || !bannerMap || typeof bannerMap !== 'object') return null;
  const candidate = cleanText(bannerMap[key], 2048);
  if (!candidate) return null;
  if (/^https:\/\//i.test(candidate) || /^attachment:\/\//i.test(candidate)) return candidate;
  return null;
}

function renderSentinelHub({
  hub = {},
  state = {},
  bannerMap = {},
  now = new Date().toISOString(),
} = {}) {
  const title = cleanText(hub.name, 256, 'Khaos Nexus');
  const moduleId = cleanText(hub.moduleId, 100, 'discord-runtime');
  const description = cleanText(state.description, 3000, 'Khaos Nexus managed hub.');
  const refreshedAt = safeTimestamp(state.lastRefresh || now) || new Date().toISOString();
  const embed = {
    title,
    description,
    color: EMBED_COLOR,
    fields: [],
    footer: { text: `Khaos Nexus • ${moduleId}`.slice(0, 2048) },
    timestamp: refreshedAt,
  };

  if (hub.healthEnabled) {
    const normalized = normalizeHealthState(state.health);
    embed.fields.push({
      name: 'Service Status',
      value: healthLabel(normalized),
      inline: true,
    });
  }

  const freshness = cleanText(state.freshness, 200);
  if (freshness) {
    embed.fields.push({ name: 'Data Freshness', value: freshness, inline: true });
  }

  const moduleInfo = cleanText(state.moduleInfo, 900);
  if (moduleInfo) {
    embed.fields.push({ name: 'Module', value: moduleInfo, inline: false });
  }

  const bannerUrl = resolveBannerUrl(hub.bannerKey, bannerMap);
  if (bannerUrl) embed.image = { url: bannerUrl };

  // Deliberately whitelist only presentation fields above. Raw provider IDs,
  // credentials, passwords, tokens, connection strings, and adapter payloads
  // supplied in state are never serialized into a public hub payload.
  return Object.freeze({
    embeds: [Object.freeze(embed)],
    allowed_mentions: Object.freeze({ parse: [] }),
  });
}

module.exports = {
  EMBED_COLOR,
  cleanText,
  safeTimestamp,
  resolveBannerUrl,
  renderSentinelHub,
};
