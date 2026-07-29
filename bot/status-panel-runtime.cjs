'use strict';

const { Events } = require('discord.js');
const { StatusPanelService } = require('../main/services/status-panel-service.cjs');
const { normalizeStatusPanelsConfig, parseStatusButtonId, renderStatusPanel } = require('../shared/status-panels.cjs');

const installedClients = new WeakSet();

function runtimeEnabled(bootstrap, id) {
  const state = bootstrap?.config?.moduleRuntime?.[id];
  return state ? Boolean(state.effectiveEnabled) : true;
}

function installStatusPanelRuntime({ client, getBootstrap, send, log, now } = {}) {
  if (!client || installedClients.has(client)) return;
  installedClients.add(client);
  const recent = new Map();
  const clock = now || (() => Date.now());

  function bootstrap() {
    return getBootstrap?.() || { config: {} };
  }

  function panels() {
    return normalizeStatusPanelsConfig(bootstrap().config?.statusPanels || {}).panels;
  }

  function service() {
    return new StatusPanelService({
      configStore: { getRuntimeBootstrap: bootstrap },
      now: () => new Date(clock())
    });
  }

  function rateLimited(interaction, panelId, action) {
    const key = `${interaction.user?.id || 'unknown'}:${panelId}:${action}`;
    const previous = recent.get(key) || 0;
    const current = clock();
    recent.set(key, current);
    for (const [entry, time] of recent) if (current - time > 60000) recent.delete(entry);
    return current - previous < 10000;
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    const parsed = parseStatusButtonId(interaction.customId);
    if (!parsed) return;
    if (!runtimeEnabled(bootstrap(), 'server-status-panels')) {
      await interaction.reply({ content: 'Server Status Panels are temporarily disabled by the Khaos Nexus owner.', ephemeral: true }).catch(() => {});
      return;
    }
    const panel = panels().find((item) => item.id === parsed.panelId && item.enabled !== false);
    if (!panel) {
      await interaction.reply({ content: 'This Khaos Nexus status panel is no longer configured.', ephemeral: true }).catch(() => {});
      return;
    }
    if (rateLimited(interaction, panel.id, parsed.action)) {
      await interaction.reply({ content: 'That panel was refreshed recently. Try again in a few seconds.', ephemeral: true }).catch(() => {});
      return;
    }

    try {
      const statusService = service();
      if (parsed.action === 'refresh') {
        await interaction.deferUpdate();
        const snapshot = await statusService.snapshot(panel);
        await interaction.message.edit(renderStatusPanel(panel, snapshot));
        send?.('status-panel-refreshed', { panelId: panel.id, refreshedAt: snapshot.checkedAt, source: 'discord-button', userId: interaction.user?.id || '' });
        send?.('discord-audit', {
          action: 'status-panel.button-refresh', outcome: 'success', targetType: 'status-panel', targetId: panel.id,
          targetName: panel.name, summary: 'A Discord member refreshed the public-safe server status panel.', actorId: interaction.user?.id || '', actorName: interaction.user?.username || 'Discord member'
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const snapshot = await statusService.snapshot(panel);
      const players = panel.showPlayerNames && snapshot.playerNames.length
        ? snapshot.playerNames.map((name) => `• ${name}`).join('\n')
        : panel.showPlayerNames ? 'No players are currently connected.' : `Connected players: **${snapshot.players}${snapshot.maxPlayers ? ` / ${snapshot.maxPlayers}` : ''}**\nPlayer names are hidden by this panel’s privacy setting.`;
      await interaction.editReply({ content: `**${snapshot.serverName}**\n${players.slice(0, 1900)}` });
      send?.('discord-audit', {
        action: 'status-panel.button-players', outcome: 'success', targetType: 'status-panel', targetId: panel.id,
        targetName: panel.name, summary: 'A Discord member requested the public-safe player summary.', actorId: interaction.user?.id || '', actorName: interaction.user?.username || 'Discord member'
      });
    } catch (error) {
      log?.('error', `Status panel interaction failed: ${error.stack || error.message}`, { panelId: panel.id, action: parsed.action });
      const content = `Status panel refresh failed: ${String(error.message || 'Unknown error').slice(0, 500)}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
      send?.('discord-audit', {
        action: `status-panel.button-${parsed.action}`, outcome: 'failed', targetType: 'status-panel', targetId: panel.id,
        targetName: panel.name, summary: String(error.message || 'Status panel interaction failed.').slice(0, 500), actorId: interaction.user?.id || '', actorName: interaction.user?.username || 'Discord member'
      });
    }
  });
}

module.exports = { installStatusPanelRuntime, runtimeEnabled };