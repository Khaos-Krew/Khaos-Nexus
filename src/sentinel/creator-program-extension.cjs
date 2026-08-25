'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { findStaffCategory, resolveStaffRoleIds } = require('./staff-workspace.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const INSTALLED = Symbol.for('khaos.nexus.creator-program.extension');
const CATEGORY_NAME = 'CONTENT CREATOR PROGRAM';
const PROGRAM_CHANNEL = 'creator-program';
const ASSETS_CHANNEL = 'creator-assets';
const CREATOR_CHAT_CHANNEL = 'creator-chat';
const TWITCH_LIVE_CHANNEL = 'twitch-live';
const YOUTUBE_LIVE_CHANNEL = 'youtube-live';
const REVIEW_CHANNEL = 'creator-review';
const CREATOR_ROLE_NAME = 'Content Creator';
const NOW_LIVE_ROLE_NAME = 'Now Live';
const PROGRAM_MARKER = 'Nexus Sentinal • Creator Program • v1';
const ASSETS_MARKER = 'Nexus Sentinal • Creator Assets • v1';
const APPLY_BUTTON_ID = 'kn:creator:apply';
const APPLY_MODAL_ID = 'kn:creator:apply-modal';
const INITIAL_DELAY_MS = 30_000;
const REFRESH_MS = 15 * 60_000;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function cleanText(value, max, fallback = '') {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function parsePlatforms(value) {
  const text = String(value || '').toLowerCase();
  const platforms = [];
  if (/twitch/.test(text)) platforms.push('twitch');
  if (/youtube|you tube|yt\b/.test(text)) platforms.push('youtube');
  return platforms.length ? platforms : ['other'];
}

function findCategory(channels) {
  return valuesOf(channels).find((channel) => channel?.type === ChannelType.GuildCategory && normalizeName(channel.name) === normalizeName(CATEGORY_NAME)) || null;
}

function findChannel(channels, name, categoryId = '') {
  return valuesOf(channels).find((channel) => channel?.isTextBased?.() && normalizeName(channel.name) === normalizeName(name) && (!categoryId || String(channel.parentId || '') === String(categoryId))) || null;
}

function findRole(roles, name) {
  return valuesOf(roles).find((role) => role && role.managed !== true && normalizeName(role.name) === normalizeName(name)) || null;
}

async function ensureProgramRoles(guild) {
  const roles = await guild.roles.fetch();
  let creatorRole = findRole(roles, CREATOR_ROLE_NAME);
  let nowLiveRole = findRole(roles, NOW_LIVE_ROLE_NAME);
  let creatorRoleCreated = false;
  let nowLiveRoleCreated = false;

  if (!creatorRole) {
    creatorRole = await guild.roles.create({
      name: CREATOR_ROLE_NAME,
      color: 0,
      hoist: false,
      mentionable: false,
      reason: 'Khaos Nexus approved Content Creator program role'
    });
    creatorRoleCreated = true;
  }
  if (!nowLiveRole) {
    nowLiveRole = await guild.roles.create({
      name: NOW_LIVE_ROLE_NAME,
      color: 0,
      hoist: true,
      mentionable: false,
      reason: 'Khaos Nexus temporary live creator role'
    });
    nowLiveRoleCreated = true;
  }
  return { creatorRole, nowLiveRole, creatorRoleCreated, nowLiveRoleCreated };
}

function publicReadOnlyOverwrites(guild, botId) {
  return [
    {
      id: String(guild.id),
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads]
    },
    {
      id: String(botId),
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages]
    }
  ];
}

function creatorOnlyOverwrites(guild, botId, creatorRoleId, { writable = false } = {}) {
  const creatorAllow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  if (writable) creatorAllow.push(PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions);
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: String(creatorRoleId), type: OverwriteType.Role, allow: creatorAllow, ...(writable ? {} : { deny: [PermissionFlagsBits.SendMessages] }) },
    {
      id: String(botId),
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages]
    }
  ];
}

async function ensureCategory(guild) {
  const channels = await guild.channels.fetch();
  let category = findCategory(channels);
  let created = false;
  if (!category) {
    category = await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory, reason: 'Khaos Nexus Content Creator Program' });
    created = true;
  }
  return { category, created };
}

