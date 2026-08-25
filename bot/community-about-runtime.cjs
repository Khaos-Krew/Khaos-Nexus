'use strict';

const { Events, PermissionFlagsBits, Routes } = require('discord.js');

const INSTALLED = Symbol.for('khaos-nexus.community-about-runtime');
const ABOUT_CATEGORY_NAME = 'NEXUS INFORMATION';
const ABOUT_CHANNEL_NAME = 'about';
const ABOUT_TOPIC = 'Learn what Khaos Nexus is, explore what the community offers, and invite others to join the Nexus.';
const ABOUT_MARKER = 'Khaos Nexus • About • Managed by Nexus Sentinel';
const ABOUT_COLOR = 0xe3264f;
const SYNC_DELAY_MS = 1200;

const READ_ONLY_DENY =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.SendMessagesInThreads;

const SENTINEL_ALLOW =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.CreateInstantInvite |
  PermissionFlagsBits.ManageChannels;

function sameName(value, expected) {
  return String(value || '').trim().toLowerCase() === expected.toLowerCase();
}

function permissionValue(value) {
  try { return BigInt(String(value ?? 0)); }
  catch { return 0n; }
}

function normalizeOverwrite(overwrite = {}) {
  return {
    id: String(overwrite.id || ''),
    type: Number(overwrite.type) === 1 ? 1 : 0,
    allow: permissionValue(overwrite.allow).toString(),
    deny: permissionValue(overwrite.deny).toString()
  };
}

function upsertPermissionOverwrite(overwritesInput, { id, type, allowBits = 0n, denyBits = 0n } = {}) {
  const overwrites = (Array.isArray(overwritesInput) ? overwritesInput : []).map(normalizeOverwrite);
  const targetId = String(id || '');
  const targetType = Number(type) === 1 ? 1 : 0;
  const index = overwrites.findIndex((entry) => entry.id === targetId && entry.type === targetType);
  const current = index >= 0 ? overwrites[index] : { id: targetId, type: targetType, allow: '0', deny: '0' };
  let allow = permissionValue(current.allow);
  let deny = permissionValue(current.deny);
  const allowMask = permissionValue(allowBits);
  const denyMask = permissionValue(denyBits);
  allow = (allow & ~denyMask) | allowMask;
  deny = (deny & ~allowMask) | denyMask;
  const next = { id: targetId, type: targetType, allow: allow.toString(), deny: deny.toString() };
  if (index >= 0) overwrites[index] = next;
  else overwrites.push(next);
  return overwrites;
}

function aboutPermissionOverwrites(overwrites, guildId, botUserId) {
  let next = upsertPermissionOverwrite(overwrites, {
    id: guildId,
    type: 0,
    denyBits: READ_ONLY_DENY
  });
  next = upsertPermissionOverwrite(next, {
    id: botUserId,
    type: 1,
    allowBits: SENTINEL_ALLOW
  });
  return next;
}

function isPermanentInvite(invite = {}) {
  return Number(invite.max_age || 0) === 0 && Number(invite.max_uses || 0) === 0 && invite.temporary !== true && Boolean(invite.code);
}

function findCanonicalInvite(invitesInput, botUserId) {
  const invites = (Array.isArray(invitesInput) ? invitesInput : []).filter(isPermanentInvite);
  return invites.find((invite) => String(invite.inviter?.id || '') === String(botUserId || '')) || invites[0] || null;
}

function inviteUrl(invite) {
  const code = String(invite?.code || '').trim();
  if (!code) throw new Error('Discord did not return a valid community invite code.');
  return `https://discord.gg/${code}`;
}

