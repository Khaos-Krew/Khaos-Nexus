'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { BUTTON_UPDATE_SAFETY } = require('./ark-cluster-panel.cjs');
const { collectArkUpdateSafety, formatArkUpdateSafety } = require('./ark-update-safety.cjs');
const {
  enforceCompatibilityVerdict,
  formatPreUpdateGate
} = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.update.safety.extension');
const BOUND = Symbol.for('khaos.nexus.ark.update.safety.bound');

function arkHealthCommand() {
  return new SlashCommandBuilder()
    .setName('ark-health')
    .setDescription('Check ASA server, mods, ArkApi and update safety.');
}

async function registerArkHealthCommand(guild) {
  const definition = arkHealthCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
}

function makeRcon(server) {
  return server.host && server.port && server.password ? new ArkRconClient(server) : null;
}

async function collectVerifiedHealth(prefix, server) {
  const report = await collectArkUpdateSafety({ prefix, rcon: makeRcon(server) });
  return enforceCompatibilityVerdict(report);
}

async function buildHealthReply(prefix, server) {
  const report = await collectVerifiedHealth(prefix, server);
  const base = formatArkUpdateSafety(report, server.name).slice(0, 3150);
  return { report, content: `${base}\n\n${formatPreUpdateGate(report)}`.slice(0, 3900) };
}

function isHealthInteraction(interaction) {
  if (interaction.isChatInputCommand?.() && interaction.commandName === 'ark-health') return true;
  return Boolean(interaction.isButton?.() && interaction.customId === BUTTON_UPDATE_SAFETY);
}

async function respondHealthInteraction(interaction, { config, prefix, server }) {
  if (!isStaff(interaction, config)) throw new Error('ARK update safety is restricted to Nexus staff.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!server.enabled) throw new Error(`${prefix} is disabled.`);
  const result = await buildHealthReply(prefix, server);
  await interaction.editReply({ content: result.content, allowedMentions: { parse: [] } });
}

function installArkUpdateSafetyExtension({ prefix = 'ARK_GEN1' } = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const server = arkServerFromEnv(prefix);
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkUpdateSafetyLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!isHealthInteraction(interaction)) return;
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void respondHealthInteraction(interaction, { config, prefix, server }).catch(async (error) => {
          const payload = { content: `⚠️ ARK health check failed: ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        if (!server.enabled) return;
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        await registerArkHealthCommand(guild);
        console.log(`[Nexus Sentinal] ARK update safety ready on demand: button + /ark-health server=${server.name}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK update-safety registration failed: ${String(error?.message || error).slice(0, 240)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  arkHealthCommand,
  registerArkHealthCommand,
  makeRcon,
  collectVerifiedHealth,
  buildHealthReply,
  isHealthInteraction,
  respondHealthInteraction,
  installArkUpdateSafetyExtension
};
