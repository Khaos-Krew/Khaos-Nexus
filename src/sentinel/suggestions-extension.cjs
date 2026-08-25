'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { PollEngine } = require('../backend/services/poll-engine.cjs');
const { PollStore } = require('../backend/services/poll-store.cjs');
const { StateStore } = require('./state-store.cjs');

const INSTALLED = Symbol.for('khaos.nexus.suggestions.extension');
const PANEL_MARKER = 'Nexus Sentinal • Community Suggestions • v1';
const SUGGESTION_MARKER_PREFIX = 'Nexus Sentinal • Suggestion • ';
const SUBMIT_BUTTON_ID = 'kn:suggest:new';
const MODAL_ID = 'kn:suggest:modal';
const INITIAL_DELAY_MS = 18_000;
const REFRESH_MS = 5 * 60_000;

const READ_ONLY_DENY = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads
];

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function suggestionSettings(env = process.env) {
  return {
    votingHours: boundedNumber(env.NEXUS_SUGGESTION_VOTING_HOURS, 72, 1, 24 * 30),
    minVotes: Math.round(boundedNumber(env.NEXUS_SUGGESTION_MIN_VOTES, 5, 1, 10000)),
    passPercent: boundedNumber(env.NEXUS_SUGGESTION_PASS_PERCENT, 60, 1, 100),
    githubRepository: String(env.NEXUS_GITHUB_REPOSITORY || 'Khaos-Krew/Khaos-Nexus').trim(),
    githubToken: String(env.NEXUS_GITHUB_TOKEN || '').trim()
  };
}

function cleanText(value, max, fallback = '') {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findCommunityCategory(channels) {
  const categories = valuesOf(channels).filter((channel) => channel?.type === ChannelType.GuildCategory);
  return categories.find((channel) => ['khaoscommunity', 'community'].includes(normalizeChannelName(channel.name))) || null;
}

function findSuggestionsChannel(channels) {
  return valuesOf(channels).find((channel) => channel?.isTextBased?.() && normalizeChannelName(channel.name) === 'suggestions') || null;
}

async function applySuggestionChannelPermissions(channel, guild, botId = '') {
  if (!channel?.permissionOverwrites?.edit || !guild?.roles?.everyone) return false;
  const deny = Object.fromEntries(READ_ONLY_DENY.map((permission) => {
    const name = Object.entries(PermissionFlagsBits).find(([, bit]) => bit === permission)?.[0];
    return [name, false];
  }).filter(([name]) => Boolean(name)));
  await channel.permissionOverwrites.edit(guild.roles.everyone, deny, { reason: 'Keep community suggestions organized through Nexus Sentinal controls' });
  const target = guild?.members?.me || String(botId || '');
  if (target) {
    await channel.permissionOverwrites.edit(target, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true,
      ManageMessages: true
    }, { reason: 'Allow Nexus Sentinal to maintain community suggestions' });
  }
  return true;
}

async function ensureSuggestionsChannel(guild, options = {}) {
  const channels = await guild.channels.fetch();
  let channel = findSuggestionsChannel(channels);
  const category = findCommunityCategory(channels);
  let created = false;
  let moved = false;
  if (!channel) {
    channel = await guild.channels.create({
      name: 'suggestions',
      type: ChannelType.GuildText,
      parent: category?.id || undefined,
      topic: 'Submit and vote on ideas for Khaos Nexus. Community-supported ideas move into development review.',
      reason: 'Nexus Sentinal community suggestion workflow'
    });
    created = true;
  } else if (category && String(channel.parentId || '') !== String(category.id) && typeof channel.setParent === 'function') {
    await channel.setParent(category.id, { lockPermissions: false, reason: 'Keep suggestions with the Khaos community channels' });
    moved = true;
  }
  if (String(channel.topic || '') !== 'Submit and vote on ideas for Khaos Nexus. Community-supported ideas move into development review.' && typeof channel.setTopic === 'function') {
    await channel.setTopic('Submit and vote on ideas for Khaos Nexus. Community-supported ideas move into development review.', 'Keep Nexus suggestion instructions current');
  }
  const permissionsUpdated = await applySuggestionChannelPermissions(channel, guild, options.botId);
  return { channel, created, moved, permissionsUpdated };
}