function renderAboutMessage(url) {
  return {
    embeds: [{
      title: '🌌 Welcome to Khaos Nexus',
      description: '**Khaos Nexus** is a gaming, community, development, and creator ecosystem built around bringing people together.\n\nWhether you are here to find people to play with, use Nexus-powered game features, join community events, follow creators, participate in D&D campaigns, suggest improvements, or simply hang out — there is a place for you in the Nexus.',
      color: ABOUT_COLOR,
      fields: [
        { name: '🎮 Gaming', value: 'Connect with players across supported games, find groups, follow game-server information, and use Nexus game integrations through Discord.', inline: false },
        { name: '🤖 Nexus Sentinel', value: 'Sentinel powers Discord automation, roles and access, server information, community tools, suggestions, reports, notifications, and game integrations.', inline: false },
        { name: '🏆 Community Progression', value: 'Take part in community progression, events, achievements, and activities across the Nexus.', inline: false },
        { name: '💡 Help Shape the Nexus', value: 'Suggest games, integrations, features, events, and community improvements. Community-supported ideas can move into the Nexus development pipeline.', inline: false },
        { name: '🎥 Content Creators', value: 'Approved Twitch and YouTube creators can receive dedicated creator spaces, promotion tools, live notifications, and reusable Nexus creator branding.', inline: false },
        { name: '🎲 Nexus D&D', value: 'Join campaigns, build characters, explore custom content, and use Nexus-powered tools for tabletop adventures and the expanding Shattered Realms setting.', inline: false },
        { name: '🛡️ Our Community', value: 'Khaos Nexus is intended to be a welcoming safe-space community. Harassment, discrimination, targeted abuse, and behavior intended to make others feel unsafe are not tolerated. Please review the server rules before participating.', inline: false },
        { name: '🔗 Invite Someone to the Nexus', value: `Know someone who would enjoy Khaos Nexus? Share our community invite:\n**${url}**\n\nThis invite does not expire and has unlimited uses.`, inline: false }
      ],
      footer: { text: ABOUT_MARKER }
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Share Khaos Nexus', url, emoji: { name: '🔗' } }]
    }],
    allowed_mentions: { parse: [] }
  };
}

function managedAboutMessage(messagesInput, botUserId) {
  return (Array.isArray(messagesInput) ? messagesInput : []).find((message) =>
    String(message.author?.id || '') === String(botUserId || '') &&
    (Array.isArray(message.embeds) ? message.embeds : []).some((embed) => embed.footer?.text === ABOUT_MARKER)
  ) || null;
}

function channelNeedsPatch(channel, categoryId, overwrites) {
  if (String(channel?.parent_id || '') !== String(categoryId || '')) return true;
  if (String(channel?.topic || '') !== ABOUT_TOPIC) return true;
  const current = (Array.isArray(channel?.permission_overwrites) ? channel.permission_overwrites : []).map(normalizeOverwrite);
  const wanted = (Array.isArray(overwrites) ? overwrites : []).map(normalizeOverwrite);
  return JSON.stringify(current) !== JSON.stringify(wanted);
}

