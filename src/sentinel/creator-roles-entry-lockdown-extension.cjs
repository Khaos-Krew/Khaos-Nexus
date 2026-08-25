'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  PermissionFlagsBits,
  OverwriteType
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { resolveStaffRoleIds } = require('./staff-workspace.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');
const { minimumCreatorLevel } = require('./creator-level-gate.cjs');
const {
  CATEGORY_NAME,
  CREATOR_ROLE_NAME,
  APPLY_BUTTON_ID
} = require('./creator-program-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.creatorRolesEntryLockdown.extension');
const PANEL_MARKER = 'Nexus Sentinal • Creator Application Entry • v1';
const INITIAL_DELAY_MS = 45_000;
const REFRESH_MS = 60_000;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findRolesChannel(channels, configuredId = '') {
  const list = valuesOf(channels);
  if (configuredId) {
    const configured = list.find((channel) => String(channel?.id || '') === String(configuredId));
    if (configured?.isTextBased?.()) return configured;
  }
  return list.find((channel) => channel?.isTextBased?.() && normalizeName(channel.name) === 'roles') || null;
}

function findCreatorCategory(channels) {
  return valuesOf(channels).find((channel) => normalizeName(channel?.name) === normalizeName(CATEGORY_NAME)) || null;
}

function findCreatorRole(roles, state) {
  const creatorId = String(state?.getCreatorMeta?.()?.creatorRoleId || '');
  const list = valuesOf(roles);
  if (creatorId) {
    const exact = list.find((role) => String(role?.id || '') === creatorId);
    if (exact) return exact;
  }
  return list.find((role) => normalizeName(role?.name) === normalizeName(CREATOR_ROLE_NAME)) || null;
}

