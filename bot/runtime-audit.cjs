'use strict';

const { Events } = require('discord.js');
const { parseStatusButtonId, renderStatusPanel } = require('../shared/status-panels.cjs');
const { StatusPanelService } = require('../main/services/status-panel-service.cjs');

const CLIENT_PATCH = Symbol.for('khaos.nexus.runtimeAudit.clientPatch');

function messageData(event) {
  return event?.data ?? event;
}

function mutateBootstrap(target, source) {
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return source || target;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
  target.secretValues = [target.discordToken, ...(target.config?.servers || []).map((server) => server.password).filter(Boolean)];
  return target;
}

function createRuntimeAudit({
  parentPort = process.parentPort,
  ClientClass,
  events = Events,
  now = () => Date.now(),
  statusServiceFactory
} = {}) {
  let bootstrap = null;
  const cooldowns = new Map();
  const posts = (type, payload = {}) => parentPort?.postMessage?.({ type, payload });
  const configStore = { getRuntimeBootstrap: () => bootstrap || { discordToken: '', config: { discord: {}, servers: [], statusPanels: { panels: [] } } } };
  const service = (statusServiceFactory || ((store) => new StatusPanelService({ configStore: store, now: () => new Date(now()) })))(configStore);

  function updateBootstrap(payload) {
    if (!bootstrap) {
      bootstrap = payload && typeof payload === 'object' ? payload : {};
      bootstrap.secretValues = [bootstrap.discordToken, ...(bootstrap.config?.servers || []).map((server) => server.password).filter(Boolean)];
      return bootstrap;
    }
    return mutateBootstrap(bootstrap, payload);
  }

  function panelById(id) {
    return (bootstrap?.config?.statusPanels?.panels || []).find((panel) => panel.id === id) || null;
  }

  function cooldownKey(interaction, parsed) {
    return `${parsed.panelId}:${interaction?.user?.id || 'unknown'}`;
  }

  function remainingCooldown(interaction, parsed) {
    const key = cooldownKey(interaction, parsed);
    const last = Number(cooldowns.get(key) || 0);
    const remaining = 15000 - (now() - last);
    if (remaining > 0) return remaining;
    cooldowns.set(key, now());
    return 0;
  }

  async function replyError(interaction, message) {
    const content = `Khaos Nexus could not complete that panel action: ${String(message || 'Unknown error').slice(0, 500)}`;
    if (interaction.deferred || interaction.replied) return interaction.editReply?.({ content }).catch?.(() => {});
    return interaction.reply?.({ content, ephemeral: true }).catch?.(() => {});
  }

  async function handleStatusButton(interaction) {
    const parsed = parseStatusButtonId(interaction?.customId);
    if (!parsed) return false;
    try {
      const remaining = remainingCooldown(interaction, parsed);
      if (remaining > 0) {
        await interaction.reply({ content: `Please wait ${Math.ceil(remaining / 1000)} seconds before using this panel again.`, ephemeral: true });
        return true;
      }
      const panel = panelById(parsed.panelId);
      if (!panel || panel.enabled === false) throw new Error('This status panel is no longer enabled.');
      if (!panel.serverId) throw new Error('This status panel does not have a game server selected.');
      await interaction.deferReply({ ephemeral: true });
      const snapshot = await service.snapshot(panel);

      if (parsed.action === 'refresh') {
        const payload = renderStatusPanel(panel, snapshot);
        if (!interaction.message?.edit) throw new Error('The original status message is no longer editable.');
        await interaction.message.edit(payload);
        const refreshedAt = new Date(now()).toISOString();
        posts('status-panel-refreshed', { panelId: panel.id, refreshedAt });
        await interaction.editReply({ content: `Status refreshed for **${snapshot.serverName}**.` });
        return true;
      }

      const count = snapshot.maxPlayers > 0 ? `${snapshot.players} / ${snapshot.maxPlayers}` : String(snapshot.players);
      const names = panel.showPlayerNames && snapshot.playerNames.length
        ? `\n${snapshot.playerNames.map((name) => `• ${name}`).join('\n').slice(0, 1700)}`
        : panel.showPlayerNames ? '\nNo players are currently connected.' : '\nPlayer names are hidden for this panel.';
      await interaction.editReply({ content: `**${snapshot.serverName}** — ${count} connected${names}` });
      return true;
    } catch (error) {
      await replyError(interaction, error?.message || error);
      return true;
    }
  }

  function installParentListener() {
    if (!parentPort?.on || parentPort.__khaosRuntimeAuditListener) return;
    Object.defineProperty(parentPort, '__khaosRuntimeAuditListener', { value: true, configurable: true });
    parentPort.on('message', (event) => {
      const message = messageData(event);
      if (message?.type === 'bootstrap' || message?.type === 'config-update') updateBootstrap(message.payload || {});
    });
  }

  function installClientPatch() {
    if (!ClientClass?.prototype || ClientClass.prototype[CLIENT_PATCH]) return;
    const originalEmit = ClientClass.prototype.emit;
    ClientClass.prototype.emit = function auditedClientEmit(eventName, ...args) {
      const interaction = args[0];
      if (eventName === events.InteractionCreate && interaction?.isButton?.() && parseStatusButtonId(interaction.customId)) {
        Promise.resolve(handleStatusButton(interaction)).catch(() => {});
        return true;
      }
      return originalEmit.call(this, eventName, ...args);
    };
    Object.defineProperty(ClientClass.prototype, CLIENT_PATCH, { value: true });
  }

  installParentListener();
  installClientPatch();

  return {
    updateBootstrap,
    getBootstrap: () => bootstrap,
    handleStatusButton,
    panelById,
    cooldowns,
    service
  };
}

function installRuntimeAudit(options = {}) {
  const { Client } = require('discord.js');
  return createRuntimeAudit({ ...options, ClientClass: options.ClientClass || Client });
}

module.exports = { createRuntimeAudit, installRuntimeAudit, mutateBootstrap, messageData };
