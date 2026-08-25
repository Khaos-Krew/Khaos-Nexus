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
const { findStaffCategory } = require('./staff-workspace.cjs');
const { suggestionPayload, suggestionSettings, voteCounts } = require('./suggestions-extension.cjs');
const {
  developmentPlanMarker,
  hasDevelopmentPlan,
  hydrateDevelopmentPlan
} = require('./suggestion-development-plan.cjs');

const INSTALLED = Symbol.for('khaos.nexus.suggestion-review.extension');
const CHANNEL_NAME = 'suggestion-review';
const CHANNEL_TOPIC = 'Protected Owner review queue for community suggestions that passed the vote gate.';
const REVIEW_MARKER_PREFIX = 'Nexus Sentinal • Suggestion Review • ';
const INITIAL_DELAY_MS = 25_000;
const REFRESH_MS = 5 * 60_000;
const REVIEWABLE_STATUSES = new Set(['community-passed', 'github-pending', 'github-review']);

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function ownerIds(guild, config = {}) {
  return normalizeIds([guild?.ownerId, ...(config.discord?.ownerUserIds || [])]);
}

function isAuthorizedOwner(interaction, config = {}) {
  const ids = new Set(ownerIds(interaction?.guild, config));
  return ids.has(String(interaction?.user?.id || ''));
}

function reviewMarker(id) {
  return `${REVIEW_MARKER_PREFIX}${String(id || '')}`;
}

function findReviewChannel(channels) {
  return valuesOf(channels).find((channel) => channel?.isTextBased?.() && String(channel.name || '').toLowerCase() === CHANNEL_NAME) || null;
}

function reviewChannelOverwrites(guild, botId, authorizedOwnerIds) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions
  ];
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(authorizedOwnerIds).map((id) => ({ id, type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageMessages] })),
    { id: String(botId), type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
  ];
}

async function ensureReviewChannel(guild, config = {}, botId = '') {
  const channels = await guild.channels.fetch();
  const staffCategory = findStaffCategory(channels);
  let channel = findReviewChannel(channels);
  const authorized = ownerIds(guild, config);
  let created = false;
  let moved = false;
  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: staffCategory?.id || undefined,
      topic: CHANNEL_TOPIC,
      permissionOverwrites: reviewChannelOverwrites(guild, botId, authorized),
      reason: 'Nexus Sentinal protected community suggestion Owner review queue'
    });
    created = true;
  } else {
    if (staffCategory && String(channel.parentId || '') !== String(staffCategory.id) && typeof channel.setParent === 'function') {
      await channel.setParent(staffCategory.id, { lockPermissions: false, reason: 'Keep suggestion review inside the protected Staff workspace' });
      moved = true;
    }
    if (String(channel.topic || '') !== CHANNEL_TOPIC && typeof channel.setTopic === 'function') {
      await channel.setTopic(CHANNEL_TOPIC, 'Keep suggestion review purpose current');
    }
    if (channel.permissionOverwrites?.set) {
      await channel.permissionOverwrites.set(reviewChannelOverwrites(guild, botId, authorized), 'Protect the Nexus suggestion Owner review queue');
    }
  }
  return { channel, created, moved, authorizedOwnerIds: authorized };
}

function statusText(suggestion) {
  if (suggestion.status === 'approved') return '🚀 Approved for implementation';
  if (suggestion.status === 'denied') return '⛔ Denied';
  if (suggestion.status === 'github-review' && hasDevelopmentPlan(suggestion)) return '🧭 Development plan ready for Owner review';
  if (suggestion.status === 'github-review') return '📝 Development planning pending';
  if (suggestion.status === 'github-pending') return '📥 GitHub sync pending';
  return '✅ Community passed';
}