async function ensureCommunityAbout({ client, guildId, log } = {}) {
  if (!client?.rest || !client?.user?.id) throw new Error('Discord client is not ready for the community About sync.');
  if (!/^\d{5,25}$/.test(String(guildId || ''))) throw new Error('A valid Discord guild ID is required for the community About sync.');

  const rest = client.rest;
  const botUserId = String(client.user.id);
  let channels = await rest.get(Routes.guildChannels(guildId));
  channels = Array.isArray(channels) ? channels : [];

  let category = channels.find((channel) => Number(channel.type) === 4 && sameName(channel.name, ABOUT_CATEGORY_NAME));
  let createdCategory = false;
  if (!category) {
    category = await rest.post(Routes.guildChannels(guildId), {
      body: { name: ABOUT_CATEGORY_NAME, type: 4 },
      reason: 'Khaos Nexus community About channel baseline'
    });
    channels.push(category);
    createdCategory = true;
  }

  let channel = channels.find((item) => Number(item.type) === 0 && sameName(item.name, ABOUT_CHANNEL_NAME) && String(item.parent_id || '') === String(category.id));
  if (!channel) channel = channels.find((item) => Number(item.type) === 0 && sameName(item.name, ABOUT_CHANNEL_NAME));

  let createdChannel = false;
  const desiredOverwrites = aboutPermissionOverwrites(channel?.permission_overwrites, guildId, botUserId);
  if (!channel) {
    channel = await rest.post(Routes.guildChannels(guildId), {
      body: {
        name: ABOUT_CHANNEL_NAME,
        type: 0,
        parent_id: String(category.id),
        topic: ABOUT_TOPIC,
        permission_overwrites: desiredOverwrites
      },
      reason: 'Khaos Nexus community About channel baseline'
    });
    createdChannel = true;
  } else if (channelNeedsPatch(channel, category.id, desiredOverwrites)) {
    channel = await rest.patch(Routes.channel(String(channel.id)), {
      body: {
        parent_id: String(category.id),
        topic: ABOUT_TOPIC,
        permission_overwrites: desiredOverwrites
      },
      reason: 'Maintain the Khaos Nexus read-only About channel'
    });
  }

  let invites = await rest.get(Routes.channelInvites(String(channel.id)));
  let invite = findCanonicalInvite(invites, botUserId);
  let createdInvite = false;
  if (!invite) {
    invite = await rest.post(Routes.channelInvites(String(channel.id)), {
      body: { max_age: 0, max_uses: 0, temporary: false, unique: false },
      reason: 'Khaos Nexus canonical community share invite'
    });
    createdInvite = true;
  }
  const url = inviteUrl(invite);
  const payload = renderAboutMessage(url);

  let messages = await rest.get(Routes.channelMessages(String(channel.id)), {
    query: new URLSearchParams({ limit: '100' })
  });
  const managed = managedAboutMessage(messages, botUserId);
  let message;
  let createdMessage = false;
  if (managed) {
    message = await rest.patch(Routes.channelMessage(String(channel.id), String(managed.id)), { body: payload });
  } else {
    message = await rest.post(Routes.channelMessages(String(channel.id)), { body: payload });
    createdMessage = true;
  }

  const result = {
    guildId: String(guildId),
    categoryId: String(category.id),
    channelId: String(channel.id),
    messageId: String(message.id),
    inviteUrl: url,
    createdCategory,
    createdChannel,
    createdInvite,
    createdMessage
  };
  log?.('info', `Community About sync complete for guild ${guildId}.`, {
    channelId: result.channelId,
    messageId: result.messageId,
    createdCategory,
    createdChannel,
    createdInvite,
    createdMessage
  });
  return result;
}

function installCommunityAboutRuntime({ client, getBootstrap, send, log } = {}) {
  if (!client) return null;
  if (client[INSTALLED]) return client[INSTALLED];

  let timer = null;
  let inFlight = null;

  const syncNow = async () => {
    const guildId = String(getBootstrap?.()?.config?.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) {
      log?.('warn', 'Community About sync skipped because the Discord guild ID is not configured.');
      return { skipped: true, reason: 'guild-not-configured' };
    }
    if (inFlight) return inFlight;
    inFlight = ensureCommunityAbout({ client, guildId, log })
      .catch((error) => {
        log?.('error', `Community About sync failed: ${error.stack || error.message}`);
        send?.('error', { source: 'community-about', message: String(error.message || error) });
        throw error;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const schedule = () => {
    clearTimeout(timer);
    if (!client.isReady?.()) return;
    timer = setTimeout(() => { syncNow().catch(() => {}); }, SYNC_DELAY_MS);
    timer.unref?.();
  };

  client.once(Events.ClientReady, schedule);
  const controller = { onConfigUpdate: schedule, syncNow };
  Object.defineProperty(client, INSTALLED, { value: controller });
  return controller;
}

module.exports = {
  ABOUT_CATEGORY_NAME,
  ABOUT_CHANNEL_NAME,
  ABOUT_TOPIC,
  ABOUT_MARKER,
  READ_ONLY_DENY,
  SENTINEL_ALLOW,
  aboutPermissionOverwrites,
  findCanonicalInvite,
  inviteUrl,
  renderAboutMessage,
  managedAboutMessage,
  channelNeedsPatch,
  ensureCommunityAbout,
  installCommunityAboutRuntime
};
