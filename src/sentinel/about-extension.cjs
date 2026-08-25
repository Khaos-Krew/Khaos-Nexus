'use strict';

const { ChannelType, Client, Events, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');

const INSTALLED = Symbol.for('khaos.nexus.about.extension');
const ABOUT_PANEL_MARKER = 'Nexus Sentinal • Managed About • v1';
const ABOUT_PANEL_TITLE = '🌌 WELCOME TO KHAOS NEXUS';
const ABOUT_TOPIC = 'Learn what Khaos Nexus is, explore what the community offers, and invite others to join the Nexus.';
const RECENT_MESSAGE_LIMIT = 100;
const INITIAL_DELAY_MS = 10_000;
const REFRESH_MS = 15 * 60_000;

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isAboutChannel(channel) {
  if (!channel?.isTextBased?.() && channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return false;
  return normalizeChannelName(channel.name) === 'about';
}

function findAboutChannel(channels, informationCategoryId = '') {
  const matches = valuesOf(channels).filter(isAboutChannel);
  if (!matches.length) return null;
  if (!informationCategoryId) return matches[0];
  return matches.find((channel) => String(channel.parentId || '') === String(informationCategoryId)) || matches[0];
}

function bitfieldOf(value) {
  if (typeof value === 'bigint') return value;
  if (value?.bitfield !== undefined) return BigInt(value.bitfield);
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function permissionMask(values = []) {
  return (Array.isArray(values) ? values : []).reduce((mask, value) => mask | BigInt(value), 0n);
}

function overwriteSatisfies(channel, targetId, plan = {}) {
  const id = String(targetId || '');
  if (!id) return false;
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(id);
  if (!overwrite) return false;
  const allowMask = permissionMask(plan.allow || []);
  const denyMask = permissionMask(plan.deny || []);
  const actualAllow = bitfieldOf(overwrite.allow);
  const actualDeny = bitfieldOf(overwrite.deny);
  return (actualAllow & allowMask) === allowMask && (actualDeny & denyMask) === denyMask;
}

async function applyAboutPermissions(channel, guild, botId = '') {
  if (!channel?.permissionOverwrites?.edit || !guild?.roles?.everyone) {
    return { membersReadOnly: false, sentinalWritable: false, permissionsUpdated: false, membersPermissionUpdated: false, sentinalPermissionUpdated: false };
  }

  const everyoneId = String(guild.roles.everyone.id || guild.roles.everyone);
  const memberDeny = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads
  ];
  let membersPermissionUpdated = false;
  if (!overwriteSatisfies(channel, everyoneId, { deny: memberDeny })) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false
    }, { reason: 'Keep Khaos Nexus #about read-only for members' });
    membersPermissionUpdated = true;
  }

  const resolvedBotId = String(botId || guild?.members?.me?.id || '').trim();
  if (!resolvedBotId) {
    return {
      membersReadOnly: true,
      sentinalWritable: false,
      permissionsUpdated: membersPermissionUpdated,
      membersPermissionUpdated,
      sentinalPermissionUpdated: false
    };
  }
  let botMember = guild?.members?.me || null;
  if (!botMember || String(botMember.id || '') !== resolvedBotId) {
    botMember = await guild.members?.fetch?.(resolvedBotId).catch?.(() => null) || null;
  }
  const botAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.CreateInstantInvite
  ];
  let sentinalPermissionUpdated = false;
  if (!overwriteSatisfies(channel, resolvedBotId, { allow: botAllow })) {
    const target = botMember || resolvedBotId;
    await channel.permissionOverwrites.edit(target, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true,
      CreateInstantInvite: true
    }, { reason: 'Allow Nexus Sentinal to maintain Khaos Nexus #about' });
    sentinalPermissionUpdated = true;
  }
  return {
    membersReadOnly: true,
    sentinalWritable: true,
    permissionsUpdated: membersPermissionUpdated || sentinalPermissionUpdated,
    membersPermissionUpdated,
    sentinalPermissionUpdated
  };
}

