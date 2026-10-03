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
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']);
const TWITCH_RESERVED = new Set(['directory', 'videos', 'video', 'settings', 'subscriptions', 'downloads', 'jobs', 'search', 'p', 'clip', 'clips', 'popout', 'embed', 'moderator', 'products']);
const MAX_OEMBED_BYTES = 64 * 1024;
const pendingCreatorPosts = [];

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
  const author = youtubeKeys(oembed?.author_url || '');
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
  if (host === 'clips.twitch.tv') {
    const slug = decodePart(url.pathname.split('/').filter(Boolean)[0] || '');
    return slug ? `https://clips.twitch.tv/${slug}` : '';
  }
  if (host === 'twitch.tv') {
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodePart(part));
    if (!parts.length) return '';
    const login = normalizeTwitchLogin(parts[0]);
    if (!login) return '';
    if ((parts[1] || '').toLowerCase() === 'clip' && parts[2]) return `https://twitch.tv/${login}/clip/${parts[2]}`;
    const rest = parts.slice(1).map((part) => part.toLowerCase());
    return `https://twitch.tv/${[login, ...rest].join('/')}`;
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

function clockMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
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

function creatorPostRetryAt(entries, userId, nowMs = Date.now()) {
  const recent = postsWithinWindow(entries, userId, nowMs)
    .map((entry) => Date.parse(entry?.createdAt || ''))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b);
  if (recent.length < CREATOR_POST_LIMIT) return '';
  return new Date(recent[recent.length - CREATOR_POST_LIMIT] + CREATOR_POST_WINDOW_MS).toISOString();
}

function combinedCreatorPosts(entries) {
  return [...(Array.isArray(entries) ? entries : []), ...pendingCreatorPosts];
}

function reserveCreatorPost(entries, { userId, canonicalUrl, nowMs = Date.now() } = {}) {
  const combined = combinedCreatorPosts(entries);
  if (creatorPostDuplicate(combined, canonicalUrl)) return { ok: false, reason: 'duplicate' };
  if (creatorPostRateLimit(combined, userId, nowMs).limited) {
    return { ok: false, reason: 'rate-limited', retryAt: creatorPostRetryAt(combined, userId, nowMs) };
  }
  const reservation = {
    userId: String(userId || ''),
    normalizedUrl: String(canonicalUrl || ''),
    createdAt: new Date(nowMs).toISOString(),
    released: false
  };
  pendingCreatorPosts.push(reservation);
  return { ok: true, reservation };
}

function releaseCreatorPostReservation(reservation) {
  if (!reservation || reservation.released) return;
  reservation.released = true;
  const index = pendingCreatorPosts.indexOf(reservation);
  if (index >= 0) pendingCreatorPosts.splice(index, 1);
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

function declaredBodyBytes(response) {
  const headers = response?.headers;
  const raw = typeof headers?.get === 'function' ? headers.get('content-length') : headers?.['content-length'];
  const length = Number(raw || 0);
  return Number.isFinite(length) ? length : 0;
}

async function readBoundedJson(response) {
  if (declaredBodyBytes(response) > MAX_OEMBED_BYTES) return null;
  if (typeof response?.text === 'function') {
    const text = await response.text();
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_OEMBED_BYTES) return null;
    try {
      const data = JSON.parse(text);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }
  if (typeof response?.json !== 'function') return null;
  const data = await response.json();
  if (!data || typeof data !== 'object') return null;
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_OEMBED_BYTES) return null;
  return data;
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
    if (!response?.ok) return { ok: false, data: null };
    const data = await readBoundedJson(response);
    if (!data) return { ok: false, data: null };
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

async function resolveTikTokShareUrl(rawUrl, fetchImpl) {
  const url = parseHttpsUrl(rawUrl);
  if (!url || !TIKTOK_SHORT_HOSTS.has(hostOf(url)) || typeof fetchImpl !== 'function') return String(rawUrl || '');
  let current = url.toString();
  for (let hop = 0; hop < 2; hop += 1) {
    const parsed = parseHttpsUrl(current);
    if (!parsed || !TIKTOK_SHORT_HOSTS.has(hostOf(parsed))) return current;
    try {
      const response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'KhaosNexusSentinal/0.1' },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });
      const location = response?.headers?.get?.('location') || response?.headers?.location || '';
      const next = parseHttpsUrl(String(location).slice(0, 500));
      if (!next || !TIKTOK_HOSTS.has(hostOf(next))) return current;
      current = next.toString();
    } catch {
      return current;
    }
  }
  return current;
}

function memberHasCreatorRole(interaction, roleId) {
  const cache = interaction?.member?.roles?.cache;
  if (!cache) return null;
  if (roleId && cache.has?.(String(roleId))) return true;
  const roles = typeof cache.values === 'function' ? [...cache.values()] : [];
  return roles.some((role) => normalizeName(role?.name) === normalizeName(CREATOR_ROLE_NAME));
}

function creatorWasRevoked(store, userId, profile) {
  if (profile?.revokedAt || profile?.status === 'revoked') return true;
  if (profile) return false;
  const applications = store?.listCreatorApplications?.() || {};
  return Object.values(applications).some((application) => String(application?.userId || '') === String(userId || '') && application?.revokedAt);
}

