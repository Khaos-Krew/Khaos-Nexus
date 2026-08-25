'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');
const { profileById } = require('../backend/services/poll-profiles.cjs');
const { evaluatePoll, visibleResult } = require('../backend/services/poll-engine.cjs');
const { findHqCategory, normalizedName } = require('./nexus-hq.cjs');

const POLL_CHANNEL_NAME = 'polls';
const POLL_CHANNEL_TOPIC = 'Nexus Sentinal managed polls, community decisions, scheduling votes, and governance results.';
const POLL_CARD_MARKER_PREFIX = 'Nexus Sentinal • Managed Poll • ';
const POLL_CUSTOM_PREFIX = 'nxpoll';
const PROFILE_CHOICES = Object.freeze([
  ['Community Pulse', 'community-pulse'],
  ['Yes / No Decision', 'yes-no-decision'],
  ['Suggestion Gate', 'suggestion-gate'],
  ['Event Scheduling', 'event-scheduling'],
  ['Staff Decision', 'staff-decision'],
  ['Nexus Governance', 'nexus-governance']
]);

function pollCommand() {
  const command = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage Nexus Sentinal polls.');

  command.addSubcommand((sub) => sub
    .setName('create')
    .setDescription('Create a managed Nexus poll.')
    .addStringOption((option) => option.setName('question').setDescription('The poll question.').setRequired(true).setMaxLength(240))
    .addStringOption((option) => option.setName('options').setDescription('2-10 choices separated by semicolons. Profile defaults may omit this.').setMaxLength(1000))
    .addStringOption((option) => {
      option.setName('profile').setDescription('Poll policy profile.');
      for (const [name, value] of PROFILE_CHOICES) option.addChoices({ name, value });
      return option;
    })
    .addIntegerOption((option) => option.setName('duration_hours').setDescription('Hours until the poll closes.').setMinValue(1).setMaxValue(168))
    .addIntegerOption((option) => option.setName('reminder_hours_before').setDescription('Post one reminder this many hours before close.').setMinValue(1).setMaxValue(168))
    .addStringOption((option) => option.setName('visibility').setDescription('When results are visible.').addChoices(
      { name: 'Public totals', value: 'public' },
      { name: 'Results after close', value: 'results-after-close' },
      { name: 'Anonymous results', value: 'anonymous-results' }
    ))
    .addBooleanOption((option) => option.setName('multi_select').setDescription('Allow more than one choice per voter.'))
    .addIntegerOption((option) => option.setName('max_selections').setDescription('Maximum choices per voter for multi-select polls.').setMinValue(1).setMaxValue(10))
    .addRoleOption((option) => option.setName('eligible_role').setDescription('Optional role required to vote.'))
    .addRoleOption((option) => option.setName('excluded_role').setDescription('Optional role excluded from voting.'))
    .addIntegerOption((option) => option.setName('minimum_votes').setDescription('Minimum voters required for quorum.').setMinValue(0).setMaxValue(100000))
    .addNumberOption((option) => option.setName('threshold_percent').setDescription('Pass threshold for threshold/supermajority polls.').setMinValue(1).setMaxValue(100))
    .addBooleanOption((option) => option.setName('exclude_creator').setDescription('Prevent the poll creator from voting.')));

  command.addSubcommand((sub) => sub
    .setName('status')
    .setDescription('Show the current status of a managed poll.')
    .addStringOption((option) => option.setName('id').setDescription('Poll ID, e.g. POLL-0042.').setRequired(true).setMaxLength(20)));
  command.addSubcommand((sub) => sub
    .setName('results')
    .setDescription('Show poll results when policy permits.')
    .addStringOption((option) => option.setName('id').setDescription('Poll ID.').setRequired(true).setMaxLength(20)));
  command.addSubcommand((sub) => sub
    .setName('close')
    .setDescription('Close a managed poll early.')
    .addStringOption((option) => option.setName('id').setDescription('Poll ID.').setRequired(true).setMaxLength(20)));
  command.addSubcommand((sub) => sub
    .setName('cancel')
    .setDescription('Cancel a managed poll without producing a winner.')
    .addStringOption((option) => option.setName('id').setDescription('Poll ID.').setRequired(true).setMaxLength(20))
    .addStringOption((option) => option.setName('reason').setDescription('Why the poll is being cancelled.').setMaxLength(500)));
  command.addSubcommand((sub) => sub
    .setName('audit')
    .setDescription('Show the protected lifecycle audit for a managed poll.')
    .addStringOption((option) => option.setName('id').setDescription('Poll ID.').setRequired(true).setMaxLength(20)));
  command.addSubcommand((sub) => sub
    .setName('list')
    .setDescription('List active or recent managed polls.')
    .addStringOption((option) => option.setName('status').setDescription('Optional lifecycle filter.').addChoices(
      { name: 'Open', value: 'open' },
      { name: 'Scheduled', value: 'scheduled' },
      { name: 'Closed', value: 'closed' },
      { name: 'Cancelled', value: 'cancelled' },
      { name: 'Runoff', value: 'runoff' }
    )));
  return command;
}

