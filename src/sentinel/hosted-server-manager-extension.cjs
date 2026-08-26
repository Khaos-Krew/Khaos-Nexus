'use strict';

const { Client, Events, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');
const { HostedServerStatusService } = require('../backend/services/hosted-server-status-service.cjs');
const { hostedServerSetupGuide } = require('../backend/services/once-human-custom-server-config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { refreshGameServersPanel } = require('./game-servers-extension.cjs');
const { COMMUNITY_SERVER_MIN_LEVEL } = require('./game-servers-panel.cjs');
const { syncServerHostTitle } = require('./server-host-titles.cjs');
const { hostedServerCommand, handleHostedServerCommand } = require('./hosted-server-manager.cjs');

const INSTALLED = Symbol.for('khaos.nexus.hostedServerManager.extension');
const HEALTH_WATCHER = Symbol.for('khaos.nexus.hostedServerManager.healthWatcher');
const HEALTH_SWEEP_RUNNING = Symbol.for('khaos.nexus.hostedServerManager.healthSweepRunning');

function installHostedServerManagerExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const backend = new BackendClient(config);
  const statusService = new HostedServerStatusService();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;
  const configuredSeconds = Number(config.hostedServers?.statusRefreshSeconds || config.hostedServers?.refreshSeconds || 300);
  const healthRefreshSeconds = Math.max(60, Number.isFinite(configuredSeconds) ? configuredSeconds : 300);

  async function isManager(interaction) {
    const userId = String(interaction.user?.id || '');
    if (!userId) return false;
    if (userId === String(interaction.guild?.ownerId || '')) return true;
    if ((config.discord?.ownerUserIds || []).map(String).includes(userId)) return true;
    const permissions = interaction.member?.permissions;
    if (permissions?.has?.(PermissionFlagsBits.Administrator) || permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
    const roles = interaction.member?.roles?.cache;
    if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return true;
    const linked = await backend.accountByDiscord(userId).catch(() => null);
    return Boolean(linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role));
  }

  async function memberRank(interaction) {
    const roles = interaction.member?.roles?.cache;
    if (!roles) return null;
    let selected = null;
    for (const rank of NEXUS_RANKS) {
      if (rank.level < 1) continue;
      const roleId = String(config.discord?.rankRoles?.[rank.id] || '').trim();
      if (!roleId || !roles.has(roleId)) continue;
      if (!selected || rank.level > selected.level) selected = rank;
    }
    return selected;
  }

  async function persistStatus(id, status) {
    if (!status) return null;
    const safe = {
      providerConnected: Boolean(status.providerConnected),
      trackingState: String(status.trackingState || 'unknown'),
      playerCount: status.playerCount ?? null,
      playerMax: status.playerMax ?? null,
      lastCheckedAt: String(status.lastCheckedAt || new Date().toISOString()),
      statusMessage: String(status.statusMessage || '')
    };
    return backend.updateHostedServer(id, safe);
  }

  async function refreshProviders() {
    const response = await backend.hostedServers();
    if (!response?.ok) return [];
    const results = [];
    for (const server of response.servers || []) {
      const status = await statusService.probe(server);
      if (!status) { results.push({ id: server.id, skipped: true }); continue; }
      const persisted = await persistStatus(server.id, status).catch(() => null);
      results.push({ id: server.id, ok: Boolean(persisted?.ok), trackingState: status.trackingState });
    }
    return results;
  }

  async function reconcileServerHostTitles(client) {
    if (!guildId) return { checked: 0, active: 0 };
    const [applicationsResponse, serversResponse] = await Promise.all([
      backend.serverApplications({ status: 'approved' }).catch(() => null),
      backend.hostedServers().catch(() => null)
    ]);
    if (!applicationsResponse?.ok || !serversResponse?.ok) return { checked: 0, active: 0, skipped: 'registry-unavailable' };
    const guild = await client.guilds.fetch(guildId);
    const activeServerIds = new Set((serversResponse.servers || []).map((server) => String(server.id || '').toUpperCase()));
    let checked = 0;
    let active = 0;
    for (const application of applicationsResponse.applications || []) {
      const userId = String(application.applicantDiscordId || application.applicantId || '');
      if (!/^\d{15,24}$/.test(userId)) continue;
      const approvedServerId = String(application.approvedServerId || '').toUpperCase();
      const activeHost = Boolean(approvedServerId && activeServerIds.has(approvedServerId));
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      const levelResponse = await backend.communityLevel(userId).catch(() => null);
      const level = Number(levelResponse?.profile?.level || 1);
      await syncServerHostTitle(member, level, activeHost).catch(() => null);
      checked += 1;
      if (activeHost) active += 1;
    }
    return { checked, active };
  }

  async function healthSweep(client) {
    if (client[HEALTH_SWEEP_RUNNING]) return;
    client[HEALTH_SWEEP_RUNNING] = true;
    try {
      await refreshProviders();
      await reconcileServerHostTitles(client);
      await refreshGameServersPanel(client, config, { backend });
    } catch (error) {
      console.error('[Nexus Sentinal] game-server health sweep:', error);
    } finally {
      client[HEALTH_SWEEP_RUNNING] = false;
    }
  }

  function startHealthWatcher(client) {
    if (client[HEALTH_WATCHER]) return;
    const timer = setInterval(() => healthSweep(client), healthRefreshSeconds * 1000);
    timer.unref?.();
    client[HEALTH_WATCHER] = timer;
    console.log(`[Nexus Sentinal] game-server health watcher active every ${healthRefreshSeconds}s`);
  }

  Client.prototype.login = function nexusHostedServerManagerLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = hostedServerCommand();
        const commandJson = normalizeRequiredOptions(definition.toJSON());
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, commandJson);
        else await guild.commands.create(commandJson);
        console.log(`[Nexus Sentinal] registered /server hosted-server manager in guild ${guild.id}`);
        await healthSweep(this);
        startHealthWatcher(this);
      } catch (error) {
        console.error('[Nexus Sentinal] hosted-server command registration:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'server') return;
      try {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'apply') {
          const levelResponse = await backend.communityLevel(String(interaction.user?.id || '')).catch(() => null);
          const currentLevel = Number(levelResponse?.profile?.level || 1);
          if (!levelResponse?.ok || currentLevel < COMMUNITY_SERVER_MIN_LEVEL) {
            const content = levelResponse?.ok
              ? `🔒 Community server applications require **Community Level ${COMMUNITY_SERVER_MIN_LEVEL}**. Your current level is **${currentLevel}**. Use **/level** to view your progress.`
              : `⚠️ Sentinel could not verify your Community Level, so the server application was not submitted. Applications require **Community Level ${COMMUNITY_SERVER_MIN_LEVEL}**.`;
            await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            return;
          }
        }

        await handleHostedServerCommand(interaction, {
          backend,
          isManager,
          memberRank,
          communityLevel: (userId) => backend.communityLevel(userId),
          probe: (server) => statusService.probe(server),
          setup: (server) => hostedServerSetupGuide(server),
          persistStatus,
          refreshProviders,
          refresh: () => refreshGameServersPanel(this, config, { backend })
        });

        if (subcommand === 'review' && interaction.options.getString('decision') === 'approved') {
          await reconcileServerHostTitles(this).catch(() => null);
        }
        if (subcommand === 'remove') {
          await reconcileServerHostTitles(this).catch(() => null);
        }
      } catch (error) {
        const content = `⚠️ Server action failed: ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        } catch {}
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { installHostedServerManagerExtension };