function reviewPayload(suggestion) {
  const counts = voteCounts(suggestion);
  const reviewable = REVIEWABLE_STATUSES.has(suggestion.status);
  const planReady = hasDevelopmentPlan(suggestion);
  const fields = [
    { name: 'Status', value: statusText(suggestion), inline: true },
    { name: 'Category', value: String(suggestion.category || 'Other').slice(0, 100), inline: true },
    { name: 'Community Vote', value: `👍 ${counts.up} • 👎 ${counts.down} • ${counts.approval}% approval`, inline: false },
    {
      name: 'Decision rule',
      value: reviewable
        ? (planReady ? 'A trusted GitHub development plan is attached. Review it before approving implementation.' : 'Owner approval is locked until a trusted GitHub development plan is attached. Denial remains available at any time.')
        : 'This decision is recorded in Sentinal state and reflected on the public suggestion card.',
      inline: false
    }
  ];
  if (suggestion.githubIssueUrl) fields.push({ name: 'Development Issue', value: `[Open GitHub issue](${suggestion.githubIssueUrl})`, inline: false });
  if (reviewable && !planReady && suggestion.githubIssueNumber) {
    fields.push({
      name: 'Planning Handoff',
      value: `Waiting for a trusted repository collaborator to post a plan comment containing \`${developmentPlanMarker(suggestion.id)}\`.`,
      inline: false
    });
  }
  if (planReady) {
    fields.push({
      name: 'Development Plan',
      value: String(suggestion.developmentPlan).slice(0, 1000),
      inline: false
    });
    if (suggestion.developmentPlanUrl) {
      fields.push({ name: 'Plan Source', value: `[Open development plan comment](${suggestion.developmentPlanUrl})`, inline: false });
    }
  }
  if (suggestion.reviewReason) fields.push({ name: suggestion.status === 'denied' ? 'Denial Reason' : 'Owner Note', value: String(suggestion.reviewReason).slice(0, 1000), inline: false });

  const components = [];
  if (reviewable) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`kn:suggest:review:${suggestion.id}:approve`)
        .setLabel(planReady ? 'Approve Implementation' : 'Approval Locked — Plan Needed')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
        .setDisabled(!planReady),
      new ButtonBuilder().setCustomId(`kn:suggest:review:${suggestion.id}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('⛔')
    ));
  }
  if (suggestion.githubIssueUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open Development Issue').setStyle(ButtonStyle.Link).setURL(suggestion.githubIssueUrl)
    ));
  }

  return {
    embeds: [{
      title: `🧭 ${suggestion.id} • ${String(suggestion.title || 'Community Suggestion').slice(0, 180)}`,
      description: String(suggestion.details || 'No details provided.').slice(0, 4000),
      color: suggestion.status === 'denied' ? 0x992d22 : suggestion.status === 'approved' ? 0x2ecc71 : planReady ? 0x2ecc71 : 0xe3264f,
      fields,
      footer: { text: reviewMarker(suggestion.id) },
      timestamp: suggestion.createdAt
    }],
    components,
    allowedMentions: { parse: [] }
  };
}

function reviewMessageMatches(message, suggestionId, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === reviewMarker(suggestionId));
}

async function findReviewMessage(channel, suggestionId, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const matches = recent?.values ? [...recent.values()].filter((message) => reviewMessageMatches(message, suggestionId, botId)) : [];
  matches.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  return { message: matches[0] || null, duplicates: matches.slice(1) };
}

async function reconcileReviewMessage(channel, suggestion, botId = '') {
  const found = await findReviewMessage(channel, suggestion.id, botId);
  let message = found.message;
  let created = false;
  if (message) await message.edit(reviewPayload(suggestion));
  else { message = await channel.send(reviewPayload(suggestion)); created = true; }
  let duplicatesRemoved = 0;
  for (const duplicate of found.duplicates) {
    try { await duplicate.delete('Nexus Sentinal duplicate suggestion review cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, duplicatesRemoved };
}

async function updatePublicSuggestion(client, suggestion, settings) {
  if (!suggestion?.channelId || !suggestion?.messageId) return false;
  const channel = await client.channels.fetch(String(suggestion.channelId)).catch(() => null);
  const message = await channel?.messages?.fetch?.(String(suggestion.messageId)).catch(() => null);
  if (!message) return false;
  await message.edit(suggestionPayload(suggestion, settings));
  return true;
}

function denialModal(suggestionId) {
  return new ModalBuilder()
    .setCustomId(`kn:suggest:review-deny:${suggestionId}`)
    .setTitle(`Deny ${suggestionId}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(1000)
        .setPlaceholder('Explain why this suggestion will not move forward.')
    ));
}

async function applyOwnerDecision(interaction, store, settings, decision, reason = '') {
  const id = String(interaction.customId || '').match(/SUG-\d{4,}/)?.[0] || '';
  const suggestion = store.getSuggestion(id);
  if (!suggestion) return { ok: false, reason: 'missing' };
  if (!REVIEWABLE_STATUSES.has(suggestion.status)) return { ok: false, reason: 'closed', suggestion };
  if (decision === 'approved' && !hasDevelopmentPlan(suggestion)) return { ok: false, reason: 'plan-required', suggestion };
  const next = {
    ...suggestion,
    status: decision === 'approved' ? 'approved' : 'denied',
    reviewReason: decision === 'approved' ? (reason || 'Approved by Nexus Owner for implementation.') : String(reason || '').trim(),
    reviewedAt: new Date().toISOString(),
    reviewedBy: String(interaction.user.id)
  };
  if (next.status === 'denied' && !next.reviewReason) return { ok: false, reason: 'reason-required', suggestion };
  store.setSuggestion(id, next);
  await updatePublicSuggestion(interaction.client, next, settings).catch(() => false);
  return { ok: true, suggestion: next };
}

function decisionErrorMessage(reason) {
  if (reason === 'closed') return 'That suggestion has already been decided.';
  if (reason === 'plan-required') return 'Approval is locked until Sentinal imports a trusted development plan from the GitHub issue.';
  return 'That suggestion could not be found.';
}

