'use strict';

const { MessageFlags } = require('discord.js');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');

const CREATOR_POST_LIMIT = 3;
const CREATOR_POST_WINDOW_MS = 24 * 60 * 60 * 1000;
const CREATOR_FEED_NAME = 'creator-feed';
const CREATOR_ROLE_NAME = 'Content Creator';
const STREAM_ALERTS_ROLE_NAME = 'Stream Alerts';
const TIKTOK_OEMBED_ORIGIN = 'https://www.tiktok.com/oembed';
const YOUTUBE_OEMBED_ORIGIN = 'https://www.youtube.com/oembed';
const TIKTOK_HOSTS = new Set(['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']);
const TWITCH_RESERVED = new Set(['directory', 'videos', 'video', 'settings', 'subscriptions', 'downloads', 'jobs', 'search', 'p', 'clip', 'clips', 'popout', 'embed', 'moderator', 'products']);

function creatorPostEnabled(env = process.env) {
  const raw = env?.CREATOR_POST_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

function parsePlatforms(value) {
  const text = String(value || '').toLowerCase();
  const platforms = [];
  if (/twitch/.test(text)) platforms.push('twitch');
  if (/youtube|you tube|youtu\.be|\byt\b/.test(text)) platforms.push('youtube');
  if (/tiktok|tik tok|\btt\b/.test(text)) platforms.push('tiktok');
  return platforms.length ? platforms : ['other'];
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeTikTokHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeTwitchLogin(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function compactIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9]+/g, '');
}

