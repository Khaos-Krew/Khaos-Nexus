'use strict';

const {
  ChannelType,
  Client,
  Events,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  REPORT_BUTTON_ID,
  REPORT_MODAL_ID,
  RULES_CHANNEL_NAMES,
  clean,
  createCaseId,
  normalizeIds,
  parseControlId,
  reportChannelName,
  reportFields,
  reportModal,
  rulesPanel,
  ticketControls,
  ticketPayload,
  userSelectPayload
} = require('./safety-report-model.cjs');
const { SafetyReportStore } = require('./safety-report-store.cjs');

const INSTALLED = Symbol.for('khaos.nexus.safetyReports.extension');
const REPORT_CATEGORY = 'PRIVATE REPORTS';
const ARCHIVE_CHANNEL = 'report-archive';
const MAX_OPEN_REPORTS_PER_USER = 3;
const MAX_TRANSCRIPT_MESSAGES = 2000;
const MAX_TRANSCRIPT_BYTES = 6 * 1024 * 1024;

function reportCommand() {
  return new SlashCommandBuilder()
    .setName('report')
    .setDescription('Open a private safety, harassment, or moderation report');
}

function hasModerationPermission(member) {
  const permissions = member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator)
    || permissions?.has?.(PermissionFlagsBits.ModerateMembers)
    || permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function configuredOwnerIds(config = {}) {
  return normalizeIds(config.discord?.ownerUserIds || []);
}

async function resolveStaffRoleIds(guild, config = {}) {
  const roles = await guild.roles.fetch();
  const explicit = normalizeIds([
    ...(config.discord?.safetyStaffRoleIds || []),
    ...(config.discord?.operatorRoleIds || [])
  ]).filter((id) => {
    const role = roles.get(id);
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return [...roles.values()]
    .filter((role) => role && role.id !== guild.id && role.managed !== true)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator)
      || role.permissions?.has?.(PermissionFlagsBits.ModerateMembers)
      || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function staffRoleOverwrites(staffRoleIds = []) {
  return normalizeIds(staffRoleIds).map((id) => ({
    id,
    type: OverwriteType.Role,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageMessages
    ]
  }));
}

function ownerOverwrites(ownerIds = []) {
  return normalizeIds(ownerIds).map((id) => ({
    id,
    type: OverwriteType.Member,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageMessages
    ]
  }));
}

function staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds) {
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffRoleOverwrites(staffRoleIds),
    ...ownerOverwrites(ownerIds),
    {
      id: String(botId),
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]
    }
  ];
}

function reportOverwrites(guild, botId, reporterId, staffRoleIds, ownerIds) {
  const overwrites = staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds);
  if (!overwrites.some((item) => String(item.id) === String(reporterId))) {
    overwrites.push({
      id: String(reporterId),
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
    });
  }
  return overwrites;
}

async function fetchChannel(guild, id, expectedType = null) {
  if (!/^\d{15,24}$/.test(String(id || ''))) return null;
  try {
    const channel = await guild.channels.fetch(String(id));
    if (!channel) return null;
    if (expectedType !== null && channel.type !== expectedType) return null;
    return channel;
  } catch { return null; }
}