function panelPayload(settings) {
  return {
    embeds: [{
      title: '💡 KHAOS NEXUS COMMUNITY SUGGESTIONS',
      description: 'Have an idea for a game, Discord feature, Nexus integration, community tool, item, event, or other useful improvement? Submit it here so it becomes a tracked proposal instead of getting buried in chat or the roadmap.',
      color: 0xe3264f,
      fields: [
        { name: '1️⃣ Submit', value: 'Use **Submit Suggestion** below. Give the idea a clear title, category, and enough detail for the community to understand it.', inline: false },
        { name: '2️⃣ Community Vote', value: `Voting stays open for **${settings.votingHours} hours**. The submitter cannot vote on their own suggestion, and every other member has one vote that can be changed or removed.`, inline: false },
        { name: '3️⃣ Development Review', value: `A suggestion needs at least **${settings.minVotes} total votes** and **${settings.passPercent}% approval** to pass the community gate. Passed ideas are queued for GitHub/development review; they are not automatically implemented without Owner approval.`, inline: false },
        { name: '🛡️ Keep It Useful', value: 'Suggestions must follow the community rules. Duplicate, abusive, unsafe, or deliberately disruptive submissions may be removed by staff.', inline: false }
      ],
      footer: { text: PANEL_MARKER }
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SUBMIT_BUTTON_ID).setLabel('Submit Suggestion').setStyle(ButtonStyle.Primary).setEmoji('💡')
    )],
    allowedMentions: { parse: [] }
  };
}

function messageIsPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === PANEL_MARKER);
}

async function ensureSuggestionPanel(channel, settings, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let messages = [];
  try { messages = valuesOf(await channel.messages.fetch({ limit: 100 })); } catch {}
  const candidates = messages.filter((message) => messageIsPanel(message, botId)).sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  const payload = panelPayload(settings);
  if (message) await message.edit(payload);
  else {
    message = await channel.send(payload);
    created = true;
  }
  let pinned = false;
  if (message.pinned !== true && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal community suggestion intake'); pinned = true; } catch {}
  }
  let duplicatesRemoved = 0;
  for (const duplicate of candidates.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate suggestion intake panel cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, pinned, duplicatesRemoved };
}

function suggestionMarker(id) {
  return `${SUGGESTION_MARKER_PREFIX}${String(id || '')}`;
}

function voteCounts(suggestion = {}) {
  const values = Object.values(suggestion.votes || {});
  const up = values.filter((vote) => vote === 'up').length;
  const down = values.filter((vote) => vote === 'down').length;
  const total = up + down;
  const approval = total ? Math.round((up / total) * 100) : 0;
  return { up, down, total, approval };
}

function suggestionStatusLabel(status) {
  return ({
    voting: '🗳️ Voting Open',
    'community-passed': '✅ Community Passed',
    'community-declined': '❌ Community Gate Not Met',
    'github-pending': '📥 Passed • Development Queue Pending Sync',
    'github-review': '🧭 Passed • Development Review',
    approved: '🚀 Approved for Implementation',
    denied: '⛔ Denied'
  })[status] || '📌 Tracked';
}

