'use strict';

const { Client, Events, TextChannel } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { renderModuleConsole } = require('./module-console.cjs');

const INSTALLED = Symbol.for('khaos.nexus.persistent.panel.extension');
const SEND_PATCHED = Symbol.for('khaos.nexus.persistent.panel.send');
const PANEL_MARKER_PREFIX = 'Nexus Sentinal • Managed Hub • ';
const RECENT_MESSAGE_LIMIT = 100;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function panelMarker(moduleId) {
  return `${PANEL_MARKER_PREFIX}${String(moduleId || '').toLowerCase()}:v1`;
}

function panelTitle(moduleId) {
  const module = getModule(moduleId);
  return module ? `KHAOS NEXUS • ${module.name.toUpperCase()}` : '';
}

function payloadPanelModuleId(payload = {}) {
  const embed = Array.isArray(payload?.embeds) ? payload.embeds[0] : null;
  const footer = String(embed?.footer?.text || '');
  if (footer.startsWith(PANEL_MARKER_PREFIX)) {
    const match = /^Nexus Sentinal • Managed Hub • ([a-z0-9-]+):v1$/.exec(footer);
    if (match && getModule(match[1])) return match[1];
  }
  const title = String(embed?.title || '');
  const module = MODULES.find((item) => title === panelTitle(item.id));
  return module?.id || '';
}

function markedPanelPayload(payload = {}, moduleId) {
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.map((embed, index) => index === 0
    ? { ...embed, footer: { text: panelMarker(moduleId) } }
    : embed) : [];
  return { ...payload, embeds };
}

function messagePanelFooter(message) {
  return String(message?.embeds?.[0]?.footer?.text || '');
}

function messagePanelTitle(message) {
  return String(message?.embeds?.[0]?.title || '');
}

function messageMatchesPanel(message, moduleId, botId = '') {
  if (!message || !moduleId) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  if (messagePanelFooter(message) === panelMarker(moduleId)) return true;
  return messagePanelTitle(message) === panelTitle(moduleId);
}

async function recentMessages(channel, limit = RECENT_MESSAGE_LIMIT) {
  if (!channel?.messages?.fetch) return [];
  try {
    const messages = await channel.messages.fetch({ limit: Math.max(1, Math.min(100, Number(limit) || RECENT_MESSAGE_LIMIT)) });
    return valuesOf(messages);
  } catch {
    return [];
  }
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => {
    const timeDelta = Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0);
    if (timeDelta) return timeDelta;
    try {
      const a = BigInt(String(left?.id || '0'));
      const b = BigInt(String(right?.id || '0'));
      return b > a ? 1 : b < a ? -1 : 0;
    } catch {
      return String(right?.id || '').localeCompare(String(left?.id || ''));
    }
  })[0] || null;
}

async function reconcilePanelMessages(channel, moduleId, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  const logger = options.logger || console;
  const candidates = (await recentMessages(channel, options.limit)).filter((message) => messageMatchesPanel(message, moduleId, botId));
  const canonical = newestMessage(candidates);
  if (!canonical) return { message: null, candidates: 0, duplicatesRemoved: 0 };

  const marked = markedPanelPayload(payload, moduleId);
  await canonical.edit(marked);
  let duplicatesRemoved = 0;
  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(canonical.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate managed hub panel cleanup');
      duplicatesRemoved += 1;
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] duplicate ${moduleId} hub panel ${duplicate.id} could not be removed: ${String(error?.message || error)}`);
    }
  }
  return { message: canonical, candidates: candidates.length, duplicatesRemoved };
}

async function backendStates(backend) {
  try {
    const result = await backend.modules();
    return new Map((result?.modules || []).map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}

async function sweepManagedPanels(client, { config, state, backend, logger = console } = {}) {
  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { panels: 0, duplicatesRemoved: 0 };
  const guild = await client.guilds.fetch(guildId);
  const states = await backendStates(backend);
  const moduleIds = new Set([...Object.keys(config?.modules || {}), ...Object.keys(state.listModuleSetups())]);
  let panels = 0;
  let duplicatesRemoved = 0;

  for (const moduleId of moduleIds) {
    const module = getModule(moduleId);
    const moduleConfig = config?.modules?.[moduleId] || {};
    const setup = state.getModuleSetup(moduleId);
    const channelId = setup?.consoleChannelId || moduleConfig.channelId || '';
    if (!module || module.console === false || moduleConfig.enabled === false || !channelId) continue;
    const channel = await client.channels.fetch(String(channelId)).catch(() => null);
    if (!channel?.isTextBased?.()) continue;
    const payload = renderModuleConsole(moduleId, states.get(moduleId) || {
      id: moduleId,
      enabled: true,
      configured: false,
      connected: false,
      availableActions: []
    });
    const result = await reconcilePanelMessages(channel, moduleId, payload, { botId: client.user?.id, logger });
    if (!result.message) continue;
    panels += 1;
    duplicatesRemoved += result.duplicatesRemoved;
    state.setConsole(moduleId, {
      guildId,
      channelId: String(channel.id),
      messageId: String(result.message.id),
      updatedAt: new Date().toISOString()
    });
  }

  return { panels, duplicatesRemoved };
}

function installPersistentPanelExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const state = new StateStore();
  const backend = new BackendClient(config);

  if (!TextChannel.prototype[SEND_PATCHED]) {
    const originalSend = TextChannel.prototype.send;
    TextChannel.prototype.send = async function nexusManagedPanelSend(payload, ...rest) {
      const moduleId = payloadPanelModuleId(payload);
      if (!moduleId) return originalSend.call(this, payload, ...rest);
      const marked = markedPanelPayload(payload, moduleId);
      try {
        const recovered = await reconcilePanelMessages(this, moduleId, marked, { botId: this.client?.user?.id });
        if (recovered.message) {
          if (recovered.duplicatesRemoved) console.log(`[Nexus Sentinal] ${moduleId} hub panel reused; removed ${recovered.duplicatesRemoved} duplicate(s).`);
          return recovered.message;
        }
      } catch (error) {
        console.warn(`[Nexus Sentinal] ${moduleId} hub recovery failed before send: ${String(error?.message || error)}`);
      }
      return originalSend.call(this, marked, ...rest);
    };
    TextChannel.prototype[SEND_PATCHED] = true;
  }

  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusPersistentPanelLogin(...args) {
    this.once(Events.ClientReady, () => {
      const timer = setTimeout(async () => {
        try {
          const result = await sweepManagedPanels(this, { config, state, backend });
          console.log(`[Nexus Sentinal] managed hub sweep: panels=${result.panels} duplicatesRemoved=${result.duplicatesRemoved}`);
        } catch (error) {
          console.error('[Nexus Sentinal] managed hub sweep:', error);
        }
      }, 75_000);
      timer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  PANEL_MARKER_PREFIX,
  panelMarker,
  panelTitle,
  payloadPanelModuleId,
  markedPanelPayload,
  messageMatchesPanel,
  newestMessage,
  reconcilePanelMessages,
  sweepManagedPanels,
  installPersistentPanelExtension
};