function cleanText(value, max) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function parseHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 500 || /[\s\u0000]/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url;
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function extractCreatorHandles(platformText = '', channelRef = '') {
  const text = `${platformText || ''}\n${channelRef || ''}`;
  const handles = { twitch: '', youtube: '', tiktok: '' };
  const platforms = parsePlatforms(platformText);

  const tiktokUrl = text.match(/tiktok\.com\/@([A-Za-z0-9._]{2,24})/i);
  if (tiktokUrl) handles.tiktok = normalizeTikTokHandle(tiktokUrl[1]);
  if (!handles.tiktok) {
    const labeled = text.match(/(?:tiktok|tik tok|\btt\b)\s*[:\-]?\s*@([A-Za-z0-9._]{2,24})/i);
    if (labeled) handles.tiktok = normalizeTikTokHandle(labeled[1]);
  }

  const twitchUrl = text.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})/i);
  if (twitchUrl && !TWITCH_RESERVED.has(twitchUrl[1].toLowerCase())) handles.twitch = normalizeTwitchLogin(twitchUrl[1]);

  const ytHandle = text.match(/youtube\.com\/@([^/?#\s]+)/i);
  const ytChannel = text.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/);
  const ytCustom = text.match(/youtube\.com\/(?:c|user)\/([^/?#\s]+)/i);
  if (ytHandle) handles.youtube = `@${decodePart(ytHandle[1])}`;
  else if (ytChannel) handles.youtube = ytChannel[1];
  else if (ytCustom) handles.youtube = decodePart(ytCustom[1]);

  const only = platforms.length === 1 ? platforms[0] : '';
  const bare = String(channelRef || '').trim().match(/^@?([A-Za-z0-9._]{2,80})$/);
  if (bare && only === 'tiktok' && !handles.tiktok) handles.tiktok = normalizeTikTokHandle(bare[1]);
  if (bare && only === 'twitch' && !handles.twitch && !TWITCH_RESERVED.has(bare[1].toLowerCase())) handles.twitch = normalizeTwitchLogin(bare[1]);
  if (bare && only === 'youtube' && !handles.youtube) handles.youtube = bare[1];
  return handles;
}

function youtubeKeys(value) {
  const text = String(value || '').trim();
  const keys = new Set();
  if (!text) return keys;
  const handle = text.match(/youtube\.com\/@([^/?#\s]+)/i);
  if (handle) keys.add(`h:${compactIdentity(decodePart(handle[1]))}`);
  const channel = text.match(/youtube\.com\/channel\/([^/?#\s]+)/i);
  if (channel) keys.add(`c:${channel[1]}`);
  const custom = text.match(/youtube\.com\/(?:c|user)\/([^/?#\s]+)/i);
  if (custom) keys.add(`h:${compactIdentity(decodePart(custom[1]))}`);
  if (!/^https?:\/\//i.test(text)) {
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(text)) keys.add(`c:${text}`);
    else {
      const compact = compactIdentity(text);
      if (compact.length >= 2) keys.add(`h:${compact}`);
    }
  }
  return keys;
}

function tiktokAuthorMatches(oembed, savedHandle) {
  const saved = normalizeTikTokHandle(savedHandle);
  const unique = normalizeTikTokHandle(oembed?.author_unique_id);
  if (!saved || !unique) return false;
  return saved === unique;
}

function youtubeAuthorMatches(savedChannel, oembed) {
  const saved = youtubeKeys(savedChannel);
  if (!saved.size) return false;
  const author = new Set([
    ...youtubeKeys(oembed?.author_url || ''),
    ...youtubeKeys(oembed?.author_name || '')
  ]);
  for (const key of saved) {
    if (author.has(key)) return true;
  }
  return false;
}

function twitchLoginFromUrl(value) {
  const url = typeof value === 'string' ? parseHttpsUrl(value) : value;
  if (!url) return '';
  const host = hostOf(url);
  if (host === 'clips.twitch.tv') return '';
  if (host !== 'twitch.tv' && host !== 'm.twitch.tv') return '';
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) return '';
  const login = normalizeTwitchLogin(decodePart(parts[0]));
  if (TWITCH_RESERVED.has(login) || !/^[a-z0-9_]{3,25}$/.test(login)) return '';
  return login;
}

function canonicalPostUrl(value) {
  const url = typeof value === 'string' ? parseHttpsUrl(value) : value;
  if (!url) return '';
  const host = hostOf(url).replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://youtube.com/watch?v=${id}` : '';
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    let id = '';
    if (parts[0] === 'watch') id = url.searchParams.get('v') || '';
    else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] || '')) id = parts[1] || '';
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://youtube.com/watch?v=${id}` : '';
  }
  if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    const parts = decodePart(url.pathname).split('/').filter(Boolean);
    const videoAt = parts.findIndex((part) => part.toLowerCase() === 'video');
    if (videoAt >= 0 && parts[videoAt + 1]) {
      const user = String(parts[0] || '').toLowerCase();
      const id = String(parts[videoAt + 1]).split('?')[0];
      return user.startsWith('@') ? `https://tiktok.com/${user}/video/${id}` : `https://tiktok.com/video/${id}`;
    }
    const path = url.pathname.replace(/\/+$/, '');
    return path && path !== '/' ? `https://${host}${path}` : '';
  }
  if (host === 'twitch.tv' || host === 'clips.twitch.tv') {
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return path && path !== '/' ? `https://${host}${path}` : '';
  }
  return '';
}

function classifyCreatorPostUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url) return null;
  const host = hostOf(url);
  const canonicalUrl = canonicalPostUrl(url);
  if (!canonicalUrl) return null;
  if (TIKTOK_HOSTS.has(host)) return { platform: 'tiktok', canonicalUrl, rawUrl: url.toString(), login: '' };
  if (YOUTUBE_HOSTS.has(host)) return { platform: 'youtube', canonicalUrl, rawUrl: url.toString(), login: '' };
  if (TWITCH_HOSTS.has(host)) return { platform: 'twitch', canonicalUrl, rawUrl: url.toString(), login: twitchLoginFromUrl(url) };
  return null;
}

function postsWithinWindow(entries, userId, nowMs = Date.now()) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (String(entry?.userId || '') !== String(userId || '')) return false;
    const at = Date.parse(entry?.createdAt || '');
    if (!Number.isFinite(at) || nowMs < at) return false;
    return nowMs - at < CREATOR_POST_WINDOW_MS;
  });
}

function creatorPostRateLimit(entries, userId, nowMs = Date.now()) {
  const count = postsWithinWindow(entries, userId, nowMs).length;
  return { count, limit: CREATOR_POST_LIMIT, limited: count >= CREATOR_POST_LIMIT };
}

function creatorPostDuplicate(entries, canonicalUrl) {
  const key = String(canonicalUrl || '');
  if (!key) return false;
  return (Array.isArray(entries) ? entries : []).some((entry) => String(entry?.normalizedUrl || '') === key);
}

function savedHandle(profile, platform) {
  const stored = profile?.handles?.[platform];
  if (String(stored || '').trim()) return String(stored).trim();
  const extracted = extractCreatorHandles(profile?.platformText, profile?.channelRef);
  return String(extracted[platform] || '').trim();
}

function platformLabel(platform) {
  if (platform === 'tiktok') return 'TikTok';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'twitch') return 'Twitch';
  return 'Creator';
}