function parseOptionList(value = '') {
  const text = String(value || '').trim();
  if (!text) return [];
  const separator = text.includes(';') ? /\s*;\s*/ : /\s*(?:\n|\||,)\s*/;
  const options = text.split(separator).map((item) => item.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 10) throw new Error('Provide 2 to 10 poll choices, preferably separated by semicolons.');
  return options;
}

function pollInputFromInteraction(interaction, now = new Date()) {
  const profile = String(interaction.options.getString('profile') || 'community-pulse');
  profileById(profile);
  const durationHours = interaction.options.getInteger('duration_hours');
  const options = parseOptionList(interaction.options.getString('options') || '');
  const eligibleRole = interaction.options.getRole('eligible_role');
  const excludedRole = interaction.options.getRole('excluded_role');
  const input = {
    profile,
    question: interaction.options.getString('question', true),
    creatorId: String(interaction.user.id),
    guildId: String(interaction.guildId || interaction.guild?.id || ''),
    channelId: '',
    source: 'manual',
    ...(options.length ? { options } : {}),
    ...(durationHours ? { closesAt: new Date(new Date(now).getTime() + durationHours * 60 * 60_000).toISOString() } : {}),
    ...(interaction.options.getInteger('reminder_hours_before') ? { reminderMinutes: [interaction.options.getInteger('reminder_hours_before') * 60] } : {}),
    ...(interaction.options.getString('visibility') ? { visibility: interaction.options.getString('visibility') } : {}),
    ...(interaction.options.getBoolean('multi_select') !== null ? { multiSelect: interaction.options.getBoolean('multi_select') } : {}),
    ...(interaction.options.getInteger('max_selections') !== null ? { maxSelections: interaction.options.getInteger('max_selections') } : {}),
    ...(eligibleRole ? { eligibleRoleIds: [String(eligibleRole.id)] } : {}),
    ...(excludedRole ? { excludedRoleIds: [String(excludedRole.id)] } : {}),
    ...(interaction.options.getInteger('minimum_votes') !== null ? { minVotes: interaction.options.getInteger('minimum_votes') } : {}),
    ...(interaction.options.getNumber('threshold_percent') !== null ? { thresholdPercent: interaction.options.getNumber('threshold_percent') } : {}),
    ...(interaction.options.getBoolean('exclude_creator') !== null ? { excludeCreator: interaction.options.getBoolean('exclude_creator') } : {})
  };
  return input;
}

function roleIdsFromMember(member) {
  if (!member) return [];
  if (member.roles?.cache?.keys) return [...member.roles.cache.keys()].map(String);
  if (Array.isArray(member.roles)) return member.roles.map(String);
  return [];
}