async function ensureInfrastructure(guild, client, config, store) {
  const saved = store.getInfrastructure() || {};
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const ownerIds = configuredOwnerIds(config);
  const botId = String(client.user.id);
  const channels = await guild.channels.fetch();

  let category = await fetchChannel(guild, config.discord?.safetyReportsCategoryId || saved.categoryId, ChannelType.GuildCategory);
  if (!category) {
    category = [...channels.values()].find((channel) => channel?.type === ChannelType.GuildCategory
      && ['private reports', 'safety reports'].includes(String(channel.name || '').toLowerCase())) || null;
  }
  if (!category) {
    category = await guild.channels.create({
      name: REPORT_CATEGORY,
      type: ChannelType.GuildCategory,
      permissionOverwrites: staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds),
      reason: 'Nexus Sentinal private safety reporting'
    });
  } else {
    await category.permissionOverwrites.set(staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds), 'Nexus Sentinal private report privacy reconciliation');
  }

  let archive = await fetchChannel(guild, config.discord?.safetyReportsArchiveChannelId || saved.archiveChannelId, ChannelType.GuildText);
  if (!archive) {
    const refreshed = await guild.channels.fetch();
    archive = [...refreshed.values()].find((channel) => channel?.type === ChannelType.GuildText
      && String(channel.parentId || '') === String(category.id)
      && String(channel.name || '').toLowerCase() === ARCHIVE_CHANNEL) || null;
  }
  if (!archive) {
    archive = await guild.channels.create({
      name: ARCHIVE_CHANNEL,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Restricted Nexus safety-report transcripts and closure records.',
      permissionOverwrites: staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds),
      reason: 'Nexus Sentinal restricted safety report archive'
    });
  } else {
    if (String(archive.parentId || '') !== String(category.id)) await archive.setParent(category.id, { lockPermissions: false, reason: 'Nexus Sentinal safety report archive reconciliation' });
    await archive.permissionOverwrites.set(staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds), 'Nexus Sentinal report archive privacy reconciliation');
  }

  store.setInfrastructure({ categoryId: String(category.id), archiveChannelId: String(archive.id), staffRoleIds, ownerIds });
  return { category, archive, staffRoleIds, ownerIds };
}

async function ensureReportCommand(guild) {
  const definition = reportCommand();
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.name;
}

async function findRulesChannel(guild, config, store) {
  const saved = store.getRulesPanel() || {};
  for (const id of [config.discord?.rulesChannelId, saved.channelId]) {
    const channel = await fetchChannel(guild, id, ChannelType.GuildText);
    if (channel) return channel;
  }
  const channels = await guild.channels.fetch();
  return [...channels.values()].find((channel) => channel?.type === ChannelType.GuildText
    && RULES_CHANNEL_NAMES.includes(String(channel.name || '').toLowerCase())) || null;
}

function hasOpenReportButton(message) {
  return (message?.components || []).some((row) => (row.components || []).some((component) => String(component.customId || component.custom_id || '') === REPORT_BUTTON_ID));
}

async function ensureRulesPanel(guild, client, config, store) {
  const channel = await findRulesChannel(guild, config, store);
  if (!channel) return { skipped: true, reason: 'rules-channel-not-found' };
  const saved = store.getRulesPanel();
  let message = null;
  if (saved?.messageId && String(saved.channelId || '') === String(channel.id)) {
    try { message = await channel.messages.fetch(String(saved.messageId)); } catch {}
  }
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find((item) => String(item.author?.id || '') === String(client.user.id) && hasOpenReportButton(item))
      || recent.find((item) => String(item.author?.id || '') === String(client.user.id)
        && (item.embeds || []).some((embed) => /community rules|server rules|rules/i.test(String(embed.title || ''))))
      || null;
  }
  const payload = rulesPanel();
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  store.setRulesPanel({ guildId: String(guild.id), channelId: String(channel.id), messageId: String(message.id) });
  return { skipped: false, channelId: String(channel.id), messageId: String(message.id) };
}

async function memberFor(guild, userId) {
  try { return await guild.members.fetch(String(userId)); } catch { return null; }
}

async function isStaff(guild, userId, config, report = null) {
  const id = String(userId || '');
  if (configuredOwnerIds(config).includes(id)) return true;
  const member = await memberFor(guild, id);
  if (!member) return false;
  if (hasModerationPermission(member)) return true;
  const staffRoleIds = normalizeIds(report?.staffRoleIds || await resolveStaffRoleIds(guild, config));
  return staffRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId));
}

function modalValues(interaction) {
  const get = (id) => interaction.fields.getTextInputValue(id);
  return reportFields({
    summary: get('summary'),
    involved: get('involved'),
    details: get('details'),
    evidence: get('evidence'),
    support: get('support')
  });
}

function uniqueCaseId(store) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = createCaseId();
    if (!store.get(id)) return id;
  }
  throw new Error('Unable to allocate a private report case ID.');
}