function suggestionPayload(suggestion, settings) {
  const counts = voteCounts(suggestion);
  const closesUnix = Math.floor(Date.parse(suggestion.closesAt) / 1000);
  const open = suggestion.status === 'voting';
  const fields = [
    { name: 'Category', value: suggestion.category || 'Other', inline: true },
    { name: 'Status', value: suggestionStatusLabel(suggestion.status), inline: true },
    { name: 'Community Vote', value: `👍 ${counts.up}  •  👎 ${counts.down}  •  ${counts.approval}% approval`, inline: false }
  ];
  if (open) fields.push({ name: 'Voting Closes', value: `<t:${closesUnix}:F> • <t:${closesUnix}:R>\nPass gate: ${settings.minVotes}+ votes and ${settings.passPercent}%+ approval.`, inline: false });
  if (suggestion.githubIssueUrl) fields.push({ name: 'Development Tracking', value: `[Open GitHub issue](${suggestion.githubIssueUrl})`, inline: false });
  if (suggestion.reviewReason) fields.push({ name: suggestion.status === 'denied' ? 'Denial Reason' : 'Owner Note', value: cleanText(suggestion.reviewReason, 1000), inline: false });

  const components = [];
  if (open) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kn:suggest:vote:${suggestion.id}:up`).setLabel(`Upvote (${counts.up})`).setStyle(ButtonStyle.Success).setEmoji('👍'),
      new ButtonBuilder().setCustomId(`kn:suggest:vote:${suggestion.id}:down`).setLabel(`Downvote (${counts.down})`).setStyle(ButtonStyle.Danger).setEmoji('👎')
    ));
  } else if (suggestion.githubIssueUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Development Issue').setStyle(ButtonStyle.Link).setURL(suggestion.githubIssueUrl)
    ));
  }

  return {
    embeds: [{
      title: `💡 ${suggestion.id} • ${cleanText(suggestion.title, 180, 'Community Suggestion')}`,
      description: cleanText(suggestion.details, 4000, 'No additional details were provided.'),
      color: suggestion.status === 'denied' || suggestion.status === 'community-declined' ? 0x992d22 : suggestion.status === 'voting' ? 0xe3264f : 0x2ecc71,
      fields,
      footer: { text: suggestionMarker(suggestion.id) },
      timestamp: suggestion.createdAt
    }],
    components,
    allowedMentions: { parse: [] }
  };
}

function createSuggestionModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Submit a Nexus Suggestion')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Suggestion title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Add a game, feature, integration, event...')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('category').setLabel('Category').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50).setPlaceholder('Game, Discord, Integration, Community, Other')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('details').setLabel('Explain the idea').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500).setPlaceholder('What should be added or changed, and why would it be useful?')
      )
    );
}

function newSuggestion(store, interaction, settings) {
  const allocation = store.allocateSuggestionId();
  const now = new Date();
  const closesAt = new Date(now.getTime() + settings.votingHours * 60 * 60 * 1000);
  return {
    id: allocation.id,
    number: allocation.number,
    title: cleanText(interaction.fields.getTextInputValue('title'), 100, 'Community Suggestion'),
    category: cleanText(interaction.fields.getTextInputValue('category'), 50, 'Other'),
    details: cleanText(interaction.fields.getTextInputValue('details'), 1500),
    submitterId: String(interaction.user.id),
    submitterName: cleanText(interaction.user.globalName || interaction.user.username || 'Community member', 100),
    createdAt: now.toISOString(),
    closesAt: closesAt.toISOString(),
    status: 'voting',
    votes: {},
    channelId: '',
    messageId: '',
    githubIssueUrl: '',
    githubIssueNumber: null,
    reviewReason: ''
  };
}

function pollVoteMap(poll = {}) {
  const votes = {};
  for (const [userId, ballot] of Object.entries(poll.votes || {})) {
    const optionId = String(ballot?.optionIds?.[0] || '');
    if (optionId === 'OPT-1') votes[userId] = 'up';
    if (optionId === 'OPT-2') votes[userId] = 'down';
  }
  return votes;
}

function suggestionWithPoll(suggestion, poll) {
  if (!poll) return suggestion;
  return {
    ...suggestion,
    pollId: String(poll.id),
    closesAt: String(poll.closesAt),
    votes: pollVoteMap(poll)
  };
}

function ensureSuggestionPoll(store, suggestion, settings, pollEngine, context = {}) {
  if (!pollEngine || !suggestion) return suggestion;
  if (suggestion.pollId) {
    const existing = pollEngine.get(suggestion.pollId, { includeVotes: true });
    return existing ? suggestionWithPoll(suggestion, existing) : suggestion;
  }
  const poll = pollEngine.create({
    profile: 'suggestion-gate',
    question: suggestion.title,
    description: suggestion.details,
    options: ['Approve', 'Reject'],
    creatorId: String(suggestion.submitterId),
    source: 'suggestion',
    sourceLink: String(suggestion.id),
    guildId: String(context.guildId || ''),
    channelId: String(suggestion.channelId || context.channelId || ''),
    messageId: String(suggestion.messageId || ''),
    closesAt: suggestion.closesAt,
    minVotes: settings.minVotes,
    thresholdPercent: settings.passPercent,
    excludeCreator: true
  });
  pollEngine.store.update(poll.id, (record) => {
    for (const [userId, vote] of Object.entries(suggestion.votes || {})) {
      if (String(userId) === String(suggestion.submitterId)) continue;
      if (!['up', 'down'].includes(vote)) continue;
      record.votes[String(userId)] = {
        userId: String(userId),
        optionIds: [vote === 'up' ? 'OPT-1' : 'OPT-2'],
        updatedAt: String(suggestion.createdAt || record.createdAt)
      };
    }
    return record;
  });
  const migrated = suggestionWithPoll({ ...suggestion, pollId: poll.id }, pollEngine.get(poll.id, { includeVotes: true }));
  store.setSuggestion(migrated.id, migrated);
  return migrated;
}

function castVote(suggestion, userId, vote) {
  if (!suggestion || suggestion.status !== 'voting') return { blocked: 'closed', suggestion };
  if (String(userId) === String(suggestion.submitterId)) return { blocked: 'self-vote', suggestion };
  if (!['up', 'down'].includes(vote)) return { blocked: 'invalid-vote', suggestion };
  const votes = { ...(suggestion.votes || {}) };
  let action = 'cast';
  if (votes[userId] === vote) {
    delete votes[userId];
    action = 'removed';
  } else if (votes[userId]) {
    votes[userId] = vote;
    action = 'changed';
  } else votes[userId] = vote;
  return { blocked: '', action, suggestion: { ...suggestion, votes } };
}

function passesCommunityGate(suggestion, settings) {
  const counts = voteCounts(suggestion);
  return counts.total >= settings.minVotes && counts.approval >= settings.passPercent;
}

function githubIssueBody(suggestion) {
  const counts = voteCounts(suggestion);
  return [
    '## Community suggestion',
    '',
    `**Suggestion ID:** ${suggestion.id}`,
    `**Category:** ${suggestion.category || 'Other'}`,
    `**Community vote:** ${counts.up} up / ${counts.down} down (${counts.approval}% approval)`,
    '',
    '### Suggestion',
    suggestion.details,
    '',
    '### Workflow',
    'This issue was created from the Khaos Nexus Discord community suggestion workflow after passing the community vote gate.',
    '',
    '**Owner approval is still required before implementation.**'
  ].join('\n').slice(0, 60000);
}

async function createGithubIssue(suggestion, settings, fetchImpl = globalThis.fetch) {
  if (!settings.githubToken) return { ok: false, pending: 'github-token-unconfigured' };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(settings.githubRepository)) return { ok: false, pending: 'github-repository-invalid' };
  if (typeof fetchImpl !== 'function') return { ok: false, pending: 'fetch-unavailable' };
  const response = await fetchImpl(`https://api.github.com/repos/${settings.githubRepository}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Khaos-Nexus-Sentinal',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      title: `[Community Suggestion ${suggestion.id}] ${cleanText(suggestion.title, 160)}`,
      body: githubIssueBody(suggestion)
    })
  });
  if (!response.ok) return { ok: false, pending: `github-http-${response.status}` };
  const data = await response.json();
  return { ok: true, number: Number(data.number) || null, url: String(data.html_url || '') };
}