async function ensureAboutChannel(guild, options = {}) {
  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);
  if (!information) return { channel: null, category: null, created: false, moved: false, topicUpdated: false, permissionsUpdated: false };

  let channel = findAboutChannel(channels, information.id);
  let created = false;
  let moved = false;
  let topicUpdated = false;

  if (!channel) {
    if (typeof guild.channels.create !== 'function') return { channel: null, category: information, created: false, moved: false, topicUpdated: false, permissionsUpdated: false };
    channel = await guild.channels.create({
      name: 'about',
      type: ChannelType.GuildText,
      parent: information.id,
      topic: ABOUT_TOPIC,
      reason: 'Nexus Sentinal managed Khaos Nexus About channel'
    });
    created = true;
  } else {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep About under the INFORMATION category' });
      moved = true;
    }
    if (String(channel.topic || '') !== ABOUT_TOPIC && typeof channel.setTopic === 'function') {
      await channel.setTopic(ABOUT_TOPIC, 'Keep the Khaos Nexus About description current');
      topicUpdated = true;
    }
  }

  const permissions = await applyAboutPermissions(channel, guild, options.botId);
  return {
    channel,
    category: information,
    created,
    moved,
    topicUpdated,
    ...permissions
  };
}

function isPermanentInvite(invite = {}) {
  return Number(invite.maxAge ?? invite.max_age ?? 0) === 0
    && Number(invite.maxUses ?? invite.max_uses ?? 0) === 0
    && invite.temporary !== true
    && Boolean(invite.code);
}

function findCanonicalInvite(invitesInput, botId = '') {
  const permanent = valuesOf(invitesInput).filter(isPermanentInvite);
  const ownerId = String(botId || '');
  return permanent.find((invite) => String(invite.inviter?.id || invite.inviterId || '') === ownerId) || permanent[0] || null;
}

function inviteUrl(invite) {
  const explicit = String(invite?.url || '').trim();
  if (/^https:\/\/(?:www\.)?discord(?:app)?\.(?:gg|com)\//i.test(explicit) || /^https:\/\/discord\.gg\//i.test(explicit)) return explicit;
  const code = String(invite?.code || '').trim();
  if (!code) throw new Error('Discord did not return a valid Khaos Nexus invite code.');
  return `https://discord.gg/${code}`;
}

async function ensurePermanentInvite(channel, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let invites = [];
  try { invites = valuesOf(await channel.fetchInvites()); } catch (error) {
    if (typeof channel.createInvite !== 'function') throw error;
  }
  let invite = findCanonicalInvite(invites, botId);
  let created = false;
  if (!invite) {
    if (typeof channel.createInvite !== 'function') throw new Error('Nexus Sentinal cannot create the Khaos Nexus community invite in #about.');
    invite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
      temporary: false,
      unique: false,
      reason: 'Khaos Nexus canonical community share invite'
    });
    created = true;
  }
  return { invite, url: inviteUrl(invite), created };
}

function renderAboutPanel(url) {
  return {
    embeds: [{
      title: ABOUT_PANEL_TITLE,
      description: '**Khaos Nexus** is a gaming, community, development, and creator ecosystem built around bringing people together.\n\nWhether you are here to find people to play with, use Nexus-powered game features, join community events, follow creators, participate in D&D campaigns, suggest improvements, or simply hang out — there is a place for you in the Nexus.',
      color: 0xe3264f,
      fields: [
        { name: '🎮 Gaming', value: 'Connect with players across supported games, find groups, follow tracked game servers, and use Nexus game integrations directly through Discord.', inline: false },
        { name: '🤖 Nexus Sentinal', value: 'Sentinal powers roles and access, server information, community tools, suggestions, reports, notifications, progression, and Nexus game integrations.', inline: false },
        { name: '🏆 Community Progression', value: 'Participate in the community, earn progression, unlock achievements, and take part in activities and events throughout the Nexus.', inline: false },
        { name: '💡 Help Shape the Nexus', value: 'Suggest games, integrations, features, events, and community improvements. Community-supported ideas can move into the Nexus development pipeline.', inline: false },
        { name: '🎥 Content Creators', value: 'Approved Twitch and YouTube creators can receive dedicated creator spaces, promotion opportunities, live notifications, and reusable Nexus creator branding.', inline: false },
        { name: '🎲 Nexus D&D', value: 'Join campaigns, build characters, explore custom content, and use Nexus-powered tabletop tools for adventures across the Shattered Realms.', inline: false },
        { name: '🛡️ Our Community', value: 'Khaos Nexus is intended to be a welcoming safe-space community. Harassment, discrimination, targeted abuse, and behavior intended to make others feel unsafe are not tolerated. Please review the server rules before participating.', inline: false },
        { name: '🔗 Invite Someone to the Nexus', value: `Know someone who would enjoy Khaos Nexus? Share our community invite:\n**${url}**\n\nThis invite does not expire and has unlimited uses.`, inline: false }
      ],
      footer: { text: ABOUT_PANEL_MARKER }
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Share Khaos Nexus', url, emoji: { name: '🔗' } }]
    }],
    allowedMentions: { parse: [] }
  };
}

function messageMatchesAboutPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  const embed = message?.embeds?.[0];
  return String(embed?.footer?.text || '') === ABOUT_PANEL_MARKER || String(embed?.title || '') === ABOUT_PANEL_TITLE;
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0))[0] || null;
}

function comparable(value) {
  return value?.toJSON ? value.toJSON() : value;
}

function panelPayloadMatches(message, payload) {
  const actualEmbeds = (message?.embeds || []).map(comparable);
  const desiredEmbeds = (payload?.embeds || []).map(comparable);
  const actualComponents = (message?.components || []).map(comparable);
  const desiredComponents = (payload?.components || []).map(comparable);
  return String(message?.content || '') === String(payload?.content || '')
    && JSON.stringify(actualEmbeds) === JSON.stringify(desiredEmbeds)
    && JSON.stringify(actualComponents) === JSON.stringify(desiredComponents);
}

async function reconcileAboutPanel(channel, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let recent = [];
  try { recent = valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })); } catch {}
  const candidates = recent.filter((message) => messageMatchesAboutPanel(message, botId));
  let message = newestMessage(candidates);
  let created = false;
  let updated = false;
  let duplicatesRemoved = 0;
  let pinned = false;

  if (message) {
    if (!panelPayloadMatches(message, payload)) {
      await message.edit(payload);
      updated = true;
    }
  } else if (typeof channel?.send === 'function') {
    message = await channel.send(payload);
    created = true;
  }
  if (!message) return { message: null, created: false, updated: false, duplicatesRemoved: 0, pinned: false };

  if (message.pinned !== true && typeof message.pin === 'function') {
    try {
      await message.pin('Nexus Sentinal canonical About panel');
      pinned = true;
    } catch {}
  }

  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate About panel cleanup');
      duplicatesRemoved += 1;
    } catch {}
  }

  return { message, created, updated, duplicatesRemoved, pinned };
}

async function refreshAboutPanel(client, config = {}, options = {}) {
  const guildId = String(config?.discord?.guildId || '').trim();
  if (!guildId) return { skipped: 'guild-unconfigured' };
  const guild = options.guild || await client.guilds.fetch(guildId);
  const channelResult = await ensureAboutChannel(guild, { botId: client.user?.id });
  if (!channelResult.channel) return { skipped: 'information-category-missing' };
  const inviteResult = await ensurePermanentInvite(channelResult.channel, { botId: client.user?.id });
  const payload = renderAboutPanel(inviteResult.url);
  const panel = await reconcileAboutPanel(channelResult.channel, payload, { botId: client.user?.id });
  return {
    channelId: String(channelResult.channel.id || ''),
    messageId: String(panel.message?.id || ''),
    channelCreated: channelResult.created,
    channelMoved: channelResult.moved,
    topicUpdated: channelResult.topicUpdated,
    permissionsUpdated: channelResult.permissionsUpdated,
    inviteCreated: inviteResult.created,
    panelCreated: panel.created,
    panelUpdated: panel.updated,
    duplicatesRemoved: panel.duplicatesRemoved,
    pinned: panel.pinned
  };
}

function installAboutExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusAboutLogin(...args) {
    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await refreshAboutPanel(this, config);
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] about (${reason}) skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] about (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} topicUpdated=${result.topicUpdated} permissionsUpdated=${result.permissionsUpdated} inviteCreated=${result.inviteCreated} panelCreated=${result.panelCreated} panelUpdated=${result.panelUpdated} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] about (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
        } finally {
          running = false;
        }
      };

      const initialTimer = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initialTimer.unref?.();
      const periodicTimer = setInterval(() => void run('periodic'), REFRESH_MS);
      periodicTimer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  ABOUT_PANEL_MARKER,
  ABOUT_PANEL_TITLE,
  ABOUT_TOPIC,
  RECENT_MESSAGE_LIMIT,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  normalizeChannelName,
  isAboutChannel,
  findAboutChannel,
  bitfieldOf,
  permissionMask,
  overwriteSatisfies,
  applyAboutPermissions,
  ensureAboutChannel,
  isPermanentInvite,
  findCanonicalInvite,
  inviteUrl,
  ensurePermanentInvite,
  renderAboutPanel,
  messageMatchesAboutPanel,
  newestMessage,
  panelPayloadMatches,
  reconcileAboutPanel,
  refreshAboutPanel,
  installAboutExtension
};