async function createReport(interaction, client, config, store) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const openReports = store.openForReporter(String(interaction.user.id));
  if (openReports.length >= MAX_OPEN_REPORTS_PER_USER) {
    return interaction.editReply({ content: 'You already have several active private reports. Please use an existing report channel or ask staff to close a resolved case before opening another.' });
  }

  const fields = modalValues(interaction);
  if (!fields.summary || !fields.details) return interaction.editReply({ content: 'A short summary and report details are required.' });
  const infrastructure = await ensureInfrastructure(interaction.guild, client, config, store);
  const caseId = uniqueCaseId(store);
  const channel = await interaction.guild.channels.create({
    name: reportChannelName(caseId),
    type: ChannelType.GuildText,
    parent: infrastructure.category.id,
    topic: `${caseId} • private safety report • open`,
    permissionOverwrites: reportOverwrites(interaction.guild, client.user.id, interaction.user.id, infrastructure.staffRoleIds, infrastructure.ownerIds),
    reason: `Nexus Sentinal private safety report ${caseId}`
  });

  const createdAt = new Date().toISOString();
  store.set(caseId, {
    guildId: String(interaction.guild.id),
    channelId: String(channel.id),
    reporterId: String(interaction.user.id),
    status: 'open',
    createdAt,
    staffRoleIds: infrastructure.staffRoleIds,
    ownerIds: infrastructure.ownerIds,
    participants: [],
    staffParticipants: []
  });

  const ticketMessage = await channel.send(ticketPayload(caseId, interaction.user.id, fields));
  store.set(caseId, { ticketMessageId: String(ticketMessage.id) });
  return interaction.editReply({
    content: `✅ Your private report **${caseId}** is open in <#${channel.id}>. Only you, Nexus Sentinal, and authorized staff can access it. You can attach screenshots or files there.`
  });
}

async function reportChannelFor(interaction, report) {
  if (!report || String(report.guildId || '') !== String(interaction.guildId || interaction.guild?.id || '')) return null;
  const channel = await fetchChannel(interaction.guild, report.channelId, ChannelType.GuildText);
  return channel;
}

async function fetchTranscript(channel) {
  const messages = [];
  let before = '';
  while (messages.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, MAX_TRANSCRIPT_MESSAGES - messages.length), ...(before ? { before } : {}) });
    if (!batch.size) break;
    const values = [...batch.values()];
    messages.push(...values);
    before = String(values.at(-1)?.id || '');
    if (batch.size < 100 || !before) break;
  }
  messages.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
  const lines = [`Khaos Nexus Private Report Transcript`, `Channel: #${channel.name}`, `Generated: ${new Date().toISOString()}`, ''];
  for (const message of messages) {
    const timestamp = message.createdAt?.toISOString?.() || new Date(Number(message.createdTimestamp || Date.now())).toISOString();
    const author = `${clean(message.author?.tag || message.author?.username || 'Unknown', 100)} (${String(message.author?.id || 'unknown')})`;
    const body = clean(message.content || '', 8000);
    lines.push(`[${timestamp}] ${author}`);
    if (body) lines.push(body);
    for (const attachment of message.attachments?.values?.() || []) lines.push(`[attachment] ${clean(attachment.name || 'file', 160)} ${clean(attachment.url || '', 2000)}`);
    lines.push('');
  }
  let text = lines.join('\n');
  let truncated = messages.length >= MAX_TRANSCRIPT_MESSAGES;
  if (Buffer.byteLength(text, 'utf8') > MAX_TRANSCRIPT_BYTES) {
    text = Buffer.from(text, 'utf8').subarray(0, MAX_TRANSCRIPT_BYTES).toString('utf8');
    truncated = true;
  }
  if (truncated) text += '\n\n[Transcript truncated by Nexus safety limits; the Discord channel remains preserved.]\n';
  return { text, messageCount: messages.length, truncated };
}

async function disableTicketControls(channel, report) {
  if (!report?.ticketMessageId) return;
  try {
    const message = await channel.messages.fetch(String(report.ticketMessageId));
    await message.edit({ components: ticketControls(report.caseId, true) });
  } catch {}
}