async function ensureTextChannel(guild, category, name, topic, overwrites) {
  const channels = await guild.channels.fetch();
  let channel = findChannel(channels, name, category.id);
  let created = false;
  let moved = false;
  if (!channel) {
    const elsewhere = findChannel(channels, name);
    if (elsewhere && typeof elsewhere.setParent === 'function') {
      channel = elsewhere;
      await channel.setParent(category.id, { lockPermissions: false, reason: `Move ${name} into Content Creator Program` });
      moved = true;
    } else {
      channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, topic, permissionOverwrites: overwrites, reason: 'Khaos Nexus Content Creator Program' });
      created = true;
    }
  }
  if (String(channel.topic || '') !== topic && typeof channel.setTopic === 'function') await channel.setTopic(topic, 'Maintain Khaos Nexus creator program channel topic');
  if (channel.permissionOverwrites?.set) await channel.permissionOverwrites.set(overwrites, 'Maintain Khaos Nexus creator program permissions');
  return { channel, created, moved };
}

function ownerIds(guild, config = {}) {
  return normalizeIds([guild?.ownerId, ...(config.discord?.ownerUserIds || [])]);
}

function reviewOverwrites(guild, botId, staffRoleIds, owners) {
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages];
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(staffRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow })),
    ...normalizeIds(owners).map((id) => ({ id, type: OverwriteType.Member, allow })),
    { id: String(botId), type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels] }
  ];
}

async function ensureReviewChannel(guild, config, botId) {
  const staffCategory = findStaffCategory(await guild.channels.fetch());
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const owners = ownerIds(guild, config);
  const channels = await guild.channels.fetch();
  let channel = findChannel(channels, REVIEW_CHANNEL, staffCategory?.id || '');
  let created = false;
  let moved = false;
  if (!channel) {
    const elsewhere = findChannel(channels, REVIEW_CHANNEL);
    if (elsewhere && staffCategory && typeof elsewhere.setParent === 'function') {
      channel = elsewhere;
      await channel.setParent(staffCategory.id, { lockPermissions: false, reason: 'Move creator review into protected Staff workspace' });
      moved = true;
    } else {
      channel = await guild.channels.create({
        name: REVIEW_CHANNEL,
        type: ChannelType.GuildText,
        parent: staffCategory?.id || undefined,
        topic: 'Staff review queue for Khaos Nexus Content Creator Program applications.',
        permissionOverwrites: reviewOverwrites(guild, botId, staffRoleIds, owners),
        reason: 'Khaos Nexus creator application review queue'
      });
      created = true;
    }
  }
  if (channel.permissionOverwrites?.set) await channel.permissionOverwrites.set(reviewOverwrites(guild, botId, staffRoleIds, owners), 'Protect Khaos Nexus creator application review');
  return { channel, created, moved, staffRoleIds, owners };
}

function providerStatus(env = process.env) {
  return {
    twitch: Boolean(String(env.TWITCH_CLIENT_ID || '').trim() && String(env.TWITCH_CLIENT_SECRET || '').trim()),
    youtube: Boolean(String(env.YOUTUBE_API_KEY || '').trim())
  };
}

function programPayload(env = process.env) {
  const providers = providerStatus(env);
  return {
    embeds: [{
      title: '🎥 KHAOS NEXUS CONTENT CREATOR PROGRAM',
      description: 'The Content Creator Program gives approved community creators a dedicated place inside Khaos Nexus for collaboration, promotion resources, and live visibility. Creator access is **application-based** — it is never granted automatically just for posting a channel link.',
      color: 0xe3264f,
      fields: [
        { name: '📺 Initial Platforms', value: 'Twitch and YouTube are the initial supported platforms. TikTok may be added later after the first two provider integrations are stable.', inline: false },
        { name: '📝 How to Join', value: 'Use **Apply for Creator Program** below. Staff reviews your platform/channel, content focus, and community fit. Approved applicants receive the **Content Creator** role.', inline: false },
        { name: '🔴 Now Live', value: 'The **Now Live** role is temporary and intentionally has no name color so member-selected Name Color roles keep visual priority. Automatic live detection activates only through authorized platform adapters.', inline: false },
        { name: '🧰 Creator Resources', value: 'Approved creators receive access to reusable Khaos Nexus promotional assets/templates designed so the creator name can be added without changing the core Nexus identity.', inline: false },
        { name: '🔌 Live Provider Status', value: `Twitch: **${providers.twitch ? 'credentialed' : 'provider setup pending'}**\nYouTube: **${providers.youtube ? 'credentialed' : 'provider setup pending'}**`, inline: false },
        { name: '🛡️ Community Standard', value: 'Creator status does not override community rules or staff moderation. Creators represent themselves; program approval is access to Nexus creator features, not an endorsement of every external post or stream.', inline: false }
      ],
      footer: { text: PROGRAM_MARKER }
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(APPLY_BUTTON_ID).setLabel('Apply for Creator Program').setStyle(ButtonStyle.Primary).setEmoji('🎥')
    )],
    allowedMentions: { parse: [] }
  };
}