function cleanTitle(value) {
  return cleanText(String(value || '').replace(/@(everyone|here)/gi, '@\u200b$1'), 256);
}

function creatorFeedPostPayload({ userId, platform, url, title = '', roleId = '' } = {}) {
  const label = platformLabel(platform);
  const mention = /^\d{15,24}$/.test(String(roleId || '')) ? `<@&${roleId}>` : '';
  const embed = {
    title: cleanTitle(title) || `${label} post`,
    url: String(url || ''),
    color: 0xe3264f,
    fields: [
      { name: 'Creator', value: `<@${userId}>`, inline: true },
      { name: 'Platform', value: label, inline: true },
      { name: 'Link', value: cleanText(url, 1024), inline: false }
    ],
    footer: { text: 'Nexus Sentinal • Creator Feed' }
  };
  return {
    ...(mention ? { content: mention } : {}),
    embeds: [embed],
    allowedMentions: mention ? { parse: [], roles: [String(roleId)] } : { parse: [] }
  };
}

function oEmbedEndpoint(platform, postUrl) {
  if (platform === 'tiktok') {
    const endpoint = new URL(TIKTOK_OEMBED_ORIGIN);
    endpoint.searchParams.set('url', postUrl);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'www.tiktok.com' || endpoint.pathname !== '/oembed') return '';
    return endpoint.toString();
  }
  if (platform === 'youtube') {
    const endpoint = new URL(YOUTUBE_OEMBED_ORIGIN);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('url', postUrl);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'www.youtube.com' || endpoint.pathname !== '/oembed') return '';
    return endpoint.toString();
  }
  return '';
}

async function fetchOEmbed(platform, postUrl, fetchImpl) {
  const endpoint = oEmbedEndpoint(platform, postUrl);
  if (!endpoint || typeof fetchImpl !== 'function') return { ok: false, data: null };
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'KhaosNexusSentinal/0.1' },
      redirect: 'follow',
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!response?.ok || typeof response.json !== 'function') return { ok: false, data: null };
    const data = await response.json();
    if (!data || typeof data !== 'object') return { ok: false, data: null };
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

function memberHasCreatorRole(interaction, roleId) {
  const cache = interaction?.member?.roles?.cache;
  if (!cache) return null;
  if (roleId && cache.has?.(String(roleId))) return true;
  const roles = typeof cache.values === 'function' ? [...cache.values()] : [];
  return roles.some((role) => normalizeName(role?.name) === normalizeName(CREATOR_ROLE_NAME));
}

function authorizeCreatorPost(interaction, store) {
  const userId = String(interaction?.user?.id || '');
  const profile = store?.getCreatorProfile?.(userId) || null;
  if (!profile || profile.revokedAt || profile.status === 'revoked') return { ok: false, reason: 'not-approved', profile: null };
  const roleId = String(store?.getCreatorMeta?.()?.creatorRoleId || '');
  const allowed = memberHasCreatorRole(interaction, roleId);
  if (allowed === false) return { ok: false, reason: 'not-approved', profile };
  return { ok: true, profile };
}