async function handleReviewInteraction(interaction, context) {
  const { store, settings, config, channel } = context;
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('kn:suggest:review')) return false;
  if (!isAuthorizedOwner(interaction, config)) {
    if (interaction.isButton?.() || interaction.isModalSubmit?.()) {
      await interaction.reply({ content: 'Only an authorized Nexus Owner can make this suggestion decision.', ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    }
    return true;
  }

  const id = customId.match(/SUG-\d{4,}/)?.[0] || '';
  if (!id) return false;
  if (interaction.isButton?.() && customId.endsWith(':deny')) {
    await interaction.showModal(denialModal(id));
    return true;
  }
  if (interaction.isButton?.() && customId.endsWith(':approve')) {
    const result = await applyOwnerDecision(interaction, store, settings, 'approved');
    if (!result.ok) {
      await interaction.reply({ content: decisionErrorMessage(result.reason), ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    await interaction.update(reviewPayload(result.suggestion));
    return true;
  }
  if (interaction.isModalSubmit?.() && customId.startsWith('kn:suggest:review-deny:')) {
    const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
    const result = await applyOwnerDecision(interaction, store, settings, 'denied', reason);
    if (!result.ok) {
      await interaction.reply({ content: decisionErrorMessage(result.reason), ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    const review = await findReviewMessage(channel, id, interaction.client.user?.id);
    if (review.message) await review.message.edit(reviewPayload(result.suggestion));
    await interaction.reply({ content: `${id} was denied and the public suggestion card was updated with your reason.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

async function reconcileReviewQueue(client, store, config, settings, options = {}) {
  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) return { skipped: 'guild-unconfigured' };
  const guild = options.guild || await client.guilds.fetch(guildId);
  const channelResult = await ensureReviewChannel(guild, config, client.user?.id);
  const suggestions = Object.values(store.listSuggestions()).filter((suggestion) => REVIEWABLE_STATUSES.has(suggestion.status) || ['approved', 'denied'].includes(suggestion.status));
  let created = 0;
  let duplicatesRemoved = 0;
  let plansLoaded = 0;
  let planningPending = 0;
  for (const original of suggestions) {
    let suggestion = original;
    if (REVIEWABLE_STATUSES.has(suggestion.status) && suggestion.githubIssueNumber && !hasDevelopmentPlan(suggestion)) {
      const hydration = await hydrateDevelopmentPlan(store, suggestion, settings, options.fetchImpl || globalThis.fetch).catch((error) => ({
        changed: false,
        suggestion,
        pending: String(error?.message || error).slice(0, 160)
      }));
      suggestion = hydration.suggestion || suggestion;
      if (hydration.changed) plansLoaded += 1;
      else planningPending += 1;
    }
    const result = await reconcileReviewMessage(channelResult.channel, suggestion, client.user?.id);
    if (result.created) created += 1;
    duplicatesRemoved += result.duplicatesRemoved;
  }
  return {
    channel: channelResult.channel,
    channelCreated: channelResult.created,
    channelMoved: channelResult.moved,
    authorizedOwners: channelResult.authorizedOwnerIds.length,
    tracked: suggestions.length,
    created,
    duplicatesRemoved,
    plansLoaded,
    planningPending
  };
}

function installSuggestionReviewExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const store = new StateStore();
  const settings = suggestionSettings();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSuggestionReviewLogin(...args) {
    let reviewChannel = null;
    this.on(Events.InteractionCreate, (interaction) => {
      if (!reviewChannel) return;
      void handleReviewInteraction(interaction, { store, settings, config, channel: reviewChannel }).catch(async (error) => {
        console.warn(`[Nexus Sentinal] suggestion review interaction failed: ${String(error?.message || error).slice(0, 240)}`);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The suggestion review action could not be completed.', ephemeral: true }).catch(() => {});
      });
    });

    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await reconcileReviewQueue(this, store, config, settings);
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] suggestion review (${reason}) skipped: ${result.skipped}`);
            return;
          }
          reviewChannel = result.channel;
          console.log(`[Nexus Sentinal] suggestion review (${reason}): channel=${reviewChannel.id} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} owners=${result.authorizedOwners} tracked=${result.tracked} cardsCreated=${result.created} duplicatesRemoved=${result.duplicatesRemoved} plansLoaded=${result.plansLoaded} planningPending=${result.planningPending}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] suggestion review (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
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
  CHANNEL_NAME,
  CHANNEL_TOPIC,
  REVIEW_MARKER_PREFIX,
  REVIEWABLE_STATUSES,
  normalizeIds,
  ownerIds,
  isAuthorizedOwner,
  reviewMarker,
  findReviewChannel,
  reviewChannelOverwrites,
  ensureReviewChannel,
  statusText,
  reviewPayload,
  reviewMessageMatches,
  findReviewMessage,
  reconcileReviewMessage,
  updatePublicSuggestion,
  denialModal,
  applyOwnerDecision,
  decisionErrorMessage,
  handleReviewInteraction,
  reconcileReviewQueue,
  installSuggestionReviewExtension
};