function assetsPayload() {
  return {
    embeds: [{
      title: '🧰 KHAOS NEXUS CREATOR ASSETS',
      description: 'This is the managed home for official creator-facing Khaos Nexus promotional resources.',
      color: 0xe3264f,
      fields: [
        { name: 'Reusable by design', value: 'Creator emblems and promotional graphics preserve the approved Khaos Nexus base identity while leaving a safe area where the creator name can be added.', inline: false },
        { name: 'Asset rule', value: 'Use official Nexus assets from this channel rather than rebuilding the core logo/identity from scratch. Sentinal will keep this resource surface current as new creator formats are approved.', inline: false },
        { name: 'Asset pack status', value: 'The Discord asset library is ready. The reusable image pack itself remains a separate visual-asset delivery item so the approved Nexus base artwork can be used as the source.', inline: false }
      ],
      footer: { text: ASSETS_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
}

async function reconcilePanel(channel, payload, marker, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = recent?.values ? [...recent.values()] : [];
  const matches = messages.filter((message) => String(message.author?.id || '') === String(botId) && (message.embeds || []).some((embed) => String(embed.footer?.text || '') === marker));
  matches.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = matches[0] || null;
  let created = false;
  let updated = false;
  if (message) {
    if (!managedPayloadMatches(message, payload)) { await message.edit(payload); updated = true; }
  } else { message = await channel.send(payload); created = true; }
  let pinned = false;
  if (!message.pinned && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical creator program panel'); pinned = true; } catch {}
  }
  let duplicatesRemoved = 0;
  for (const duplicate of matches.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate creator program panel cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, updated, pinned, duplicatesRemoved };
}

function applicationModal() {
  return new ModalBuilder()
    .setCustomId(APPLY_MODAL_ID)
    .setTitle('Creator Program Application')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('platforms').setLabel('Platform(s): Twitch / YouTube').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setPlaceholder('Twitch, YouTube, or both')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel').setLabel('Channel URL or handle').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('https://twitch.tv/... or YouTube channel URL')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('What content do you create?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(750).setPlaceholder('Games, stream style, upload/stream frequency, etc.')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Why join the Nexus creator program?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(750).setPlaceholder('How you want to participate in or promote the community'))
    );
}

function reviewMarker(id) { return `Nexus Sentinal • Creator Review • ${id}`; }

function reviewPayload(application) {
  const pending = application.status === 'pending';
  const fields = [
    { name: 'Applicant', value: `<@${application.userId}> • ${application.userName}`, inline: false },
    { name: 'Platforms', value: application.platformText, inline: true },
    { name: 'Channel', value: application.channelRef, inline: false },
    { name: 'Content', value: application.content, inline: false },
    { name: 'Why Nexus?', value: application.reason, inline: false },
    { name: 'Status', value: application.status === 'approved' ? '✅ Approved' : application.status === 'denied' ? '⛔ Denied' : '🧭 Pending review', inline: true }
  ];
  if (application.reviewReason) fields.push({ name: application.status === 'denied' ? 'Denial Reason' : 'Review Note', value: application.reviewReason, inline: false });
  const components = pending ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kn:creator:review:${application.id}:approve`).setLabel('Approve Creator').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`kn:creator:review:${application.id}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('⛔')
  )] : [];
  return {
    embeds: [{
      title: `🎥 ${application.id} • Creator Application`,
      description: 'Review the applicant for Content Creator Program access. Approval assigns the non-color **Content Creator** role; livestream status remains provider-controlled.',
      color: application.status === 'approved' ? 0x2ecc71 : application.status === 'denied' ? 0x992d22 : 0xe3264f,
      fields,
      footer: { text: reviewMarker(application.id) },
      timestamp: application.createdAt
    }],
    components,
    allowedMentions: { parse: [] }
  };
}

async function findReviewMessage(channel, applicationId, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = recent?.values ? [...recent.values()] : [];
  return messages.find((message) => String(message.author?.id || '') === String(botId) && (message.embeds || []).some((embed) => String(embed.footer?.text || '') === reviewMarker(applicationId))) || null;
}

function isReviewer(interaction, config, staffRoleIds = []) {
  const userId = String(interaction.user?.id || '');
  if (new Set(ownerIds(interaction.guild, config)).has(userId)) return true;
  const member = interaction.member;
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator) || member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return normalizeIds(staffRoleIds).some((id) => member?.roles?.cache?.has?.(id));
}

