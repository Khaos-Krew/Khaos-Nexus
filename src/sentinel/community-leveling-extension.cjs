'use strict';

const { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  ensureLevelUpChannel,
  overviewPayload,
  reconcileLevelPanel,
  leaderboardPayload,
  levelUpPayload,
  meaningfulMessage,
  levelCommandDefinitions,
  syncMilestoneRoles
} = require('./community-leveling.cjs');
const {
  achievementCommandDefinition,
  progressCardPayload,
  parseAchievementButtonId,
  achievementCollectionPayload,
  achievementUnlockPayload
} = require('./community-achievements.cjs');

const INSTALLED = Symbol.for('khaos.nexus.communityLeveling.extension');
const BOUND = Symbol.for('khaos.nexus.communityLeveling.bound');
const SETTINGS_CACHE_MS = 30_000;
const VOICE_TICK_MS = 60_000;
const PANEL_REFRESH_MS = 5 * 60_000;
const INITIAL_PANEL_DELAY_MS = 20_000;

function nowMs() { return Date.now(); }

function messageContentEnabled(client) {
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.MessageContent));
}

function ownerOrManager(interaction, config = {}) {
  const userId = String(interaction?.user?.id || '');
  if ((config.discord?.ownerUserIds || []).map(String).includes(userId)) return true;
  return Boolean(interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function createSettingsCache(backend) {
  let value = null;
  let expiresAt = 0;
  return {
    async get(force = false) {
      if (!force && value && expiresAt > nowMs()) return value;
      const response = await backend.communityLevelSettings();
      if (!response?.ok) throw new Error(response?.message || 'Community leveling settings are unavailable.');
      value = response.settings || {};
      expiresAt = nowMs() + SETTINGS_CACHE_MS;
      return value;
    },
    set(settings) {
      value = settings || {};
      expiresAt = nowMs() + SETTINGS_CACHE_MS;
      return value;
    },
    clear() { value = null; expiresAt = 0; }
  };
}

function createMessageAwardGuard() {
  const lastAwardAt = new Map();
  const recentFingerprints = new Map();

  function prune(userId, cutoff) {
    const map = recentFingerprints.get(userId);
    if (!map) return;
    for (const [fingerprint, at] of map) if (at < cutoff) map.delete(fingerprint);
    if (!map.size) recentFingerprints.delete(userId);
  }

  return {
    accept(userId, fingerprint, settings = {}, now = nowMs()) {
      const id = String(userId || '');
      const cooldownMs = Math.max(10_000, Number(settings.message?.cooldownSeconds || 90) * 1000);
      const previous = Number(lastAwardAt.get(id) || 0);
      if (now - previous < cooldownMs) return { ok: false, reason: 'cooldown' };
      if (fingerprint) {
        const windowMs = Math.max(30_000, Number(settings.message?.duplicateWindowSeconds || 600) * 1000);
        prune(id, now - windowMs);
        const map = recentFingerprints.get(id) || new Map();
        if (map.has(fingerprint)) return { ok: false, reason: 'duplicate' };
        map.set(fingerprint, now);
        recentFingerprints.set(id, map);
      }
      lastAwardAt.set(id, now);
      return { ok: true };
    },
    clear(userId) {
      lastAwardAt.delete(String(userId || ''));
      recentFingerprints.delete(String(userId || ''));
    }
  };
}

async function registerLevelCommands(guild) {
  const definitions = [...levelCommandDefinitions(), achievementCommandDefinition()];
  const commands = await guild.commands.fetch();
  for (const definition of definitions) {
    const existing = commands.find((item) => item.name === definition.name);
    if (existing) await guild.commands.edit(existing, definition.toJSON());
    else await guild.commands.create(definition.toJSON());
  }
  return definitions.map((item) => item.name);
}

async function refreshLevelPanel(client, config, backend, settingsCache) {
  const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
  const channelResult = await ensureLevelUpChannel(guild);
  if (!channelResult.channel) return { skipped: 'information-category-missing' };
  const settings = await settingsCache.get(true);
  const panel = await reconcileLevelPanel(
    channelResult.channel,
    overviewPayload(settings, { messageContentEnabled: messageContentEnabled(client) }),
    { botId: client.user?.id }
  );
  return {
    ...panel,
    channel: channelResult.channel,
    channelId: String(channelResult.channel.id || ''),
    channelCreated: Boolean(channelResult.created),
    channelMoved: Boolean(channelResult.moved),
    settings
  };
}

async function applyProgressResult({ client, guild, channel, userId, result, settings, backend = null, announce = true, forceRoleSync = false }) {
  if (!result?.profile) return { roles: null, announced: false, achievementsAnnounced: false, achievements: null };
  const levelChanged = Number(result.beforeLevel || result.profile.level) !== Number(result.profile.level);
  let roles = null;
  if (result.leveledUp || levelChanged || forceRoleSync) {
    const member = await guild.members.fetch(String(userId)).catch(() => null);
    roles = member ? await syncMilestoneRoles(member, result.profile.level, settings?.milestoneLevels || []) : null;
  }

  let announced = false;
  if (announce && result.leveledUp && channel?.send) {
    await channel.send(levelUpPayload(userId, result));
    announced = true;
  }

  let achievements = null;
  let achievementsAnnounced = false;
  if (backend?.communityAchievements) {
    try { achievements = await backend.communityAchievements(String(userId)); } catch {}
    const unlockPayload = achievementUnlockPayload(userId, achievements || {});
    if (announce && unlockPayload && channel?.send) {
      await channel.send(unlockPayload);
      achievementsAnnounced = true;
    }
  }
  return { roles, announced, achievementsAnnounced, achievements };
}

function formatSettings(settings = {}, client = null) {
  const sources = settings.sources || {};
  const yes = (value) => value === false ? 'off' : 'on';
  return [
    '**Khaos Nexus Community XP**',
    `System: **${settings.enabled === false ? 'disabled' : 'enabled'}** • multiplier **${Number(settings.globalMultiplier ?? 1).toFixed(2)}×**`,
    `Messages: **${yes(sources.message)}** • ${settings.message?.xp || 15} XP / ${settings.message?.cooldownSeconds || 90}s • ${settings.message?.dailyCap || 300}/day`,
    `Voice: **${yes(sources.voice)}** • ${settings.voice?.xp || 10} XP / ${Math.round((settings.voice?.intervalSeconds || 600) / 60)} min • ${settings.voice?.dailyCap || 300}/day • ${settings.voice?.minHumans || 2}+ humans`,
    `Events: **${yes(sources.event)}** • Module participation: **${yes(sources.module)}**`,
    `Ignored channels: **${(settings.ignoredChannelIds || []).length}** • ignored roles: **${(settings.ignoredRoleIds || []).length}**`,
    `Message analysis: **${client && messageContentEnabled(client) ? 'enhanced content checks' : 'metadata + cooldown/cap mode'}**`,
    `Milestones: **${(settings.milestoneLevels || []).join(', ') || 'none'}**`,
    'Achievements: **enabled** • persistent badges + achievement points + progress cards',
    '',
    '_Community levels remain separate from Shop/supporter ranks, module access, staff authority, and Name Color roles._'
  ].join('\n');
}

function eligibilityRoleBlocked(member, settings = {}) {
  const roles = member?.roles?.cache;
  return Boolean(roles && (settings.ignoredRoleIds || []).some((id) => roles.has(String(id))));
}

async function eligibleVoiceMembers(guild, settings = {}) {
  const minHumans = Math.max(2, Number(settings.voice?.minHumans || 2));
  const ignoredChannels = new Set((settings.ignoredChannelIds || []).map(String));
  const afkId = String(guild.afkChannelId || '');
  const groups = new Map();
  for (const state of guild.voiceStates.cache.values()) {
    const channelId = String(state.channelId || '');
    if (!channelId || channelId === afkId || ignoredChannels.has(channelId)) continue;
    if (!state.member || state.member.user?.bot || state.selfDeaf || state.serverDeaf) continue;
    if (eligibilityRoleBlocked(state.member, settings)) continue;
    if (!groups.has(channelId)) groups.set(channelId, []);
    groups.get(channelId).push(state.member);
  }
  const eligible = [];
  for (const members of groups.values()) if (members.length >= minHumans) eligible.push(...members);
  return eligible;
}

function installCommunityLevelingExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const backend = new BackendClient(config);
  const settingsCache = createSettingsCache(backend);
  const messageGuard = createMessageAwardGuard();
  const voiceStartedAt = new Map();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusCommunityLevelingLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;

      client.on(Events.MessageCreate, async (message) => {
        try {
          if (String(message.guildId || '') !== String(config.discord?.guildId || '')) return;
          const settings = await settingsCache.get();
          if (settings.enabled === false || settings.sources?.message === false) return;
          const eligibility = meaningfulMessage(message, settings, { messageContentEnabled: messageContentEnabled(client) });
          if (!eligibility.ok) return;
          const guard = messageGuard.accept(String(message.author.id), eligibility.fingerprint, settings);
          if (!guard.ok) return;
          const result = await backend.communityAward({
            userId: String(message.author.id),
            amount: Number(settings.message?.xp || 15),
            source: 'message'
          });
          if (!result?.ok || Number(result.awarded || 0) <= 0) return;
          const guild = message.guild || await client.guilds.fetch(String(config.discord.guildId));
          const levelChannel = (await ensureLevelUpChannel(guild)).channel;
          await applyProgressResult({ client, guild, channel: levelChannel, userId: message.author.id, result, settings, backend, announce: true });
        } catch (error) {
          console.warn(`[Nexus Sentinal] message XP unavailable: ${String(error?.message || error).slice(0, 180)}`);
        }
      });

      client.on(Events.InteractionCreate, async (interaction) => {
        try {
          if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;

          if (interaction.isButton?.()) {
            const parsed = parseAchievementButtonId(interaction.customId);
            if (!parsed) return;
            if (String(interaction.user?.id || '') !== parsed.viewerId) {
              return interaction.reply({ content: 'That achievement card belongs to another viewer. Use `/achievements` to open your own card.', flags: MessageFlags.Ephemeral });
            }
            await interaction.deferUpdate();
            const [response, target] = await Promise.all([
              backend.communityAchievements(parsed.targetId),
              client.users.fetch(parsed.targetId).catch(() => null)
            ]);
            if (!response?.ok) return interaction.editReply({ content: response?.message || 'Achievement data is unavailable.', embeds: [], components: [] });
            return interaction.editReply(achievementCollectionPayload(response, target, parsed.mode, { viewerId: parsed.viewerId }));
          }

          if (!interaction.isChatInputCommand?.()) return;
          if (!['level', 'rank', 'leaderboard', 'achievements', 'xp'].includes(interaction.commandName)) return;

          if (interaction.commandName === 'leaderboard') {
            await interaction.deferReply();
            const response = await backend.communityLeaderboard(10);
            const users = new Map();
            for (const profile of response.leaderboard || []) {
              const user = await client.users.fetch(String(profile.userId)).catch(() => null);
              if (user) users.set(String(profile.userId), user);
            }
            return interaction.editReply(leaderboardPayload(response.leaderboard || [], users));
          }

          if (interaction.commandName === 'achievements') {
            await interaction.deferReply();
            const target = interaction.options.getUser('user') || interaction.user;
            const response = await backend.communityAchievements(String(target.id));
            if (!response?.ok) return interaction.editReply({ content: response?.message || 'Achievement data is unavailable.' });
            return interaction.editReply(achievementCollectionPayload(response, target, 'summary', { viewerId: String(interaction.user.id) }));
          }

          if (interaction.commandName === 'level' || interaction.commandName === 'rank') {
            await interaction.deferReply();
            const target = interaction.options.getUser('user') || interaction.user;
            const [response, achievements] = await Promise.all([
              backend.communityLevel(String(target.id)),
              backend.communityAchievements(String(target.id)).catch(() => null)
            ]);
            if (!response?.ok) return interaction.editReply({ content: response?.message || 'Community level data is unavailable.' });
            return interaction.editReply(progressCardPayload(response.profile, target, achievements?.ok ? achievements : null));
          }

          if (!ownerOrManager(interaction, config)) {
            return interaction.reply({ content: 'Community XP administration requires Manage Server or Nexus owner access.', flags: MessageFlags.Ephemeral });
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const sub = interaction.options.getSubcommand();
          const actorId = String(interaction.user.id);
          const guild = interaction.guild || await client.guilds.fetch(String(config.discord.guildId));
          const levelChannel = (await ensureLevelUpChannel(guild)).channel;
          let settings = await settingsCache.get();

          if (['add', 'remove', 'set', 'reset'].includes(sub)) {
            const target = interaction.options.getUser('user', true);
            const reason = interaction.options.getString('reason') || `Admin ${sub} by ${interaction.user.username}`;
            let result;
            if (sub === 'add') result = await backend.communityAward({ userId: target.id, amount: interaction.options.getInteger('amount', true), source: 'admin', actorId, reason });
            if (sub === 'remove') result = await backend.communityRemoveXp({ userId: target.id, amount: interaction.options.getInteger('amount', true), actorId, reason });
            if (sub === 'set') result = await backend.communitySetXp({ userId: target.id, xp: interaction.options.getInteger('amount', true), actorId, reason });
            if (sub === 'reset') result = await backend.communityResetXp({ userId: target.id, actorId, reason });
            if (!result?.ok) return interaction.editReply({ content: `⚠️ ${result?.message || 'XP update failed.'}` });
            settings = await settingsCache.get(true);
            const roleSync = await applyProgressResult({ client, guild, channel: levelChannel, userId: target.id, result, settings, backend, announce: sub === 'add' || sub === 'set', forceRoleSync: true });
            return interaction.editReply({ content: `✅ ${target.username}: **${result.profile?.xp || 0} XP • Level ${result.profile?.level || 1}**${roleSync.roles?.warnings?.length ? `\n⚠️ Role sync: ${roleSync.roles.warnings.join(' | ')}` : ''}` });
          }

          if (sub === 'multiplier') {
            const value = interaction.options.getNumber('value', true);
            const response = await backend.communityUpdateSettings({ globalMultiplier: value, actorId, reason: 'Global XP multiplier changed' });
            settingsCache.set(response.settings);
          }

          if (sub === 'source') {
            const source = interaction.options.getString('source', true);
            const enabled = interaction.options.getBoolean('enabled', true);
            const response = await backend.communityUpdateSettings({ sources: { [source]: enabled }, actorId, reason: `${source} XP source ${enabled ? 'enabled' : 'disabled'}` });
            settingsCache.set(response.settings);
          }

          if (sub === 'ignore-channel') {
            const action = interaction.options.getString('action', true);
            const channel = interaction.options.getChannel('channel', true);
            const ids = new Set(settings.ignoredChannelIds || []);
            if (action === 'add') ids.add(String(channel.id)); else ids.delete(String(channel.id));
            const response = await backend.communityUpdateSettings({ ignoredChannelIds: [...ids], actorId, reason: `${action} ignored XP channel ${channel.id}` });
            settingsCache.set(response.settings);
          }

          if (sub === 'ignore-role') {
            const action = interaction.options.getString('action', true);
            const role = interaction.options.getRole('role', true);
            const ids = new Set(settings.ignoredRoleIds || []);
            if (action === 'add') ids.add(String(role.id)); else ids.delete(String(role.id));
            const response = await backend.communityUpdateSettings({ ignoredRoleIds: [...ids], actorId, reason: `${action} ignored XP role ${role.id}` });
            settingsCache.set(response.settings);
          }

          if (sub === 'status') return interaction.editReply({ content: formatSettings(settings, client) });

          settings = await settingsCache.get(true);
          if (levelChannel) await reconcileLevelPanel(levelChannel, overviewPayload(settings, { messageContentEnabled: messageContentEnabled(client) }), { botId: client.user?.id });
          return interaction.editReply({ content: `✅ Community XP settings updated.\n\n${formatSettings(settings, client)}` });
        } catch (error) {
          const content = `⚠️ ${String(error?.message || error).slice(0, 1700)}`;
          try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          } catch {}
        }
      });
    }

    client.once(Events.ClientReady, async () => {
      const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
      try {
        const commands = await registerLevelCommands(guild);
        console.log(`[Nexus Sentinal] community leveling commands registered: ${commands.map((name) => `/${name}`).join(', ')}`);
      } catch (error) {
        console.warn(`[Nexus Sentinal] community leveling command registration failed: ${String(error?.message || error).slice(0, 200)}`);
      }

      const panelTimer = setTimeout(async () => {
        try {
          const result = await refreshLevelPanel(client, config, backend, settingsCache);
          if (result.skipped) console.warn(`[Nexus Sentinal] community leveling panel skipped: ${result.skipped}`);
          else console.log(`[Nexus Sentinal] community leveling ready: channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} panelCreated=${result.created} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} messageContent=${messageContentEnabled(client)}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] community leveling panel unavailable: ${String(error?.message || error).slice(0, 200)}`);
        }
      }, INITIAL_PANEL_DELAY_MS);
      panelTimer.unref?.();

      const panelRefresh = setInterval(async () => {
        try { await refreshLevelPanel(client, config, backend, settingsCache); } catch {}
      }, PANEL_REFRESH_MS);
      panelRefresh.unref?.();

      const voiceTick = setInterval(async () => {
        try {
          const settings = await settingsCache.get();
          if (settings.enabled === false || settings.sources?.voice === false) { voiceStartedAt.clear(); return; }
          const eligible = await eligibleVoiceMembers(guild, settings);
          const eligibleIds = new Set(eligible.map((member) => String(member.id)));
          for (const id of [...voiceStartedAt.keys()]) if (!eligibleIds.has(id)) voiceStartedAt.delete(id);
          const now = nowMs();
          const intervalMs = Math.max(60_000, Number(settings.voice?.intervalSeconds || 600) * 1000);
          for (const member of eligible) {
            const id = String(member.id);
            const started = voiceStartedAt.get(id);
            if (!started) { voiceStartedAt.set(id, now); continue; }
            if (now - started < intervalMs) continue;
            voiceStartedAt.set(id, now);
            const result = await backend.communityAward({ userId: id, amount: Number(settings.voice?.xp || 10), source: 'voice' });
            if (!result?.ok || Number(result.awarded || 0) <= 0) continue;
            const levelChannel = (await ensureLevelUpChannel(guild)).channel;
            await applyProgressResult({ client, guild, channel: levelChannel, userId: id, result, settings, backend, announce: true });
          }
        } catch (error) {
          console.warn(`[Nexus Sentinal] voice XP unavailable: ${String(error?.message || error).slice(0, 180)}`);
        }
      }, VOICE_TICK_MS);
      voiceTick.unref?.();
    });

    return originalLogin.apply(client, args);
  };
}

module.exports = {
  SETTINGS_CACHE_MS,
  VOICE_TICK_MS,
  PANEL_REFRESH_MS,
  INITIAL_PANEL_DELAY_MS,
  nowMs,
  messageContentEnabled,
  ownerOrManager,
  createSettingsCache,
  createMessageAwardGuard,
  registerLevelCommands,
  refreshLevelPanel,
  applyProgressResult,
  formatSettings,
  eligibilityRoleBlocked,
  eligibleVoiceMembers,
  installCommunityLevelingExtension
};