async function editSuggestionMessage(client, suggestion, settings) {
  if (!suggestion.channelId || !suggestion.messageId) return false;
  const channel = await client.channels.fetch(String(suggestion.channelId)).catch(() => null);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(String(suggestion.messageId)).catch(() => null);
  if (!message) return false;
  await message.edit(suggestionPayload(suggestion, settings));
  return true;
}

async function closeSuggestion(client, store, suggestion, settings, options = {}) {
  if (!suggestion || !['voting', 'github-pending', 'community-passed'].includes(suggestion.status)) return suggestion;
  let next = { ...suggestion };
  if (suggestion.status === 'voting') {
    if (Date.parse(suggestion.closesAt) > Date.now() && options.force !== true) return suggestion;
    if (options.pollEngine && suggestion.pollId) {
      const poll = await options.pollEngine.close(suggestion.pollId, options.actorId || 'suggestion-scheduler');
      next = suggestionWithPoll(next, poll);
      next.status = poll.finalResult?.passed ? 'community-passed' : 'community-declined';
    } else next.status = passesCommunityGate(suggestion, settings) ? 'community-passed' : 'community-declined';
    store.setSuggestion(next.id, next);
  }
  if (['community-passed', 'github-pending'].includes(next.status)) {
    try {
      const synced = await createGithubIssue(next, settings, options.fetchImpl || globalThis.fetch);
      if (synced.ok) {
        next = { ...next, status: 'github-review', githubIssueNumber: synced.number, githubIssueUrl: synced.url };
      } else next = { ...next, status: 'github-pending', githubSyncReason: synced.pending };
      store.setSuggestion(next.id, next);
    } catch (error) {
      next = { ...next, status: 'github-pending', githubSyncReason: `github-error:${String(error?.message || error).slice(0, 120)}` };
      store.setSuggestion(next.id, next);
    }
  }
  await editSuggestionMessage(client, next, settings).catch(() => false);
  return next;
}