function denialModal(applicationId) {
  return new ModalBuilder()
    .setCustomId(`kn:creator:deny-modal:${applicationId}`)
    .setTitle(`Deny ${applicationId}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(1000).setPlaceholder('Explain why the application is not being approved.')
    ));
}

async function submitApplication(interaction, store, reviewChannel) {
  const existing = store.findCreatorApplicationByUser(interaction.user.id, ['pending', 'approved']);
  if (existing) return { duplicate: existing };
  const allocation = store.allocateCreatorApplicationId();
  const application = {
    id: allocation.id,
    number: allocation.number,
    userId: String(interaction.user.id),
    userName: cleanText(interaction.user.globalName || interaction.user.username || 'Creator Applicant', 100),
    platformText: cleanText(interaction.fields.getTextInputValue('platforms'), 60),
    platforms: parsePlatforms(interaction.fields.getTextInputValue('platforms')),
    channelRef: cleanText(interaction.fields.getTextInputValue('channel'), 200),
    content: cleanText(interaction.fields.getTextInputValue('content'), 750),
    reason: cleanText(interaction.fields.getTextInputValue('reason'), 750),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: '',
    reviewedBy: '',
    reviewReason: '',
    reviewMessageId: ''
  };
  const message = await reviewChannel.send(reviewPayload(application));
  application.reviewMessageId = String(message.id);
  store.setCreatorApplication(application.id, application);
  return { application };
}

async function applyDecision(interaction, store, creatorRole, applicationId, decision, reason = '') {
  const application = store.getCreatorApplication(applicationId);
  if (!application) return { ok: false, reason: 'missing' };
  if (application.status !== 'pending') return { ok: false, reason: 'closed', application };
  if (decision === 'denied' && !String(reason || '').trim()) return { ok: false, reason: 'reason-required', application };
  const next = {
    ...application,
    status: decision,
    reviewedAt: new Date().toISOString(),
    reviewedBy: String(interaction.user.id),
    reviewReason: decision === 'approved' ? 'Approved for the Khaos Nexus Content Creator Program.' : cleanText(reason, 1000)
  };
  if (decision === 'approved') {
    const member = await interaction.guild.members.fetch(String(application.userId)).catch(() => null);
    if (!member) return { ok: false, reason: 'member-missing', application };
    await member.roles.add(creatorRole, 'Approved for the Khaos Nexus Content Creator Program');
    store.setCreatorProfile(application.userId, {
      userId: application.userId,
      applicationId: application.id,
      platformText: application.platformText,
      platforms: application.platforms,
      channelRef: application.channelRef,
      approvedAt: next.reviewedAt,
      approvedBy: next.reviewedBy,
      isLive: false,
      livePlatform: '',
      liveSince: ''
    });
  }
  store.setCreatorApplication(applicationId, next);
  return { ok: true, application: next };
}

async function reconcileReviews(reviewChannel, store, botId) {
  const applications = Object.values(store.listCreatorApplications());
  let created = 0;
  let updated = 0;
  for (const application of applications) {
    let message = await findReviewMessage(reviewChannel, application.id, botId);
    if (!message) { message = await reviewChannel.send(reviewPayload(application)); created += 1; }
    else if (!managedPayloadMatches(message, reviewPayload(application))) { await message.edit(reviewPayload(application)); updated += 1; }
    if (String(application.reviewMessageId || '') !== String(message.id)) store.setCreatorApplication(application.id, { ...application, reviewMessageId: String(message.id) });
  }
  return { tracked: applications.length, created, updated };
}

async function ensureCreatorProgram(guild, config, store, botId) {
  const roles = await ensureProgramRoles(guild);
  const categoryResult = await ensureCategory(guild);
  const category = categoryResult.category;
  const program = await ensureTextChannel(guild, category, PROGRAM_CHANNEL, 'Apply for and learn about the Khaos Nexus Content Creator Program.', publicReadOnlyOverwrites(guild, botId));
  const assets = await ensureTextChannel(guild, category, ASSETS_CHANNEL, 'Official reusable Khaos Nexus creator emblems, promotional graphics, and templates.', creatorOnlyOverwrites(guild, botId, roles.creatorRole.id));
  const chat = await ensureTextChannel(guild, category, CREATOR_CHAT_CHANNEL, 'Private collaboration space for approved Khaos Nexus Content Creators.', creatorOnlyOverwrites(guild, botId, roles.creatorRole.id, { writable: true }));
  const twitchLive = await ensureTextChannel(guild, category, TWITCH_LIVE_CHANNEL, 'Automated Khaos Nexus Twitch creator live notifications.', publicReadOnlyOverwrites(guild, botId));
  const youtubeLive = await ensureTextChannel(guild, category, YOUTUBE_LIVE_CHANNEL, 'Automated Khaos Nexus YouTube creator live notifications.', publicReadOnlyOverwrites(guild, botId));
  const review = await ensureReviewChannel(guild, config, botId);
  const programPanel = await reconcilePanel(program.channel, programPayload(), PROGRAM_MARKER, botId);
  const assetsPanel = await reconcilePanel(assets.channel, assetsPayload(), ASSETS_MARKER, botId);
  const reviewStats = await reconcileReviews(review.channel, store, botId);

  store.setCreatorMeta({
    categoryId: category.id,
    programChannelId: program.channel.id,
    reviewChannelId: review.channel.id,
    assetsChannelId: assets.channel.id,
    creatorChatChannelId: chat.channel.id,
    twitchLiveChannelId: twitchLive.channel.id,
    youtubeLiveChannelId: youtubeLive.channel.id,
    creatorRoleId: roles.creatorRole.id,
    nowLiveRoleId: roles.nowLiveRole.id,
    panelMessageId: programPanel.message.id
  });
  return {
    categoryId: category.id,
    categoryCreated: categoryResult.created,
    channelsCreated: [program, assets, chat, twitchLive, youtubeLive, review].filter((item) => item.created).length,
    creatorRoleId: roles.creatorRole.id,
    nowLiveRoleId: roles.nowLiveRole.id,
    creatorRoleCreated: roles.creatorRoleCreated,
    nowLiveRoleCreated: roles.nowLiveRoleCreated,
    programPanelCreated: programPanel.created,
    assetsPanelCreated: assetsPanel.created,
    reviewChannel: review.channel,
    staffRoleIds: review.staffRoleIds,
    reviewStats
  };
}

async function handleInteraction(interaction, context) {
  const { store, config } = context;
  const customId = String(interaction.customId || '');
  if (interaction.isButton?.() && customId === APPLY_BUTTON_ID) {
    await interaction.showModal(applicationModal());
    return true;
  }
  if (interaction.isModalSubmit?.() && customId === APPLY_MODAL_ID) {
    const result = await submitApplication(interaction, store, context.reviewChannel);
    if (result.duplicate) {
      const message = result.duplicate.status === 'approved'
        ? `You are already approved through ${result.duplicate.id}.`
        : `You already have a pending creator application (${result.duplicate.id}).`;
      await interaction.reply({ content: message, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    await interaction.reply({ content: `✅ ${result.application.id} was submitted for staff review.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  const reviewMatch = customId.match(/^kn:creator:review:(CCR-\d{4,}):(approve|deny)$/);
  if (interaction.isButton?.() && reviewMatch) {
    if (!isReviewer(interaction, config, context.staffRoleIds)) {
      await interaction.reply({ content: 'You are not authorized to review creator applications.', ephemeral: true });
      return true;
    }
    if (reviewMatch[2] === 'deny') {
      await interaction.showModal(denialModal(reviewMatch[1]));
      return true;
    }
    const result = await applyDecision(interaction, store, context.creatorRole, reviewMatch[1], 'approved');
    if (!result.ok) {
      await interaction.reply({ content: result.reason === 'closed' ? 'That application was already decided.' : 'The application could not be approved.', ephemeral: true });
      return true;
    }
    await interaction.update(reviewPayload(result.application));
    return true;
  }
  const denyMatch = customId.match(/^kn:creator:deny-modal:(CCR-\d{4,})$/);
  if (interaction.isModalSubmit?.() && denyMatch) {
    if (!isReviewer(interaction, config, context.staffRoleIds)) {
      await interaction.reply({ content: 'You are not authorized to review creator applications.', ephemeral: true });
      return true;
    }
    const reason = cleanText(interaction.fields.getTextInputValue('reason'), 1000);
    const result = await applyDecision(interaction, store, context.creatorRole, denyMatch[1], 'denied', reason);
    if (!result.ok) {
      await interaction.reply({ content: result.reason === 'closed' ? 'That application was already decided.' : 'The application could not be denied.', ephemeral: true });
      return true;
    }
    const reviewMessage = await findReviewMessage(context.reviewChannel, result.application.id, interaction.client.user?.id);
    if (reviewMessage) await reviewMessage.edit(reviewPayload(result.application));
    await interaction.reply({ content: `${result.application.id} was denied and the reason was recorded.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

function installCreatorProgramExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const store = new StateStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusCreatorProgramLogin(...args) {
    let context = null;
    this.on(Events.InteractionCreate, (interaction) => {
      if (!context) return;
      void handleInteraction(interaction, { ...context, store, config }).catch(async (error) => {
        console.warn(`[Nexus Sentinal] creator program interaction failed: ${String(error?.message || error).slice(0, 240)}`);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The creator program action could not be completed.', ephemeral: true }).catch(() => {});
      });
    });

    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const guildId = String(config.discord?.guildId || '').trim();
          if (!guildId) return;
          const guild = await this.guilds.fetch(guildId);
          const result = await ensureCreatorProgram(guild, config, store, this.user?.id);
          context = {
            reviewChannel: result.reviewChannel,
            staffRoleIds: result.staffRoleIds,
            creatorRole: await guild.roles.fetch(result.creatorRoleId)
          };
          const providers = providerStatus();
          console.log(`[Nexus Sentinal] creator program (${reason}): category=${result.categoryId} categoryCreated=${result.categoryCreated} channelsCreated=${result.channelsCreated} creatorRoleCreated=${result.creatorRoleCreated} nowLiveRoleCreated=${result.nowLiveRoleCreated} applications=${result.reviewStats.tracked} reviewCardsCreated=${result.reviewStats.created} twitch=${providers.twitch ? 'ready' : 'pending'} youtube=${providers.youtube ? 'ready' : 'pending'}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] creator program (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
        } finally {
          running = false;
        }
      };
      const initial = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), REFRESH_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  CATEGORY_NAME,
  PROGRAM_CHANNEL,
  ASSETS_CHANNEL,
  CREATOR_CHAT_CHANNEL,
  TWITCH_LIVE_CHANNEL,
  YOUTUBE_LIVE_CHANNEL,
  REVIEW_CHANNEL,
  CREATOR_ROLE_NAME,
  NOW_LIVE_ROLE_NAME,
  PROGRAM_MARKER,
  ASSETS_MARKER,
  APPLY_BUTTON_ID,
  APPLY_MODAL_ID,
  normalizeName,
  normalizeIds,
  cleanText,
  parsePlatforms,
  findCategory,
  findChannel,
  findRole,
  ensureProgramRoles,
  publicReadOnlyOverwrites,
  creatorOnlyOverwrites,
  ownerIds,
  reviewOverwrites,
  providerStatus,
  programPayload,
  assetsPayload,
  applicationModal,
  reviewPayload,
  isReviewer,
  denialModal,
  submitApplication,
  applyDecision,
  reconcileReviews,
  ensureCreatorProgram,
  handleInteraction,
  installCreatorProgramExtension
};
