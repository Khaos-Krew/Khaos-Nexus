'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { BUTTON_MODS, effectiveMods } = require('./ark-cluster-panel.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.public.actions');
const BOUND = Symbol.for('khaos.nexus.ark.cluster.public.actions.bound');

function clean(value, max = 120) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildModListReply(servers = []) {
  const enabled = servers.filter((server) => server.enabled !== false);
  if (!enabled.length) return '🧩 No ARK maps are currently enabled.';
  const sections = enabled.map((server) => {
    const mods = effectiveMods(server).filter(Boolean);
    const title = `**${clean(server.mapName || server.name || server.id, 80)}**`;
    if (!mods.length) return `${title}\nNo active mods detected.`;
    const lines = mods.slice(0, 40).map((mod, index) => `${index + 1}. ${clean(mod, 100)}`);
    if (mods.length > 40) lines.push(`…and ${mods.length - 40} more.`);
    return `${title}\n${lines.join('\n')}`;
  });
  return `🧩 **ARK Mod List**\n\n${sections.join('\n\n')}`.slice(0, 1900);
}

function installArkClusterPublicActions() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const registry = new ArkClusterRegistry();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterPublicActionsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction.isButton?.() || interaction.customId !== BUTTON_MODS) return;
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        const payload = {
          content: buildModListReply(registry.list({ includeDisabled: false })),
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] }
        };
        void interaction.reply(payload).catch(async () => {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content, allowedMentions: payload.allowedMentions }).catch(() => {});
        });
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = { clean, buildModListReply, installArkClusterPublicActions };