async function closeDueSuggestions(client, store, settings, options = {}) {
  const suggestions = Object.values(store.listSuggestions());
  let closed = 0;
  let githubSynced = 0;
  let githubPending = 0;
  for (const suggestion of suggestions) {
    const due = suggestion.status === 'voting' && Date.parse(suggestion.closesAt) <= Date.now();
    const retry = suggestion.status === 'github-pending';
    if (!due && !retry) continue;
    const before = suggestion.status;
    const next = await closeSuggestion(client, store, suggestion, settings, options);
    if (before === 'voting' && next.status !== 'voting') closed += 1;
    if (next.status === 'github-review') githubSynced += 1;
    if (next.status === 'github-pending') githubPending += 1;
  }
  return { closed, githubSynced, githubPending };
}

async function createSuggestionPost(interaction, store, settings, channel, pollEngine = null) {
  let suggestion = newSuggestion(store, interaction, settings);
  if (pollEngine) suggestion = ensureSuggestionPoll(store, suggestion, settings, pollEngine, { guildId: interaction.guildId, channelId: channel.id });
  const message = await channel.send(suggestionPayload(suggestion, settings));
  const stored = { ...suggestion, channelId: String(channel.id), messageId: String(message.id) };
  if (pollEngine && stored.pollId) {
    pollEngine.store.update(stored.pollId, (poll) => {
      poll.guildId = String(interaction.guildId || '');
      poll.channelId = String(channel.id);
      poll.messageId = String(message.id);
      return poll;
    });
  }
  store.setSuggestion(stored.id, stored);
  return stored;
}