async function respond(interaction, content) {
  const payload = { content, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function deferEphemeral(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function resolveCreatorFeedChannel(guild, store) {
  if (!guild?.channels?.fetch) return null;
  const metaId = String(store?.getCreatorMeta?.()?.creatorFeedChannelId || '');
  if (metaId) {
    try {
      const exact = await guild.channels.fetch(metaId);
      if (exact?.isTextBased?.() && typeof exact.send === 'function') return exact;
    } catch { /* fall through to a name search */ }
  }
  let channels = null;
  try { channels = await guild.channels.fetch(); } catch { return null; }
  const list = valuesOf(channels).filter((channel) => channel?.isTextBased?.() && typeof channel.send === 'function' && normalizeName(channel.name) === normalizeName(CREATOR_FEED_NAME));
  if (!list.length) return null;
  const information = findInformationCategory(channels);
  if (!information) return list[0];
  return list.find((channel) => String(channel.parentId || '') === String(information.id)) || list[0];
}

async function resolveStreamAlertsRole(guild, config = {}) {
  if (!guild?.roles?.fetch) return null;
  const roles = await guild.roles.fetch().catch?.(() => null);
  const list = valuesOf(roles);
  const configured = String(config?.discord?.creatorProgram?.streamAlertsRoleId || config?.creatorProgram?.streamAlertsRoleId || '').trim();
  if (/^\d{15,24}$/.test(configured)) {
    const exact = list.find((role) => String(role?.id || '') === configured);
    if (exact) return exact;
  }
  return list.find((role) => normalizeName(role?.name) === normalizeName(STREAM_ALERTS_ROLE_NAME)) || null;
}

async function verifyCreatorPost(classified, profile, fetchImpl) {
  if (classified.platform === 'twitch') {
    if (!classified.login) return { ok: false, reason: 'twitch-login-unverified' };
    const saved = normalizeTwitchLogin(savedHandle(profile, 'twitch'));
    if (!saved) return { ok: false, reason: 'handle-missing' };
    if (saved !== classified.login) return { ok: false, reason: 'author-mismatch' };
    return { ok: true, title: '' };
  }
  if (classified.platform === 'youtube') {
    const candidates = [profile?.handles?.youtube, savedHandle(profile, 'youtube'), /youtube\.com|youtu\.be/i.test(profile?.channelRef || '') ? profile.channelRef : '']
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!candidates.length) return { ok: false, reason: 'handle-missing' };
    const oembed = await fetchOEmbed('youtube', classified.rawUrl, fetchImpl);
    if (!oembed.ok) return { ok: false, reason: 'unverified' };
    if (!candidates.some((candidate) => youtubeAuthorMatches(candidate, oembed.data))) return { ok: false, reason: 'author-mismatch' };
    return { ok: true, title: oembed.data.title || '' };
  }
  const tiktok = normalizeTikTokHandle(savedHandle(profile, 'tiktok'));
  if (!tiktok) return { ok: false, reason: 'handle-missing' };
  const oembed = await fetchOEmbed('tiktok', classified.rawUrl, fetchImpl);
  if (!oembed.ok) return { ok: false, reason: 'unverified' };
  if (!tiktokAuthorMatches(oembed.data, tiktok)) return { ok: false, reason: 'author-mismatch' };
  return { ok: true, title: oembed.data.title || '' };
}

function failureMessage(reason, platform = '') {
  const label = platformLabel(platform);
  if (reason === 'disabled') return 'Creator posting is turned off right now.';
  if (reason === 'not-approved') return 'Only approved creators can post in the creator feed.';
  if (reason === 'unsupported-url') return 'Share a TikTok, YouTube, or Twitch link.';
  if (reason === 'twitch-login-unverified') return 'Use a Twitch channel or clip link that includes the channel login, such as https://www.twitch.tv/yourname or https://www.twitch.tv/yourname/clip/....';
  if (reason === 'duplicate') return 'That link is already in the creator feed.';
  if (reason === 'rate-limited') return `You can share ${CREATOR_POST_LIMIT} creator posts every 24 hours. Try again later.`;
  if (reason === 'handle-missing') return `Your creator profile does not have a saved ${label} handle yet.`;
  if (reason === 'author-mismatch' && platform === 'tiktok') return 'That TikTok was not posted because the author does not match your saved TikTok handle.';
  if (reason === 'author-mismatch' && platform === 'youtube') return 'That YouTube video was not posted because the channel does not match your saved YouTube channel.';
  if (reason === 'author-mismatch' && platform === 'twitch') return 'That Twitch link was not posted because the channel login does not match your saved Twitch handle.';
  if (reason === 'author-mismatch') return 'That post was not shared because it does not match your saved creator profile.';
  if (reason === 'unverified') return 'That post could not be verified, so it was not shared.';
  if (reason === 'feed-missing') return 'The creator feed channel is not available, so nothing was posted.';
  if (reason === 'send-failed') return 'The creator feed could not be posted to right now.';
  return 'The creator post could not be completed.';
}

async function handleCreatorPost(interaction, store, context = {}) {
  const env = context.env || process.env;
  if (!creatorPostEnabled(env)) {
    await respond(interaction, failureMessage('disabled'));
    return { ok: false, reason: 'disabled' };
  }
  const auth = authorizeCreatorPost(interaction, store);
  if (!auth.ok) {
    await respond(interaction, failureMessage('not-approved'));
    return { ok: false, reason: 'not-approved' };
  }
  const rawUrl = String(interaction.options?.getString?.('url') || '').trim();
  const classified = classifyCreatorPostUrl(rawUrl);
  if (!classified) {
    await respond(interaction, failureMessage('unsupported-url'));
    return { ok: false, reason: 'unsupported-url' };
  }
  if (classified.platform === 'twitch' && !classified.login) {
    await respond(interaction, failureMessage('twitch-login-unverified', 'twitch'));
    return { ok: false, reason: 'twitch-login-unverified' };
  }
  const nowMs = context.now instanceof Date ? context.now.getTime() : Date.parse(context.now || '') || Date.now();
  const entries = typeof store.listCreatorPosts === 'function' ? store.listCreatorPosts() : [];
  if (creatorPostDuplicate(entries, classified.canonicalUrl)) {
    await respond(interaction, failureMessage('duplicate'));
    return { ok: false, reason: 'duplicate' };
  }
  if (creatorPostRateLimit(entries, interaction.user.id, nowMs).limited) {
    await respond(interaction, failureMessage('rate-limited'));
    return { ok: false, reason: 'rate-limited' };
  }

  await deferEphemeral(interaction);
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  const verified = await verifyCreatorPost(classified, auth.profile, fetchImpl);
  if (!verified.ok) {
    await respond(interaction, failureMessage(verified.reason, classified.platform));
    return { ok: false, reason: verified.reason };
  }

  const resolveFeed = context.resolveFeedChannel || ((guild) => resolveCreatorFeedChannel(guild, store));
  const channel = await resolveFeed(interaction.guild);
  if (!channel?.send) {
    await respond(interaction, failureMessage('feed-missing'));
    return { ok: false, reason: 'feed-missing' };
  }

  const ping = interaction.options?.getBoolean?.('ping') === true;
  let role = null;
  if (ping) {
    const resolveRole = context.resolveStreamAlertsRole || ((guild) => resolveStreamAlertsRole(guild, context.config || {}));
    role = await resolveRole(interaction.guild);
  }
  const payload = creatorFeedPostPayload({
    userId: interaction.user.id,
    platform: classified.platform,
    url: classified.rawUrl,
    title: verified.title,
    roleId: role?.id || ''
  });
  let message = null;
  try {
    message = await channel.send(payload);
  } catch {
    await respond(interaction, failureMessage('send-failed'));
    return { ok: false, reason: 'send-failed' };
  }
  if (typeof store.recordCreatorPost === 'function') {
    store.recordCreatorPost({
      userId: String(interaction.user.id),
      url: classified.rawUrl,
      normalizedUrl: classified.canonicalUrl,
      platform: classified.platform,
      createdAt: new Date(nowMs).toISOString(),
      messageId: String(message?.id || '')
    });
  }
  const pingNote = ping && role?.id ? ' and pinged Stream Alerts.' : ping ? '. Stream Alerts was not pinged because that role was not found.' : '.';
  await respond(interaction, `Posted to the creator feed${pingNote}`);
  return { ok: true, reason: 'posted', channelId: String(channel.id || ''), messageId: String(message?.id || '') };
}

module.exports = {
  CREATOR_POST_LIMIT,
  CREATOR_POST_WINDOW_MS,
  CREATOR_FEED_NAME,
  STREAM_ALERTS_ROLE_NAME,
  TIKTOK_OEMBED_ORIGIN,
  YOUTUBE_OEMBED_ORIGIN,
  creatorPostEnabled,
  parsePlatforms,
  extractCreatorHandles,
  tiktokAuthorMatches,
  youtubeAuthorMatches,
  twitchLoginFromUrl,
  canonicalPostUrl,
  classifyCreatorPostUrl,
  creatorPostRateLimit,
  creatorPostDuplicate,
  creatorFeedPostPayload,
  oEmbedEndpoint,
  authorizeCreatorPost,
  handleCreatorPost,
  resolveCreatorFeedChannel,
  resolveStreamAlertsRole
};