async function closeReport(interaction, report, channel, config, store, infrastructure) {
  const transcript = await fetchTranscript(channel);
  const archiveMessage = await infrastructure.archive.send({
    content: `**Archived private report ${report.caseId}**\nReporter: <@${report.reporterId}>\nClosed by: <@${interaction.user.id}>\nMessages captured: ${transcript.messageCount}${transcript.truncated ? ' • transcript truncated' : ''}`,
    files: [{ attachment: Buffer.from(transcript.text, 'utf8'), name: `${report.caseId}.txt` }],
    allowedMentions: { parse: [] }
  });

  const closedAt = new Date().toISOString();
  const updated = store.set(report.caseId, {
    status: 'closed',
    closedAt,
    closedBy: String(interaction.user.id),
    archiveChannelId: String(infrastructure.archive.id),
    archiveMessageId: String(archiveMessage.id)
  });
  await disableTicketControls(channel, updated);
  for (const userId of [report.reporterId, ...(report.participants || [])]) {
    try { await channel.permissionOverwrites.edit(String(userId), { SendMessages: false }, `Nexus Sentinal closed report ${report.caseId}`); } catch {}
  }
  try { await channel.setName(reportChannelName(report.caseId, true), `Nexus Sentinal closed report ${report.caseId}`); } catch {}
  try { await channel.setTopic(`${report.caseId} • private safety report • closed ${closedAt}`); } catch {}
  await channel.send({ content: `🔒 **${report.caseId} closed and archived.** The channel is preserved read-only for the reporter. Authorized staff can access the restricted transcript archive.`, allowedMentions: { parse: [] } });
  return updated;
}

