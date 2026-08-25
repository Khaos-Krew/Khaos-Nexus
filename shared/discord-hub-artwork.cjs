'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateDiscordMessagePayload } = require('./discord-message-payload.cjs');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'assets', 'discord', 'hub-banners', 'hub-banners.manifest.json');
const DEFAULT_BANNER_ROOT = path.dirname(DEFAULT_MANIFEST_PATH);
const MAX_HUBS = 100;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}
function normalizeId(value, prefix = 'hub') {
  const raw = String(value || '').trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]{0,79}$/.test(raw)) return raw;
  return `${prefix}-${crypto.randomUUID()}`;
}
function normalizeSnowflake(value) {
  const text = String(value || '').trim();
  return /^\d{5,25}$/.test(text) ? text : '';
}
function normalizeColor(value, fallback = '#e3264f') {
  const raw = String(value || '').trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}
function normalizeWebUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().slice(0, 2048) : '';
  } catch { return ''; }
}
function normalizeRelativePath(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text || text.startsWith('/') || /^[A-Za-z]:\//.test(text)) return '';
  const normalized = path.posix.normalize(text);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return '';
  return normalized.replace(/^\.\//, '').slice(0, 240);
}
function normalizeField(field = {}) {
  const name = cleanText(field.name, 256);
  const value = cleanText(field.value, 1024);
  return name && value ? { name, value, inline: Boolean(field.inline) } : null;
}
function normalizeBannerAsset(key, input = {}) {
  return {
    key: normalizeId(key, 'banner'),
    kind: input.kind === 'game' ? 'game' : 'hub',
    enabled: input.enabled !== false,
    localPath: normalizeRelativePath(input.localPath),
    runtimeUrl: normalizeWebUrl(input.runtimeUrl),
    fallbackUrl: normalizeWebUrl(input.fallbackUrl),
    driveFolderId: cleanText(input.driveFolderId, 160),
    driveFileId: cleanText(input.driveFileId, 160),
    version: Math.max(1, Number.parseInt(input.version, 10) || 1),
    altText: cleanText(input.altText, 300)
  };
}
function normalizeManifest(input = {}) {
  const banners = {};
  for (const [key, value] of Object.entries(input.banners && typeof input.banners === 'object' ? input.banners : {})) {
    const normalized = normalizeBannerAsset(key, value);
    banners[normalized.key] = normalized;
  }
  const hubAssignments = {};
  for (const [hubId, bannerKey] of Object.entries(input.hubAssignments && typeof input.hubAssignments === 'object' ? input.hubAssignments : {})) {
    const cleanHubId = normalizeId(hubId, 'hub');
    const cleanBannerKey = String(bannerKey || '').trim().toLowerCase();
    if (banners[cleanBannerKey]) hubAssignments[cleanHubId] = cleanBannerKey;
  }
  return {
    schemaVersion: 1,
    updatedAt: input.updatedAt ? String(input.updatedAt) : null,
    storage: clone(input.storage && typeof input.storage === 'object' ? input.storage : {}),
    hubAssignments,
    banners
  };
}
function loadHubBannerManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return normalizeManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
}
function normalizeHub(input = {}) {
  const fields = (Array.isArray(input.fields) ? input.fields : []).map(normalizeField).filter(Boolean).slice(0, 25);
  return {
    id: normalizeId(input.id, 'hub'),
    name: cleanText(input.name, 80, 'Khaos Nexus Hub'),
    title: cleanText(input.title, 256, input.name || 'Khaos Nexus'),
    description: cleanText(input.description, 4096, 'Khaos Nexus community hub.'),
    color: normalizeColor(input.color),
    bannerKey: cleanText(input.bannerKey, 80).toLowerCase(),
    footerText: cleanText(input.footerText, 2048, 'Khaos Nexus • Managed by Sentinel'),
    guildId: normalizeSnowflake(input.guildId),
    channelId: normalizeSnowflake(input.channelId),
    messageId: normalizeSnowflake(input.messageId),
    enabled: input.enabled !== false,
    fields,
    publishedAt: input.publishedAt ? String(input.publishedAt) : null,
    refreshedAt: input.refreshedAt ? String(input.refreshedAt) : null
  };
}
function defaultDiscordHubConfig() { return { schemaVersion: 1, hubs: [] }; }
function normalizeDiscordHubConfig(input = {}) {
  const hubs = [];
  const seen = new Set();
  for (const source of Array.isArray(input.hubs) ? input.hubs : []) {
    const hub = normalizeHub(source);
    if (seen.has(hub.id)) continue;
    seen.add(hub.id);
    hubs.push(hub);
  }
  return { schemaVersion: 1, hubs: hubs.slice(0, MAX_HUBS) };
}
function safeLocalFile(localPath, bannerRoot = DEFAULT_BANNER_ROOT) {
  if (!localPath) return '';
  const root = path.resolve(bannerRoot);
  const resolved = path.resolve(root, localPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return '';
  return resolved;
}
function attachmentName(key, localPath) {
  const ext = path.extname(localPath || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.png';
  return `${String(key || 'hub-banner').replace(/[^a-z0-9_-]/gi, '-').slice(0, 70)}${ext}`;
}
function resolveBannerForHub(hubInput, manifestInput, options = {}) {
  const hub = normalizeHub(hubInput);
  const manifest = normalizeManifest(manifestInput);
  const key = manifest.hubAssignments[hub.id] || hub.bannerKey;
  const asset = key ? manifest.banners[key] : null;
  if (!asset || !asset.enabled) return { key: key || '', asset: asset || null, mode: 'none', imageUrl: '', localFile: '', attachmentName: '' };
  const localFile = safeLocalFile(asset.localPath, options.bannerRoot || DEFAULT_BANNER_ROOT);
  if (localFile && fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
    const name = attachmentName(asset.key, asset.localPath);
    return { key: asset.key, asset, mode: 'attachment', imageUrl: `attachment://${name}`, localFile, attachmentName: name };
  }
  const imageUrl = asset.runtimeUrl || asset.fallbackUrl || '';
  return { key: asset.key, asset, mode: imageUrl ? 'remote' : 'missing', imageUrl, localFile: '', attachmentName: '' };
}
function validateHubPayload(payload) {
  const validationCopy = clone(payload);
  for (const embed of validationCopy.embeds || []) {
    for (const container of [embed.image, embed.thumbnail]) {
      if (container?.url?.startsWith('attachment://')) container.url = 'https://local.khaos.invalid/banner.png';
    }
    if (embed.footer?.icon_url?.startsWith('attachment://')) embed.footer.icon_url = 'https://local.khaos.invalid/icon.png';
  }
  validateDiscordMessagePayload(validationCopy, { label: 'Sentinel hub payload' });
  return payload;
}
function renderHubMessage(hubInput, manifestInput, options = {}) {
  const hub = normalizeHub(hubInput);
  const banner = resolveBannerForHub(hub, manifestInput, options);
  const embed = {
    title: hub.title,
    description: hub.description,
    color: Number.parseInt(hub.color.slice(1), 16),
    footer: { text: hub.footerText }
  };
  if (hub.fields.length) embed.fields = hub.fields;
  if (banner.imageUrl) embed.image = { url: banner.imageUrl };
  const payload = validateHubPayload({ embeds: [embed], allowed_mentions: { parse: [] } });
  const files = banner.mode === 'attachment' ? [{ path: banner.localFile, name: banner.attachmentName }] : [];
  return { hub, banner, payload, files };
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  DEFAULT_BANNER_ROOT,
  MAX_HUBS,
  normalizeId,
  normalizeSnowflake,
  normalizeColor,
  normalizeWebUrl,
  normalizeRelativePath,
  normalizeBannerAsset,
  normalizeManifest,
  loadHubBannerManifest,
  normalizeHub,
  defaultDiscordHubConfig,
  normalizeDiscordHubConfig,
  resolveBannerForHub,
  validateHubPayload,
  renderHubMessage
};
