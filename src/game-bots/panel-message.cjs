'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { attachBanner, bannerBotForPanel, cloneDelivery } = require('./brand-banners.cjs');

const RECENT_MESSAGE_LIMIT = 100;
const FOREIGN_EDIT_CODE = 50005;
const UNKNOWN_MESSAGE_CODE = 10008;

const PANEL_IDENTITIES = Object.freeze({
  fissures: Object.freeze({
    titles: Object.freeze(['Fissure Relay Board', 'WARFRAME • FISSURES']),
    footerPrefixes: Object.freeze(['Nexus Sentinal • Live Feed • warframe:fissures'])
  }),
  official: Object.freeze({
    titles: Object.freeze(['Official ASA Network'])
  }),
  sanctuaryRoles: Object.freeze({
    titles: Object.freeze(['Sanctuary Nexus roles']),
    footerPrefixes: Object.freeze(['Sanctuary Nexus • self-roles'])
  }),
  cephalonWelcome: Object.freeze({
    titles: Object.freeze(['Welcome to Cephalon Nexus'])
  }),
  ascendedWelcome: Object.freeze({
    titles: Object.freeze(['Welcome to Nexus Ascended'])
  }),
  cephalonEvent: Object.freeze({
    titles: Object.freeze(['Warframe event calendar']),
    footerPrefixes: Object.freeze(['Cephalon Nexus • staff-refreshable event pin'])
  })
});

function runtimeDataDir(env = process.env) {
  const configured = String(env.NEXUS_DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  return configured ? path.resolve(configured) : path.resolve(__dirname, '../../data');
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function snowflake(value) {
  const id = String(value || '').replace(/\D/g, '').slice(0, 20);
  return /^\d{17,20}$/.test(id) ? id : '';
}

function storedMessageId(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 20);
}

function embedOf(message) {
  return message?.embeds?.[0] || null;
}

function embedTitle(message) {
  const embed = embedOf(message);
  return String(embed?.title || embed?.data?.title || '');
}

function embedFooter(message) {
  const embed = embedOf(message);
  return String(embed?.footer?.text || embed?.data?.footer?.text || '');
}

function panelMatcher(identity = {}) {
  const titles = new Set((identity.titles || []).filter(Boolean));
  const prefixes = (identity.footerPrefixes || []).filter(Boolean);
  return (message) => {
    const title = embedTitle(message);
    const footer = embedFooter(message);
    if (title && titles.has(title)) return true;
    return Boolean(footer && prefixes.some((prefix) => footer.startsWith(prefix)));
  };
}

function authorId(message) {
  return String(message?.author?.id || '');
}

function isOwnMessage(message, botId) {
  const author = authorId(message);
  if (!author || !botId) return true;
  return author === String(botId);
}

function isForeignPanel(message, botId) {
  const author = authorId(message);
  if (!author) return false;
  if (botId && author === String(botId)) return false;
  if (message?.author?.bot === false && !message?.webhookId) return false;
  return true;
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return [];
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => {
    const timeDelta = Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0);
    if (timeDelta) return timeDelta;
    return String(right?.id || '').localeCompare(String(left?.id || ''));
  })[0] || null;
}

function errorCode(error) {
  return Number(error?.code || error?.rawError?.code || 0);
}

async function editOwned(message, body) {
  try {
    await message.edit(body);
    return 'edited';
  } catch (error) {
    const code = errorCode(error);
    const text = String(error?.message || error || '');
    if (code === FOREIGN_EDIT_CODE || /authored by another/i.test(text)) return 'foreign';
    if (code === UNKNOWN_MESSAGE_CODE || /unknown message/i.test(text)) return 'missing';
    throw error;
  }
}

async function removeMessage(message, reason) {
  if (!message || typeof message.delete !== 'function') return false;
  try {
    await message.delete(reason);
    return true;
  } catch {
    return false;
  }
}

async function recentMessages(channel, limit = RECENT_MESSAGE_LIMIT) {
  if (typeof channel?.messages?.fetch !== 'function') return [];
  try {
    const fetched = await channel.messages.fetch({ limit: Math.max(1, Math.min(100, Number(limit) || RECENT_MESSAGE_LIMIT)) });
    return valuesOf(fetched);
  } catch {
    return [];
  }
}

