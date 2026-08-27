'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { pollCluster, summarizeCluster } = require('./ark-cluster-monitor.cjs');
const {
  BUTTON_REFRESH,
  BUTTON_SHOP,
  BUTTON_KITS,
  BUTTON_EVENTS,
  findArkStatusChannel,
  renderArkClusterPanel,
  reconcileArkClusterPanel
} = require('./ark-cluster-panel.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.extension');
const BOUND = Symbol.for('khaos.nexus.ark.cluster.bound');
const INITIAL_DELAY_MS = 12_000;
const REFRESH_MS = Math.max(30_000, Number(process.env.NEXUS_ARK_CLUSTER_REFRESH_SECONDS || 60) * 1000 || 60_000);

function arkClusterCommand() {
  const command = new SlashCommandBuilder()
    .setName('arkcluster')
    .setDescription('Manage the Nexus Sentinal ARK cluster registry.');

  command.addSubcommand((sub) => sub.setName('list').setDescription('List registered ARK maps and their current health.'));
  command.addSubcommand((sub) => sub.setName('refresh').setDescription('Poll all registered maps and refresh the ARK cluster panel now.'));
  command.addSubcommand((sub) => sub.setName('add').setDescription('Add or update a map in the ARK cluster registry.')
    .addStringOption((o) => o.setName('id').setDescription('Stable map id, for example gen2.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('name').setDescription('Public server name.').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('map_name').setDescription('Friendly map name.').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('map_identifier').setDescription('ARK map identifier, e.g. Genesis_WP.').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('env_prefix').setDescription('Railway env prefix, e.g. ARK_GEN2.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('cluster_id').setDescription('Optional ARK cluster ID.').setMaxLength(120)));
  command.addSubcommand((sub) => sub.setName('remove').setDescription('Remove a map from the ARK cluster registry.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('enable').setDescription('Enable or disable a registered map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Whether Sentinal should poll and display this map.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('maintenance').setDescription('Set or clear maintenance state for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Maintenance state.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('profiles').setDescription('Update config/mod/shop/restart profile labels for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('config').setDescription('Config profile name.').setMaxLength(80))
    .addStringOption((o) => o.setName('mods').setDescription('Mod profile name.').setMaxLength(80))
    .addStringOption((o) => o.setName('shop').setDescription('Shop profile name.').setMaxLength(80))
    .addStringOption((o) => o.setName('restart').setDescription('Restart profile name.').setMaxLength(80)));
  command.addSubcommand((sub) => sub.setName('event').setDescription('Set the currently advertised event for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('name').setDescription('Event name, or none to clear it.').setRequired(true).setMaxLength(120))
    .addStringOption((o) => o.setName('ends_at').setDescription('Optional ISO date/time when the event ends.').setMaxLength(80)));
  command.addSubcommand((sub) => sub.setName('restart-time').setDescription('Set the next expected restart for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('at').setDescription('ISO date/time, or none to clear it.').setRequired(true).setMaxLength(80)));
  command.addSubcommand((sub) => sub.setName('mods').setDescription('Update the public active-mod list for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('list').setDescription('Comma-separated mod names, or none to clear.').setRequired(true).setMaxLength(1800)));
  command.addSubcommand((sub) => sub.setName('rates').setDescription('Update public rate labels for a map.')
    .addStringOption((o) => o.setName('id').setDescription('Registry map id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('values').setDescription('Comma-separated labels like Harvest=5x,Taming=10x; use none to clear.').setRequired(true).setMaxLength(1000)));

  return command;
}

async function registerArkClusterCommand(guild) {
  const definition = arkClusterCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
}

function parseMods(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'none') return [];
  return text.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 60);
}

function parseRates(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'none') return {};
  const out = {};
  for (const part of text.split(',')) {
    const [key, ...rest] = part.split('=');
    const name = String(key || '').trim();
    const amount = rest.join('=').trim();
    if (!name || !amount) continue;
    out[name] = amount;
    if (Object.keys(out).length >= 12) break;
  }
  if (!Object.keys(out).length) throw new Error('Rates must use key=value pairs, for example Harvest=5x,Taming=10x.');
  return out;
}

function registryLine(server) {
  const glyph = server.runtime?.state === 'online' ? '🟢' : server.runtime?.state === 'maintenance' ? '🟡' : '🔴';
  return `${glyph} \`${server.id}\` • ${server.mapName} • ${server.runtime?.playerCount || 0} players • env \`${server.envPrefix}\`${server.enabled === false ? ' • disabled' : ''}`;
}

async function refreshClusterPanel(client, registry, config, { reason = 'manual', poll = true } = {}) {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-unconfigured' };
  const guild = await client.guilds.fetch(guildId);
  const channel = await findArkStatusChannel(guild);
  if (!channel) return { skipped: 'ark-server-status-channel-missing' };

  let snapshot;
  if (poll) snapshot = await pollCluster(registry);
  else {
    const servers = registry.list({ includeDisabled: true });
    snapshot = { servers, summary: summarizeCluster(servers), checkedAt: new Date().toISOString() };
  }
  const payload = renderArkClusterPanel(snapshot);
  const panel = await reconcileArkClusterPanel(channel, payload, { botId: client.user?.id, registry });
  return { ...panel, ...snapshot, channelId: String(channel.id || ''), reason };
}

async function replyButton(interaction, content) {
  const payload = { content: String(content).slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function handleClusterButton(interaction, context) {
  if (!interaction.isButton?.()) return false;
  const id = String(interaction.customId || '');
  if (![BUTTON_REFRESH, BUTTON_SHOP, BUTTON_KITS, BUTTON_EVENTS].includes(id)) return false;

  if (id === BUTTON_REFRESH) {
    if (!isStaff(interaction, context.config)) {
      await replyButton(interaction, '🔒 Manual cluster refresh is limited to Nexus staff. The panel also refreshes automatically.');
      return true;
    }
    const now = Date.now();
    if (now - context.lastManualRefreshAt < 15_000) {
      await replyButton(interaction, '⏱️ The ARK cluster was refreshed very recently.');
      return true;
    }
    context.lastManualRefreshAt = now;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await context.runRefresh('button');
    await interaction.editReply({ content: result.skipped ? `⚠️ ${result.skipped}` : `✅ ARK cluster refreshed. ${result.summary.totalPlayers} player(s) across ${result.summary.enabled} enabled map(s).`, allowedMentions: { parse: [] } });
    return true;
  }

  const servers = context.registry.list({ includeDisabled: false });
  if (id === BUTTON_SHOP) {
    const maps = servers.filter((server) => server.shopEnabled !== false).map((server) => server.mapName).join(', ') || 'None';
    await replyButton(interaction, `🛒 **ARK Shop**\nShop access is enabled on: ${maps}. Use the in-game ArkShop interface/commands configured for the server. Staff management remains protected through Sentinal.`);
    return true;
  }
  if (id === BUTTON_KITS) {
    const maps = servers.filter((server) => server.kitsEnabled !== false).map((server) => server.mapName).join(', ') || 'None';
    await replyButton(interaction, `🎁 **ARK Kits**\nKit access is enabled on: ${maps}. Availability and contents are controlled by the active ArkShop profile.`);
    return true;
  }
  const active = servers.filter((server) => server.currentEvent).map((server) => `• **${server.mapName}:** ${server.currentEvent}${server.eventEndsAt ? ` (ends <t:${Math.floor(new Date(server.eventEndsAt).getTime() / 1000)}:R>)` : ''}`);
  await replyButton(interaction, active.length ? `🎉 **Current ARK Events**\n${active.join('\n')}` : '🎉 No ARK cluster event is currently active.');
  return true;
}

async function handleClusterCommand(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'arkcluster') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ARK cluster management requires Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const registry = context.registry;

  if (sub === 'list') {
    const servers = registry.list({ includeDisabled: true });
    const body = servers.length ? servers.map(registryLine).join('\n') : 'No ARK maps are registered.';
    await interaction.editReply({ content: `🦖 **Nexus ARK Cluster Registry**\n\n${body}`.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'refresh') {
    const result = await context.runRefresh('slash-command');
    await interaction.editReply({ content: result.skipped ? `⚠️ ${result.skipped}` : `✅ Refreshed ${result.summary.enabled} enabled map(s). Cluster players: ${result.summary.totalPlayers}.`, allowedMentions: { parse: [] } });
    return true;
  }

  const id = interaction.options.getString('id', true);
  if (sub === 'add') {
    const record = registry.upsert({
      id,
      name: interaction.options.getString('name', true),
      mapName: interaction.options.getString('map_name', true),
      mapIdentifier: interaction.options.getString('map_identifier', true),
      envPrefix: interaction.options.getString('env_prefix', true),
      clusterId: interaction.options.getString('cluster_id') || '',
      enabled: true,
      maintenance: false,
      connections: { rcon: true, query: false, api: false, sftp: true }
    });
    await context.runRefresh('registry-add');
    await interaction.editReply({ content: `✅ Registered **${record.mapName}** as \`${record.id}\`. Discord cluster status updates automatically.`, allowedMentions: { parse: [] } });
    return true;
  }

  const existing = registry.get(id);
  if (!existing) throw new Error(`Unknown ARK cluster map: ${id}`);

  if (sub === 'remove') {
    registry.remove(id);
    await context.runRefresh('registry-remove');
    await interaction.editReply({ content: `✅ Removed **${existing.mapName}** from the ARK cluster registry and refreshed the panel.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'enable') {
    const record = registry.upsert({ ...existing, enabled: interaction.options.getBoolean('enabled', true) });
    await context.runRefresh('registry-enable');
    await interaction.editReply({ content: `✅ **${record.mapName}** is now ${record.enabled ? 'enabled' : 'disabled'} in Sentinal.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'maintenance') {
    const record = registry.upsert({ ...existing, maintenance: interaction.options.getBoolean('enabled', true) });
    await context.runRefresh('registry-maintenance');
    await interaction.editReply({ content: `${record.maintenance ? '🟡' : '✅'} **${record.mapName}** maintenance is ${record.maintenance ? 'ON' : 'OFF'}.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'profiles') {
    const record = registry.upsert({
      ...existing,
      configProfile: interaction.options.getString('config') || existing.configProfile,
      modProfile: interaction.options.getString('mods') || existing.modProfile,
      shopProfile: interaction.options.getString('shop') || existing.shopProfile,
      restartProfile: interaction.options.getString('restart') || existing.restartProfile
    });
    await context.runRefresh('registry-profiles', false);
    await interaction.editReply({ content: `✅ Updated profiles for **${record.mapName}**.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'event') {
    const name = interaction.options.getString('name', true).trim();
    const clear = name.toLowerCase() === 'none';
    const record = registry.upsert({ ...existing, currentEvent: clear ? '' : name, eventEndsAt: clear ? '' : (interaction.options.getString('ends_at') || '') });
    await context.runRefresh('registry-event', false);
    await interaction.editReply({ content: `✅ ${clear ? 'Cleared the event on' : `Set **${record.currentEvent}** on`} **${record.mapName}**.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'restart-time') {
    const at = interaction.options.getString('at', true).trim();
    const record = registry.upsert({ ...existing, nextRestartAt: at.toLowerCase() === 'none' ? '' : at });
    await context.runRefresh('registry-restart', false);
    await interaction.editReply({ content: `✅ Updated next restart for **${record.mapName}**.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'mods') {
    const record = registry.upsert({ ...existing, mods: parseMods(interaction.options.getString('list', true)) });
    await context.runRefresh('registry-mods', false);
    await interaction.editReply({ content: `✅ **${record.mapName}** now tracks ${record.mods.length} active mod(s).`, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === 'rates') {
    const values = interaction.options.getString('values', true);
    const record = registry.upsert({ ...existing, rates: String(values).trim().toLowerCase() === 'none' ? {} : parseRates(values) });
    await context.runRefresh('registry-rates', false);
    await interaction.editReply({ content: `✅ Updated public rates for **${record.mapName}**.`, allowedMentions: { parse: [] } });
    return true;
  }

  throw new Error('Unsupported ARK cluster operation.');
}

function installArkClusterExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const registry = new ArkClusterRegistry();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      const context = {
        config,
        registry,
        lastManualRefreshAt: 0,
        running: false,
        async runRefresh(reason, poll = true) {
          if (this.running) return { skipped: 'refresh-already-running' };
          this.running = true;
          try { return await refreshClusterPanel(client, registry, config, { reason, poll }); }
          finally { this.running = false; }
        }
      };
      client.__nexusArkClusterContext = context;
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void (async () => {
          if (await handleClusterButton(interaction, context)) return;
          await handleClusterCommand(interaction, context);
        })().catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        const guildId = String(config.discord?.guildId || '');
        if (!guildId) throw new Error('NEXUS_DISCORD_GUILD_ID is not configured.');
        const bootstrap = registry.bootstrapFromEnv('ARK_GEN1', {
          id: 'gen1',
          name: process.env.ARK_GEN1_NAME || 'Khaos Nexus (Gen 1)',
          mapName: 'Genesis Part 1',
          mapIdentifier: 'Genesis_WP',
          configProfile: 'gen1-live',
          modProfile: 'gen1-live',
          shopProfile: 'arkshop-live',
          restartProfile: 'gen1-restarts'
        });
        console.log(`[Nexus Sentinal] ARK cluster registry bootstrap: ${bootstrap.created ? `created=${bootstrap.record.id}` : bootstrap.existing ? `existing=${bootstrap.record.id}` : `skipped=${bootstrap.skipped}`}`);
        const guild = await client.guilds.fetch(guildId);
        await registerArkClusterCommand(guild);

        const context = client.__nexusArkClusterContext;
        const initialTimer = setTimeout(() => void context.runRefresh('startup'), INITIAL_DELAY_MS);
        initialTimer.unref?.();
        const periodicTimer = setInterval(() => void context.runRefresh('periodic'), REFRESH_MS);
        periodicTimer.unref?.();
        console.log(`[Nexus Sentinal] ARK cluster management ready: maps=${registry.list({ includeDisabled: true }).length} refreshSeconds=${Math.round(REFRESH_MS / 1000)}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK cluster management unavailable: ${String(error?.message || error).slice(0, 300)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  REFRESH_MS,
  arkClusterCommand,
  registerArkClusterCommand,
  parseMods,
  parseRates,
  registryLine,
  refreshClusterPanel,
  handleClusterButton,
  handleClusterCommand,
  installArkClusterExtension
};