async function handleControl(interaction, client, config, store, parsed) {
  const report = store.get(parsed.caseId);
  const channel = await reportChannelFor(interaction, report);
  if (!report || !channel) return interaction.reply({ content: 'This private report no longer has an active Discord case channel.', flags: MessageFlags.Ephemeral });
  if (String(report.status || '') === 'closed') return interaction.reply({ content: `Report ${report.caseId} is already closed.`, flags: MessageFlags.Ephemeral });
  const staff = await isStaff(interaction.guild, interaction.user.id, config, report);
  const reporter = String(report.reporterId || '') === String(interaction.user.id);

  if (parsed.action === 'claim') {
    if (!staff) return interaction.reply({ content: 'Only authorized staff can claim a report.', flags: MessageFlags.Ephemeral });
    store.set(report.caseId, { status: 'claimed', claimedBy: String(interaction.user.id), claimedAt: new Date().toISOString() });
    await channel.send({ content: `✋ Case claimed by <@${interaction.user.id}>.`, allowedMentions: { users: [String(interaction.user.id)], parse: [] } });
    return interaction.reply({ content: `Claimed ${report.caseId}.`, flags: MessageFlags.Ephemeral });
  }

  if (parsed.action === 'addstaff' || parsed.action === 'adduser') {
    if (!staff) return interaction.reply({ content: 'Only authorized staff can add participants to a private report.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ ...userSelectPayload(report.caseId, parsed.action === 'addstaff'), flags: MessageFlags.Ephemeral });
  }

  if (parsed.action === 'escalate') {
    if (!staff) return interaction.reply({ content: 'Only authorized staff can escalate a report.', flags: MessageFlags.Ephemeral });
    store.set(report.caseId, { status: 'escalated', escalatedBy: String(interaction.user.id), escalatedAt: new Date().toISOString() });
    const owners = normalizeIds(report.ownerIds || configuredOwnerIds(config));
    const mentions = owners.map((id) => `<@${id}>`).join(' ');
    await channel.send({
      content: `⚠️ **${report.caseId} escalated for senior staff review.**${mentions ? ` ${mentions}` : ''}`,
      allowedMentions: { users: owners, roles: [], parse: [] }
    });
    return interaction.reply({ content: `Escalated ${report.caseId}.`, flags: MessageFlags.Ephemeral });
  }

  if (parsed.action === 'resolve') {
    if (!staff) return interaction.reply({ content: 'Only authorized staff can mark a report resolved.', flags: MessageFlags.Ephemeral });
    store.set(report.caseId, { status: 'resolved', resolvedBy: String(interaction.user.id), resolvedAt: new Date().toISOString() });
    await channel.send({ content: `✅ **${report.caseId} marked resolved.** The channel remains open for any final follow-up until it is closed and archived.`, allowedMentions: { parse: [] } });
    return interaction.reply({ content: `Marked ${report.caseId} resolved.`, flags: MessageFlags.Ephemeral });
  }

  if (parsed.action === 'close') {
    if (!staff && !reporter) return interaction.reply({ content: 'Only the reporter or authorized staff can close this report.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const infrastructure = await ensureInfrastructure(interaction.guild, client, config, store);
    await closeReport(interaction, report, channel, config, store, infrastructure);
    return interaction.editReply({ content: `🔒 ${report.caseId} is closed and its transcript is stored in the restricted staff archive.` });
  }

  return interaction.reply({ content: 'Unknown private report control.', flags: MessageFlags.Ephemeral });
}

async function handleUserSelect(interaction, config, store, parsed) {
  const report = store.get(parsed.caseId);
  const channel = await reportChannelFor(interaction, report);
  if (!report || !channel) return interaction.update({ content: 'This private report no longer has an active Discord case channel.', components: [] });
  if (!(await isStaff(interaction.guild, interaction.user.id, config, report))) return interaction.update({ content: 'Only authorized staff can add participants to a private report.', components: [] });
  const userId = String(interaction.values?.[0] || '');
  const member = await memberFor(interaction.guild, userId);
  if (!member) return interaction.update({ content: 'That member is not available in this Discord server.', components: [] });
  const addingStaff = parsed.action === 'staffselect';
  if (addingStaff && !(await isStaff(interaction.guild, userId, config, report))) {
    return interaction.update({ content: 'That member is not currently recognized as authorized staff. Use **Add User** if they only need case-specific participation.', components: [] });
  }

  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    ...(addingStaff ? { ManageMessages: true } : {})
  }, `Nexus Sentinal ${addingStaff ? 'staff' : 'participant'} added to ${report.caseId}`);

  const key = addingStaff ? 'staffParticipants' : 'participants';
  const values = [...new Set([...(report[key] || []), userId])];
  store.set(report.caseId, { [key]: values });
  await channel.send({
    content: `${addingStaff ? '🛡️ Staff member' : '➕ Participant'} <@${userId}> was added to **${report.caseId}** by <@${interaction.user.id}>.`,
    allowedMentions: { users: [userId, String(interaction.user.id)], roles: [], parse: [] }
  });
  return interaction.update({ content: `Added ${member.displayName || member.user?.username || userId} to ${report.caseId}.`, components: [] });
}

function installSafetyReportExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const store = new SafetyReportStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSafetyReportLogin(...args) {
    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        const infrastructure = await ensureInfrastructure(guild, this, config, store);
        await ensureReportCommand(guild);
        const rules = await ensureRulesPanel(guild, this, config, store);
        console.log(`[Nexus Sentinal] private safety reports ready: staffRoles=${infrastructure.staffRoleIds.length} rulesPanel=${rules.skipped ? 'not-found' : 'ready'} archive=ready`);
      } catch (error) {
        console.error('[Nexus Sentinal] private safety report startup:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand?.() && interaction.commandName === 'report') return interaction.showModal(reportModal());
        if (interaction.isButton?.() && String(interaction.customId || '') === REPORT_BUTTON_ID) return interaction.showModal(reportModal());
        if (interaction.isModalSubmit?.() && String(interaction.customId || '') === REPORT_MODAL_ID) return createReport(interaction, this, config, store);

        if (interaction.isButton?.()) {
          const parsed = parseControlId(interaction.customId);
          if (parsed && !['staffselect', 'userselect'].includes(parsed.action)) return handleControl(interaction, this, config, store, parsed);
        }
        if (interaction.isUserSelectMenu?.()) {
          const parsed = parseControlId(interaction.customId);
          if (parsed && ['staffselect', 'userselect'].includes(parsed.action)) return handleUserSelect(interaction, config, store, parsed);
        }
      } catch (error) {
        const content = `⚠️ ${clean(error?.message || error || 'Private report operation failed.', 500)}`;
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          console.error('[Nexus Sentinal] private safety report response error:', replyError?.message || replyError);
        }
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  ARCHIVE_CHANNEL,
  MAX_OPEN_REPORTS_PER_USER,
  REPORT_CATEGORY,
  ensureInfrastructure,
  ensureReportCommand,
  ensureRulesPanel,
  fetchTranscript,
  hasModerationPermission,
  installSafetyReportExtension,
  isStaff,
  reportCommand,
  reportOverwrites,
  resolveStaffRoleIds,
  staffOnlyOverwrites
};