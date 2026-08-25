'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { findHqCategory } = require('./nexus-hq.cjs');
const { leaderboardPayload } = require('./community-leveling.cjs');
const { progressCardPayload, achievementCollectionPayload } = require('./community-achievements.cjs');
const {
  ensureCommandChannel,
  reconcileCommandPanel,
  parseCommandButtonId,
  findNamedTextChannel,
  publicHelpPayload
} = require('./nexus-command-center.cjs');

const INSTALLED = Symbol.for('khaos.nexus.commandCenter.extension');
const BOUND = Symbol.for('khaos.nexus.commandCenter.bound');
const INITIAL_DELAY_MS = 90_000;
const REFRESH_MS = 10 * 60_000;

async function refreshCommandCenter(client, config) {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-id-missing' };
  const guild = await client.guilds.fetch(guildId);
  const channelResult = await ensureCommandChannel(guild);
  if (!channelResult.channel) return channelResult;
  const panel = await reconcileCommandPanel(channelResult.channel, { botId: client.user?.id });
  return {
    ...channelResult,
    ...panel,
    channelId: String(channelResult.channel.id || ''),
    hqId: String(channelResult.hq?.id || '')
  };
}

function channelReference(channel, fallback) {
  return channel?.id ? `<#${channel.id}>` : fallback;
}

async function handleCommandCenterButton(interaction, context) {
  if (!interaction.isButton?.()) return false;
  const action = parseCommandButtonId(interaction.customId);
  if (!action) return false;

  const guildId = String(context.config.discord?.guildId || '');
  if (String(interaction.guildId || '') !== guildId) return false;
  const guild = interaction.guild || await context.client.guilds.fetch(guildId);
  const hq = findHqCategory(guild.channels.cache);

  if (action === 'level') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = String(interaction.user.id);
    const [level, achievements] = await Promise.all([
      context.backend.communityLevel(userId),
      context.backend.communityAchievements(userId).catch(() => null)
    ]);
    if (!level?.ok) {
      await interaction.editReply({ content: level?.message || 'Community level data is unavailable.', embeds: [], components: [] });
      return true;
    }
    await interaction.editReply(progressCardPayload(level.profile, interaction.user, achievements?.ok ? achievements : null));
    return true;
  }

  if (action === 'achievements') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await context.backend.communityAchievements(String(interaction.user.id));
    if (!response?.ok) {
      await interaction.editReply({ content: response?.message || 'Achievement data is unavailable.', embeds: [], components: [] });
      return true;
    }
    await interaction.editReply(achievementCollectionPayload(response, interaction.user, 'summary', { viewerId: String(interaction.user.id) }));
    return true;
  }

  if (action === 'leaderboard') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await context.backend.communityLeaderboard(10);
    if (!response?.ok) {
      await interaction.editReply({ content: response?.message || 'Community leaderboard data is unavailable.', embeds: [], components: [] });
      return true;
    }
    const users = new Map();
    for (const profile of response.leaderboard || []) {
      const id = String(profile.userId || '');
      const cached = guild.members?.cache?.get?.(id)?.user || context.client.users?.cache?.get?.(id) || null;
      if (cached) users.set(id, cached);
    }
    await interaction.editReply(leaderboardPayload(response.leaderboard || [], users));
    return true;
  }

  if (action === 'help') {
    await interaction.reply({ ...publicHelpPayload(guild, hq?.id || ''), flags: MessageFlags.Ephemeral });
    return true;
  }

  const lookup = {
    roles: { names: ['roles', 'role-selection', 'self-roles', 'server-roles'], parent: '', fallback: 'the managed Roles channel', description: 'Use the managed role controls there to change your public self-roles.' },
    events: { names: ['events'], parent: hq?.id || '', fallback: '#events', description: 'Official Nexus events and RSVP controls are maintained there.' },
    polls: { names: ['polls'], parent: hq?.id || '', fallback: '#polls', description: 'Managed Nexus community polls are published there.' }
  }[action];
  if (!lookup) return false;
  const channel = findNamedTextChannel(guild, lookup.names, lookup.parent) || findNamedTextChannel(guild, lookup.names);
  await interaction.reply({
    content: `${channelReference(channel, lookup.fallback)}\n${lookup.description}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  });
  return true;
}

function installNexusCommandCenterExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const backend = new BackendClient(config);
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusCommandCenterLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;

      client.on(Events.InteractionCreate, async (interaction) => {
        try {
          await handleCommandCenterButton(interaction, { client, config, backend });
        } catch (error) {
          const content = `⚠️ ${String(error?.message || error).slice(0, 1700)}`;
          try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          } catch {}
        }
      });
    }

    client.once(Events.ClientReady, () => {
      const initial = setTimeout(async () => {
        try {
          const result = await refreshCommandCenter(client, config);
          if (result.skipped) console.warn(`[Nexus Sentinal] command center skipped: ${result.skipped}`);
          else console.log(`[Nexus Sentinal] command center ready: channel=${result.channelId} created=${result.created} moved=${result.moved} renamed=${result.renamed} locked=${result.permissionsLocked} panelCreated=${result.created === true && result.message ? true : result.created} panelUpdated=${result.updated} duplicatesRemoved=${result.duplicatesRemoved}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] command center unavailable: ${String(error?.message || error).slice(0, 220)}`);
        }
      }, INITIAL_DELAY_MS);
      initial.unref?.();

      const refresh = setInterval(async () => {
        try { await refreshCommandCenter(client, config); } catch {}
      }, REFRESH_MS);
      refresh.unref?.();
    });

    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  REFRESH_MS,
  refreshCommandCenter,
  channelReference,
  handleCommandCenterButton,
  installNexusCommandCenterExtension
};