function entryPayload(minimumLevel) {
  return {
    embeds: [{
      title: '🎥 KHAOS NEXUS CONTENT CREATOR PROGRAM',
      description: 'Interested in joining the Khaos Nexus Content Creator Program? Applications are opened from here so the private creator workspace can stay hidden until a member is approved.',
      color: 0xe3264f,
      fields: [
        {
          name: '🔒 Application Requirement',
          value: `You must be **Community Level ${minimumLevel}+** before applying. This helps ensure applicants have spent meaningful time in the community before receiving creator-program review.`,
          inline: false
        },
        {
          name: '📺 Supported Platforms',
          value: 'Twitch and YouTube are supported first. Additional platforms can be added later after their integrations are accepted.',
          inline: false
        },
        {
          name: '📝 Review Process',
          value: 'Press the button below. Nexus Sentinal verifies your current Community Level before opening the application. Staff then reviews the application privately.',
          inline: false
        }
      ],
      footer: { text: PANEL_MARKER }
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(APPLY_BUTTON_ID)
        .setLabel('Apply for Creator Program')
        .setEmoji('🎥')
        .setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

async function reconcileEntryPanel(channel, minimumLevel, botId) {
  const payload = entryPayload(minimumLevel);
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = valuesOf(recent);
  const matches = messages.filter((message) => String(message.author?.id || '') === String(botId) && (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === PANEL_MARKER));
  matches.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = matches[0] || null;
  let created = false;
  let updated = false;
  if (!message) {
    message = await channel.send(payload);
    created = true;
  } else if (!managedPayloadMatches(message, payload)) {
    await message.edit(payload);
    updated = true;
  }
  for (const duplicate of matches.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate creator application entry cleanup'); } catch {}
  }
  return { messageId: String(message?.id || ''), created, updated, duplicatesRemoved: Math.max(0, matches.length - 1) };
}

async function enforceCreatorWorkspaceLock(guild, { state, config, botId } = {}) {
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const category = findCreatorCategory(channels);
  const creatorRole = findCreatorRole(roles, state);
  if (!category || !creatorRole) return { skipped: true, reason: !category ? 'creator-category-missing' : 'creator-role-missing', changed: 0 };

  const staffRoleIds = await resolveStaffRoleIds(guild, config).catch(() => []);
  const ownerIds = [...new Set([String(guild.ownerId || ''), ...(config.discord?.ownerUserIds || []).map(String)].filter(Boolean))];
  const children = valuesOf(channels).filter((channel) => String(channel?.parentId || '') === String(category.id));
  let changed = 0;

  for (const channel of children) {
    if (!channel?.permissionOverwrites?.edit) continue;
    await channel.permissionOverwrites.edit(String(guild.id), { ViewChannel: false }, { reason: 'Keep Content Creator Program private until approval' });
    await channel.permissionOverwrites.edit(String(creatorRole.id), {
      ViewChannel: true,
      ReadMessageHistory: true
    }, { reason: 'Approved Khaos Nexus creators may access creator workspace' });
    for (const roleId of staffRoleIds) {
      await channel.permissionOverwrites.edit(String(roleId), {
        ViewChannel: true,
        ReadMessageHistory: true
      }, { reason: 'Khaos Nexus staff creator-program access' }).catch(() => {});
    }
    for (const ownerId of ownerIds) {
      await channel.permissionOverwrites.edit(String(ownerId), {
        ViewChannel: true,
        ReadMessageHistory: true
      }, { type: OverwriteType.Member, reason: 'Khaos Nexus owner creator-program access' }).catch(() => {});
    }
    if (botId) {
      await channel.permissionOverwrites.edit(String(botId), {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        ManageMessages: true
      }, { type: OverwriteType.Member, reason: 'Nexus Sentinal creator-program management access' }).catch(() => {});
    }
    changed += 1;
  }

  return { skipped: false, reason: '', changed, categoryId: String(category.id), creatorRoleId: String(creatorRole.id) };
}

async function reconcileCreatorRolesEntry(client, { config, state } = {}) {
  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) return { skipped: true, reason: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const rolesChannel = findRolesChannel(channels, config.discord?.rolesChannelId || config.discordAutomation?.rolesChannelId || '');
  if (!rolesChannel?.messages?.fetch) return { skipped: true, reason: 'roles-channel-unavailable' };
  const minimumLevel = minimumCreatorLevel(config);
  const [panel, lock] = await Promise.all([
    reconcileEntryPanel(rolesChannel, minimumLevel, client.user?.id),
    enforceCreatorWorkspaceLock(guild, { state, config, botId: client.user?.id })
  ]);
  return { skipped: false, rolesChannelId: String(rolesChannel.id), minimumLevel, panel, lock };
}

function installCreatorRolesEntryLockdownExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const state = new StateStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusCreatorRolesEntryLockdownLogin(...args) {
    const client = this;
    let running = false;
    const run = async (reason) => {
      if (running) return;
      running = true;
      try {
        const result = await reconcileCreatorRolesEntry(client, { config, state });
        if (!result.skipped) console.log(`[Nexus Sentinal] creator roles entry (${reason}): rolesChannel=${result.rolesChannelId} minLevel=${result.minimumLevel} panelCreated=${result.panel.created} workspaceChannelsLocked=${result.lock?.changed || 0}`);
      } catch (error) {
        console.warn(`[Nexus Sentinal] creator roles entry (${reason}) unavailable: ${String(error?.message || error).slice(0, 260)}`);
      } finally { running = false; }
    };

    client.once(Events.ClientReady, () => {
      const initial = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), REFRESH_MS);
      periodic.unref?.();
    });
    client.on(Events.ChannelUpdate, (before, after) => {
      if (normalizeName(after?.parent?.name || '') !== normalizeName(CATEGORY_NAME)) return;
      void run('channel-update');
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  PANEL_MARKER,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  findRolesChannel,
  findCreatorCategory,
  findCreatorRole,
  entryPayload,
  reconcileEntryPanel,
  enforceCreatorWorkspaceLock,
  reconcileCreatorRolesEntry,
  installCreatorRolesEntryLockdownExtension
};