function configuredManagerRoleIds(config = {}) {
  return [...new Set([
    ...(config.discord?.operatorRoleIds || []),
    ...(config.discord?.safetyStaffRoleIds || [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function configuredOwnerIds(config = {}, guild = null) {
  return [...new Set([
    ...(config.discord?.ownerUserIds || []),
    guild?.ownerId
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function isAuthorizedPollManager(member, config = {}, guild = null) {
  const userId = String(member?.id || member?.user?.id || '');
  if (!userId) return false;
  if (configuredOwnerIds(config, guild).includes(userId)) return true;
  const memberRoles = new Set(roleIdsFromMember(member));
  if (configuredManagerRoleIds(config).some((roleId) => memberRoles.has(roleId))) return true;
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator)
    || member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function normalizedRoleName(value) {
  return normalizedName(value);
}

function nexusRankRoleIds(roles, config = {}) {
  const values = roles?.values ? [...roles.values()] : Array.isArray(roles) ? roles : [];
  const byId = new Set(values.map((role) => String(role?.id || '')));
  const wanted = new Set(NEXUS_RANKS.map((rank) => normalizedRoleName(rank.name)));
  const configured = NEXUS_RANKS.map((rank) => String(config.discord?.rankRoles?.[rank.id] || '')).filter((id) => byId.has(id));
  const discovered = values.filter((role) => wanted.has(normalizedRoleName(role?.name))).map((role) => String(role.id));
  return [...new Set([...configured, ...discovered])];
}

function pollManagerRoleIds(roles, config = {}) {
  const values = roles?.values ? [...roles.values()] : Array.isArray(roles) ? roles : [];
  const existing = new Set(values.map((role) => String(role?.id || '')));
  const explicit = configuredManagerRoleIds(config).filter((id) => existing.has(id));
  if (explicit.length) return explicit;
  return values
    .filter((role) => role && role.managed !== true)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator) || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function findPollsChannel(channels, hqId = '') {
  const values = channels?.values ? [...channels.values()] : Array.isArray(channels) ? channels : [];
  return values.find((channel) => channel?.type === ChannelType.GuildText
    && normalizedName(channel.name) === POLL_CHANNEL_NAME
    && (!hqId || String(channel.parentId || '') === String(hqId))) || null;
}

function permissionMask(values = []) {
  return (Array.isArray(values) ? values : []).reduce((mask, value) => mask | BigInt(value), 0n);
}

function bitfieldOf(value) {
  if (typeof value === 'bigint') return value;
  if (value?.bitfield !== undefined) return BigInt(value.bitfield);
  return value === undefined || value === null ? 0n : BigInt(value);
}

function overwriteSatisfies(channel, targetId, plan = {}) {
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(String(targetId || ''));
  if (!overwrite) return false;
  const allow = permissionMask(plan.allow || []);
  const deny = permissionMask(plan.deny || []);
  const actualAllow = bitfieldOf(overwrite.allow);
  const actualDeny = bitfieldOf(overwrite.deny);
  return (actualAllow & allow) === allow && (actualDeny & deny) === deny;
}

async function ensurePollsChannel(guild, config = {}, botId = '') {
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const hq = findHqCategory(channels);
  if (!hq) return { skipped: 'nexus-hq-missing' };
  let channel = findPollsChannel(channels, hq.id)
    || findPollsChannel(channels);
  let created = false;
  let moved = false;
  let topicUpdated = false;
  if (!channel) {
    channel = await guild.channels.create({
      name: POLL_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: String(hq.id),
      topic: POLL_CHANNEL_TOPIC,
      reason: 'Nexus Sentinal managed poll surface'
    });
    created = true;
  } else if (String(channel.parentId || '') !== String(hq.id)) {
    await channel.setParent(String(hq.id), { lockPermissions: true, reason: 'Nexus Sentinal move canonical polls channel into Nexus HQ' });
    moved = true;
  }
  if (!created && !moved && channel.permissionsLocked !== true && typeof channel.lockPermissions === 'function') {
    await channel.lockPermissions('Nexus Sentinal inherit Nexus HQ access for polls').catch(() => {});
  }
  if (String(channel.topic || '') !== POLL_CHANNEL_TOPIC && typeof channel.setTopic === 'function') {
    await channel.setTopic(POLL_CHANNEL_TOPIC, 'Nexus Sentinal managed poll channel purpose');
    topicUpdated = true;
  }

  const denyPosting = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads
  ];
  const allowPosting = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads
  ];
  let permissionUpdates = 0;
  const edit = async (target, plan, reason) => {
    const id = String(target?.id || target || '');
    if (!id || overwriteSatisfies(channel, id, plan)) return;
    const permissions = {};
    for (const flag of plan.deny || []) permissions[permissionName(flag)] = false;
    for (const flag of plan.allow || []) permissions[permissionName(flag)] = true;
    await channel.permissionOverwrites.edit(target, permissions, { reason });
    permissionUpdates += 1;
  };

  await edit(guild.roles.everyone, { deny: denyPosting }, 'Nexus Sentinal polls are interaction-only for ordinary members');
  for (const roleId of nexusRankRoleIds(roles, config)) {
    await edit(roleId, { deny: denyPosting }, 'Nexus Sentinal rank members vote through managed poll controls');
  }
  for (const roleId of pollManagerRoleIds(roles, config)) {
    await edit(roleId, { allow: allowPosting }, 'Nexus Sentinal authorize staff poll publishers');
  }
  for (const ownerId of configuredOwnerIds(config, guild)) {
    await edit(ownerId, { allow: allowPosting }, 'Nexus Sentinal authorize owner poll management');
  }
  if (botId) {
    await edit(botId, { allow: [...allowPosting, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] }, 'Nexus Sentinal poll maintenance access');
  }
  return { channel, created, moved, topicUpdated, permissionUpdates, rankRoles: nexusRankRoleIds(roles, config).length, managerRoles: pollManagerRoleIds(roles, config).length };
}

function permissionName(flag) {
  const pairs = [
    [PermissionFlagsBits.ViewChannel, 'ViewChannel'],
    [PermissionFlagsBits.SendMessages, 'SendMessages'],
    [PermissionFlagsBits.SendMessagesInThreads, 'SendMessagesInThreads'],
    [PermissionFlagsBits.CreatePublicThreads, 'CreatePublicThreads'],
    [PermissionFlagsBits.CreatePrivateThreads, 'CreatePrivateThreads'],
    [PermissionFlagsBits.ReadMessageHistory, 'ReadMessageHistory'],
    [PermissionFlagsBits.EmbedLinks, 'EmbedLinks'],
    [PermissionFlagsBits.ManageMessages, 'ManageMessages']
  ];
  return pairs.find(([value]) => value === flag)?.[1] || String(flag);
}

function pollCardMarker(pollId) {
  return `${POLL_CARD_MARKER_PREFIX}${String(pollId || '').toUpperCase()}`;
}

function isManagedPollCard(message, pollId, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === pollCardMarker(pollId));
}

function pollStatusLabel(status) {
  return ({ scheduled: '🕒 Scheduled', open: '🟢 Open', closed: '✅ Closed', cancelled: '⛔ Cancelled', runoff: '🔁 Runoff Required' })[String(status)] || String(status || 'Unknown');
}

function resultLine(row, hidden = false) {
  if (hidden) return `**${row.label}** — results hidden until close`;
  return `**${row.label}** — ${row.votes} vote${row.votes === 1 ? '' : 's'} (${row.percentOfVoters}%)`;
}

function outcomeText(poll, result) {
  if (poll.status === 'cancelled') return `Cancelled${poll.cancelReason ? ` — ${poll.cancelReason}` : ''}`;
  if (!result || result.hidden) return '';
  const labels = new Map((poll.options || []).map((option) => [String(option.id), String(option.label)]));
  const winners = (result.winnerOptionIds || []).map((id) => labels.get(String(id)) || id);
  if (result.outcome === 'passed') return winners.length ? `Passed — **${winners.join(', ')}**` : 'Passed';
  if (result.outcome === 'failed') return 'Did not pass the configured decision rule.';
  if (result.outcome === 'no-quorum') return `No decision — quorum was not met (${result.totalVoters}/${result.quorumRequired}).`;
  if (result.outcome === 'runoff') return `Tie — runoff required between **${winners.join('** and **')}**.`;
  if (result.outcome === 'staff-review') return `Tie — authorized staff review required${winners.length ? ` between **${winners.join('** and **')}**` : ''}.`;
  if (result.outcome === 'informational') return 'Informational poll — results recorded without an automatic winner.';
  return result.outcome === 'no-decision' ? 'No decision.' : '';
}

function voteControls(poll) {
  const disabled = poll.status !== 'open';
  const rows = [];
  if (!poll.multiSelect && (poll.options || []).length <= 5) {
    rows.push({
      type: 1,
      components: poll.options.map((option) => ({
        type: 2,
        style: 2,
        label: String(option.label).slice(0, 80),
        custom_id: `${POLL_CUSTOM_PREFIX}:v:${poll.id}:${option.id}`,
        disabled
      }))
    });
  } else {
    rows.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `${POLL_CUSTOM_PREFIX}:s:${poll.id}`,
        placeholder: poll.multiSelect ? `Choose up to ${poll.maxSelections}` : 'Choose one option',
        min_values: 1,
        max_values: poll.multiSelect ? Number(poll.maxSelections || 1) : 1,
        disabled,
        options: poll.options.map((option) => ({ label: String(option.label).slice(0, 100), value: String(option.id) }))
      }]
    });
  }
  rows.push({
    type: 1,
    components: [{ type: 2, style: 2, label: 'Remove My Vote', custom_id: `${POLL_CUSTOM_PREFIX}:r:${poll.id}`, disabled }]
  });
  return rows;
}

function renderPollCard(poll) {
  const evaluated = poll.finalResult || evaluatePoll(poll, new Date().toISOString());
  const result = visibleResult(poll, evaluated, { authorized: false });
  const hidden = Boolean(result?.hidden);
  const counts = hidden ? (poll.options || []).map((option) => ({ label: option.label, votes: 0, percentOfVoters: 0 })) : (result?.counts || []);
  const fields = [
    { name: 'Status', value: pollStatusLabel(poll.status), inline: true },
    { name: 'Profile', value: String(poll.profile || 'community-pulse'), inline: true },
    { name: 'Closes', value: `<t:${Math.floor(Date.parse(poll.closesAt) / 1000)}:R>`, inline: true },
    { name: 'Choices', value: counts.map((row) => resultLine(row, hidden)).join('\n').slice(0, 1024), inline: false }
  ];
  const outcome = outcomeText(poll, result);
  if (outcome) fields.push({ name: 'Result', value: outcome.slice(0, 1024), inline: false });
  if (poll.minVotes > 0) fields.push({ name: 'Quorum', value: `${hidden ? 'Hidden' : result?.totalVoters || 0} / ${poll.minVotes} voters required`, inline: true });
  return {
    embeds: [{
      title: `📊 ${String(poll.question || 'Nexus Poll').slice(0, 240)}`,
      description: String(poll.description || '').slice(0, 1800) || 'Vote using the managed controls below. Votes can be changed or removed while the poll is open.',
      color: ({ open: 0x2ecc71, scheduled: 0x5865f2, closed: 0x95a5a6, cancelled: 0xe74c3c, runoff: 0xf39c12 })[poll.status] || 0x5865f2,
      fields,
      footer: { text: pollCardMarker(poll.id) }
    }],
    components: voteControls(poll),
    allowedMentions: { parse: [] }
  };
}

function parsePollCustomId(customId = '') {
  const parts = String(customId || '').split(':');
  if (parts[0] !== POLL_CUSTOM_PREFIX) return null;
  const action = parts[1];
  const pollId = String(parts[2] || '').toUpperCase();
  if (!/^POLL-\d{4,}$/.test(pollId)) return null;
  if (action === 'v') {
    const optionId = String(parts[3] || '');
    if (!/^OPT-\d+$/.test(optionId)) return null;
    return { action: 'vote', pollId, optionIds: [optionId] };
  }
  if (action === 's') return { action: 'select', pollId };
  if (action === 'r') return { action: 'remove', pollId };
  return null;
}

function pollStatusText(poll, result = null) {
  const visible = result || visibleResult(poll, poll.finalResult || evaluatePoll(poll), { authorized: true });
  const count = visible?.totalVoters ?? Object.keys(poll.votes || {}).length;
  return `**${poll.id}** • ${pollStatusLabel(poll.status)} • ${count} voter${count === 1 ? '' : 's'} • closes <t:${Math.floor(Date.parse(poll.closesAt) / 1000)}:R>\n${poll.question}`;
}

module.exports = {
  POLL_CARD_MARKER_PREFIX,
  POLL_CHANNEL_NAME,
  POLL_CHANNEL_TOPIC,
  POLL_CUSTOM_PREFIX,
  PROFILE_CHOICES,
  bitfieldOf,
  configuredManagerRoleIds,
  configuredOwnerIds,
  ensurePollsChannel,
  findPollsChannel,
  isAuthorizedPollManager,
  isManagedPollCard,
  nexusRankRoleIds,
  outcomeText,
  overwriteSatisfies,
  parseOptionList,
  parsePollCustomId,
  permissionMask,
  permissionName,
  pollCardMarker,
  pollCommand,
  pollInputFromInteraction,
  pollManagerRoleIds,
  pollStatusLabel,
  pollStatusText,
  renderPollCard,
  resultLine,
  roleIdsFromMember,
  voteControls
};