async function handleSuggestionInteraction(interaction, context) {
  const { store, settings, channel, pollEngine } = context;
  if (interaction.isButton?.() && interaction.customId === SUBMIT_BUTTON_ID) {
    await interaction.showModal(createSuggestionModal());
    return true;
  }
  if (interaction.isModalSubmit?.() && interaction.customId === MODAL_ID) {
    const suggestion = await createSuggestionPost(interaction, store, settings, channel, pollEngine);
    await interaction.reply({ content: `✅ ${suggestion.id} is live for community voting.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (interaction.isButton?.() && /^kn:suggest:vote:SUG-\d{4,}:(?:up|down)$/.test(interaction.customId)) {
    const [, , , id, vote] = interaction.customId.split(':');
    let suggestion = store.getSuggestion(id);
    if (!suggestion) {
      await interaction.reply({ content: 'That suggestion is no longer available.', ephemeral: true });
      return true;
    }
    suggestion = ensureSuggestionPoll(store, suggestion, settings, pollEngine, { guildId: interaction.guildId, channelId: channel.id });
    if (Date.parse(suggestion.closesAt) <= Date.now() && suggestion.status === 'voting') suggestion = await closeSuggestion(interaction.client, store, suggestion, settings, { force: true, pollEngine, actorId: interaction.user.id });
    if (pollEngine && suggestion.pollId && suggestion.status === 'voting') {
      const poll = pollEngine.get(suggestion.pollId, { includeVotes: true });
      const current = poll?.votes?.[String(interaction.user.id)]?.optionIds?.[0] || '';
      const choice = vote === 'up' ? 'OPT-1' : 'OPT-2';
      const updated = current === choice
        ? pollEngine.removeVote(suggestion.pollId, { id: interaction.user.id, roleIds: [] })
        : pollEngine.castVote(suggestion.pollId, { id: interaction.user.id, roleIds: [] }, choice);
      const action = current === choice ? 'removed' : current ? 'changed' : 'cast';
      const projected = suggestionWithPoll(suggestion, updated);
      store.setSuggestion(id, projected);
      await interaction.update(suggestionPayload(projected, settings));
      await interaction.followUp({ content: `Your vote was ${action === 'cast' ? 'counted' : action}.`, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
      return true;
    }
    const result = castVote(suggestion, String(interaction.user.id), vote);
    if (result.blocked === 'self-vote') {
      await interaction.reply({ content: 'You cannot vote on your own suggestion.', ephemeral: true });
      return true;
    }
    if (result.blocked) {
      await interaction.reply({ content: 'Voting on this suggestion is closed.', ephemeral: true });
      return true;
    }
    store.setSuggestion(id, result.suggestion);
    await interaction.update(suggestionPayload(result.suggestion, settings));
    const phrase = result.action === 'removed' ? 'removed' : result.action === 'changed' ? 'changed' : 'counted';
    await interaction.followUp({ content: `Your vote was ${phrase}.`, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
  return false;
}

function installSuggestionsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const store = new StateStore();
  const pollEngine = new PollEngine({ store: new PollStore() });
  const settings = suggestionSettings();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSuggestionsLogin(...args) {
    let channel = null;
    const interactionHandler = (interaction) => {
      if (!channel) return;
      void handleSuggestionInteraction(interaction, { store, settings, channel, pollEngine }).catch(async (error) => {
        console.warn(`[Nexus Sentinal] suggestion interaction failed: ${String(error?.message || error).slice(0, 240)}`);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The suggestion action could not be completed.', ephemeral: true }).catch(() => {});
      });
    };
    this.on(Events.InteractionCreate, interactionHandler);

    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const guildId = String(config?.discord?.guildId || '').trim();
          if (!guildId) return;
          const guild = await this.guilds.fetch(guildId);
          const channelResult = await ensureSuggestionsChannel(guild, { botId: this.user?.id });
          channel = channelResult.channel;
          const panel = await ensureSuggestionPanel(channel, settings, { botId: this.user?.id });
          store.setSuggestionMeta({ ...store.getSuggestionMeta(), channelId: String(channel.id), panelMessageId: String(panel.message.id) });
          let pollsMigrated = 0;
          for (const suggestion of Object.values(store.listSuggestions())) {
            if (suggestion.status !== 'voting' || suggestion.pollId) continue;
            ensureSuggestionPoll(store, suggestion, settings, pollEngine, { guildId, channelId: channel.id });
            pollsMigrated += 1;
          }
          const closed = await closeDueSuggestions(this, store, settings, { pollEngine });
          console.log(`[Nexus Sentinal] suggestions (${reason}): channel=${channel.id} channelCreated=${channelResult.created} channelMoved=${channelResult.moved} panelCreated=${panel.created} duplicatesRemoved=${panel.duplicatesRemoved} pollsMigrated=${pollsMigrated} closed=${closed.closed} githubSynced=${closed.githubSynced} githubPending=${closed.githubPending}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] suggestions (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
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
  PANEL_MARKER,
  SUGGESTION_MARKER_PREFIX,
  SUBMIT_BUTTON_ID,
  MODAL_ID,
  suggestionSettings,
  cleanText,
  findCommunityCategory,
  findSuggestionsChannel,
  panelPayload,
  suggestionMarker,
  voteCounts,
  suggestionStatusLabel,
  suggestionPayload,
  createSuggestionModal,
  newSuggestion,
  pollVoteMap,
  suggestionWithPoll,
  ensureSuggestionPoll,
  castVote,
  passesCommunityGate,
  githubIssueBody,
  createGithubIssue,
  closeSuggestion,
  closeDueSuggestions,
  createSuggestionPost,
  handleSuggestionInteraction,
  ensureSuggestionsChannel,
  ensureSuggestionPanel,
  installSuggestionsExtension
};