function remember(list, message) {
  if (!message) return;
  const id = String(message.id || '');
  if (id && list.some((item) => String(item?.id || '') === id)) return;
  if (!id && list.includes(message)) return;
  list.push(message);
}

async function upsertEmbed(client, channelId, messageId, payload, options = {}) {
  const id = String(channelId || '').trim();
  if (!/^\d{17,20}$/.test(id) || typeof client?.channels?.fetch !== 'function') {
    return { pinned: false, reason: 'unset' };
  }
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return { pinned: false, reason: 'missing' };

  const branded = bannerBotForPanel(options.panel) && options.banner !== false
    ? attachBanner(bannerBotForPanel(options.panel), payload)
    : payload;
  const body = { ...branded, allowedMentions: branded?.allowedMentions || { parse: [] } };
  const botId = String(options.botId || client?.user?.id || '');
  const identity = options.identity || (options.panel ? PANEL_IDENTITIES[options.panel] : null);
  const matches = typeof options.matches === 'function' ? options.matches : (identity ? panelMatcher(identity) : null);
  const envId = storedMessageId(options.envMessageId);
  const preferredId = envId || storedMessageId(messageId);

  const owned = [];
  const foreign = [];
  let canonical = null;

  if (preferredId && typeof channel.messages?.fetch === 'function') {
    const existing = await channel.messages.fetch(preferredId).catch(() => null);
    if (existing?.edit && !isForeignPanel(existing, botId)) {
      const edited = await editOwned(existing, cloneDelivery(body));
      if (edited === 'edited') canonical = existing;
      else if (edited === 'foreign') remember(foreign, existing);
    } else if (existing && isForeignPanel(existing, botId) && (!matches || matches(existing))) {
      remember(foreign, existing);
    } else if (existing && isForeignPanel(existing, botId) && matches && !matches(existing)) {
      return { pinned: true, messageId: preferredId, edited: false, created: false, migrated: false, duplicatesRemoved: 0, foreignRemoved: 0, reason: 'foreign-unmatched' };
    }
  }

  if (matches) {
    for (const message of await recentMessages(channel, options.limit)) {
      if (!matches(message)) continue;
      if (String(message?.id || '') && String(message.id) === String(canonical?.id || '')) continue;
      if (isForeignPanel(message, botId)) remember(foreign, message);
      else if (!authorId(message) || (botId && authorId(message) === String(botId))) remember(owned, message);
    }
  }

  if (!canonical) {
    const preferred = envId ? owned.find((message) => String(message?.id || '') === envId) || null : null;
    canonical = preferred || newestMessage(owned);
    if (canonical?.edit) {
      const edited = await editOwned(canonical, cloneDelivery(body));
      if (edited !== 'edited') {
        if (edited === 'foreign' && isForeignPanel(canonical, botId)) remember(foreign, canonical);
        canonical = null;
      }
    } else {
      canonical = null;
    }
  }

  let created = false;
  let migrated = false;
  if (!canonical) {
    if (options.create === false) {
      return {
        pinned: false,
        messageId: '',
        edited: false,
        created: false,
        migrated: false,
        duplicatesRemoved: 0,
        foreignRemoved: 0,
        reason: 'absent'
      };
    }
    canonical = await channel.send(cloneDelivery(body));
    created = true;
    migrated = foreign.length > 0;
  }

  let duplicatesRemoved = 0;
  for (const duplicate of owned) {
    if (!duplicate || String(duplicate.id || '') === String(canonical?.id || '')) continue;
    if (await removeMessage(duplicate, 'Duplicate game-bot panel')) duplicatesRemoved += 1;
  }
  let foreignRemoved = 0;
  for (const previous of foreign) {
    if (!previous || String(previous.id || '') === String(canonical?.id || '')) continue;
    if (await removeMessage(previous, 'Game bot adopted this panel from the previous bot')) foreignRemoved += 1;
  }

  return {
    pinned: true,
    messageId: String(canonical?.id || (created ? '' : preferredId) || ''),
    edited: !created,
    created,
    migrated,
    duplicatesRemoved,
    foreignRemoved
  };
}

module.exports = {
  RECENT_MESSAGE_LIMIT,
  PANEL_IDENTITIES,
  runtimeDataDir,
  readJson,
  writeJson,
  snowflake,
  storedMessageId,
  embedTitle,
  embedFooter,
  panelMatcher,
  isOwnMessage,
  isForeignPanel,
  newestMessage,
  upsertEmbed
};