function authorizeCreatorPost(interaction, store) {
  const userId = String(interaction?.user?.id || '');
  const profile = store?.getCreatorProfile?.(userId) || null;
  if (creatorWasRevoked(store, userId, profile)) return { ok: false, reason: 'revoked', profile: null };
  if (!profile) return { ok: false, reason: 'not-approved', profile: null };
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

function failureMessage(reason, platform = '', extra = {}) {
  const label = platformLabel(platform);
  if (reason === 'disabled') return 'Creator posting is turned off right now.';
  if (reason === 'revoked') return 'Your creator access was revoked, so you cannot post in the creator feed. Tell staff if that is a mistake.';
  if (reason === 'not-approved') return 'Only approved creators can post in the creator feed. Press Apply for Creator Program in #creator-program.';
  if (reason === 'unsupported-url') return 'Share a TikTok, YouTube, or Twitch link.';
  if (reason === 'twitch-login-unverified') return 'Use a Twitch channel or clip link that includes the channel login, such as https://www.twitch.tv/yourname or https://www.twitch.tv/yourname/clip/....';
  if (reason === 'duplicate') return 'That link is already in the creator feed.';
  if (reason === 'rate-limited') {
    const at = Date.parse(extra.retryAt || '');
    const when = Number.isFinite(at) ? ` You can post again <t:${Math.floor(at / 1000)}:F>.` : ' Try again later.';
    return `You can share ${CREATOR_POST_LIMIT} creator posts every 24 hours.${when}`;
  }
  if (reason === 'handle-missing') return `Your creator profile does not have a saved ${label} handle yet. Ask staff to add it, then try the post again.`;
  if (reason === 'author-mismatch' && platform === 'tiktok') return 'That TikTok was not posted because the author does not match your saved TikTok handle.';
  if (reason === 'author-mismatch' && platform === 'youtube') return 'That YouTube video was not posted because the channel does not match your saved YouTube channel.';
  if (reason === 'author-mismatch' && platform === 'twitch') return 'That Twitch link was not posted because the channel login does not match your saved Twitch handle.';
  if (reason === 'author-mismatch') return 'That post was not shared because it does not match your saved creator profile.';
  if (reason === 'unverified') return 'That post could not be verified, so it was not shared. A private video, or a post from a different account than the one on your profile, cannot be checked.';
  if (reason === 'feed-missing') return 'The creator feed channel is not available, so nothing was posted. Tell staff.';
  if (reason === 'send-failed') return 'The creator feed could not be posted to right now. Tell staff.';
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
    await respond(interaction, failureMessage(auth.reason));
    return { ok: false, reason: auth.reason };
  }
  const rawUrl = String(interaction.options?.getString?.('url') || '').trim();
  let classified = classifyCreatorPostUrl(rawUrl);
  if (!classified) {
    await respond(interaction, failureMessage('unsupported-url'));
    return { ok: false, reason: 'unsupported-url' };
  }
  if (classified.platform === 'twitch' && !classified.login) {
    await respond(interaction, failureMessage('twitch-login-unverified', 'twitch'));
    return { ok: false, reason: 'twitch-login-unverified' };
  }
  const nowMs = clockMs(context.now);
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  const submitted = parseHttpsUrl(classified.rawUrl);
  if (classified.platform === 'tiktok' && submitted && TIKTOK_SHORT_HOSTS.has(hostOf(submitted))) {
    const resolved = await resolveTikTokShareUrl(classified.rawUrl, fetchImpl);
    const again = classifyCreatorPostUrl(resolved);
    if (again?.platform === 'tiktok') classified = again;
  }
  const entries = typeof store.listCreatorPosts === 'function' ? store.listCreatorPosts() : [];
  const reservation = reserveCreatorPost(entries, {
    userId: interaction.user.id,
    canonicalUrl: classified.canonicalUrl,
    nowMs
  });
  if (!reservation.ok) {
    await respond(interaction, failureMessage(reservation.reason, classified.platform, reservation));
    return { ok: false, reason: reservation.reason };
  }
  const hold = reservation.reservation;

  try {
    await deferEphemeral(interaction);
    const verified = await verifyCreatorPost(classified, auth.profile, fetchImpl);
    if (!verified.ok) {
      releaseCreatorPostReservation(hold);
      await respond(interaction, failureMessage(verified.reason, classified.platform));
      return { ok: false, reason: verified.reason };
    }

    const resolveFeed = context.resolveFeedChannel || ((guild) => resolveCreatorFeedChannel(guild, store));
    const channel = await resolveFeed(interaction.guild);
    if (!channel?.send) {
      releaseCreatorPostReservation(hold);
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
      releaseCreatorPostReservation(hold);
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
    releaseCreatorPostReservation(hold);
    const pingNote = ping && role?.id ? ' and pinged Stream Alerts.' : ping ? '. Stream Alerts was not pinged because that role was not found.' : '.';
    await respond(interaction, `Posted to the creator feed${pingNote}`);
    return { ok: true, reason: 'posted', channelId: String(channel.id || ''), messageId: String(message?.id || '') };
  } finally {
    releaseCreatorPostReservation(hold);
  }
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
