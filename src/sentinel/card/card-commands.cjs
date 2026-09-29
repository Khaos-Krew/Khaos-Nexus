'use strict';

const {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { isCardAdmin, DISCORD_ID } = require('./card-config.cjs');
const { catalog, gameById, platformById, platformCatalog, suggestGames, suggestPlatforms, validatePlatform, validateTag } = require('./tag-validate.cjs');
const { assembleCardModel, balancesPermitted, buildReaders } = require('./card-model.cjs');
const { escapeUserText, renderCardEmbed } = require('./card-embed.cjs');

const HIDDEN_TEXT = "This player's card is hidden.";
const NO_MENTIONS = Object.freeze({ parse: [] });

function mentionSafe(payload) {
  return { ...payload, allowedMentions: { parse: [] } };
}

function platformOption(option, required) {
  return option
    .setName('platform')
    .setDescription('Platform account')
    .setRequired(required)
    .addChoices(...platformCatalog().map((entry) => ({ name: entry.label, value: entry.id })));
}

function cardCommandDefinition() {
  // Discord only allows subcommands or root options, not both. `/card` and
  // `/card user:` are the `show` subcommand (user optional). Admin clear cannot
  // take a command-level Administrator default without hiding the rest of /card,
  // so Administrator is enforced at runtime (B4-FINAL.10).
  return new SlashCommandBuilder()
    .setName('card')
    .setDescription('Show a Khaos Nexus player card, or manage your tags and privacy')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('show')
      .setDescription('Show your card, or post another player\'s public card')
      .addUserOption((option) => option.setName('user').setDescription('Player to view in this channel').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('link')
      .setDescription('Add or replace your tag for a game')
      .addStringOption((option) => option.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName('tag').setDescription('Your tag for that game').setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName('name').setDescription('Game name (required for Other)').setRequired(false).setMaxLength(80)))
    .addSubcommand((sub) => sub
      .setName('unlink')
      .setDescription('Remove your tag for a game')
      .addStringOption((option) => option.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub
      .setName('tags')
      .setDescription('List your gamer tags'))
    .addSubcommand((sub) => sub
      .setName('privacy')
      .setDescription('Hide or show your player card')
      .addBooleanOption((option) => option.setName('hidden').setDescription('Hide your card from other players').setRequired(true)))
    .addSubcommandGroup((group) => group
      .setName('platform')
      .setDescription('Link or unlink a Steam, Xbox, PSN, Nintendo, Epic, Battle.net, EA, Ubisoft, or Riot account')
      .addSubcommand((sub) => sub
        .setName('link')
        .setDescription('Add or replace your tag for a platform')
        .addStringOption((option) => platformOption(option, true))
        .addStringOption((option) => option.setName('tag').setDescription('Your platform tag').setRequired(true).setMaxLength(96)))
      .addSubcommand((sub) => sub
        .setName('unlink')
        .setDescription('Remove your tag for a platform')
        .addStringOption((option) => platformOption(option, true))))
    .addSubcommandGroup((group) => group
      .setName('admin')
      .setDescription('Administrator player-card tools')
      .addSubcommand((sub) => sub
        .setName('clear')
        .setDescription('Remove a player tag. Requires Administrator or the O9 admin allow-list.')
        .addUserOption((option) => option.setName('user').setDescription('Player').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Why this tag is being removed').setRequired(true).setMinLength(3).setMaxLength(200))
        .addStringOption((option) => option.setName('game').setDescription('Game tag to remove').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => platformOption(option, false))));
}

function viewCardContextMenu() {
  return new ContextMenuCommandBuilder()
    .setName('View Card')
    .setType(ApplicationCommandType.User)
    .setDMPermission(false);
}

function viewCardButton(userId) {
  return new ButtonBuilder()
    .setCustomId(`card:view:${userId}`)
    .setLabel('View Card')
    .setStyle(ButtonStyle.Secondary);
}

function ownCardRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('card:share').setLabel('Share').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('card:tags').setLabel('Manage tags').setStyle(ButtonStyle.Secondary)
  )];
}

function isEnabled(deps) {
  if (typeof deps?.isEnabled === 'function') return deps.isEnabled() === true;
  if (typeof deps?.enabled === 'boolean') return deps.enabled;
  return false;
}

function isCardInteraction(interaction) {
  if (interaction?.isChatInputCommand?.() && interaction.commandName === 'card') return true;
  if (interaction?.isAutocomplete?.() && interaction.commandName === 'card') return true;
  if (interaction?.isUserContextMenuCommand?.() && interaction.commandName === 'View Card') return true;
  const customId = String(interaction?.customId || '');
  if (interaction?.isButton?.() && (customId === 'card:share' || customId === 'card:tags' || customId.startsWith('card:view:'))) return true;
  return false;
}

async function deliver(interaction, payload, { ephemeral = false } = {}) {
  const body = mentionSafe(payload);
  if (interaction.deferred || interaction.replied) return interaction.editReply(body);
  if (ephemeral) body.flags = MessageFlags.Ephemeral;
  return interaction.reply(body);
}

async function defer(interaction, ephemeral) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(mentionSafe(ephemeral ? { flags: MessageFlags.Ephemeral } : {}));
  interaction.deferred = true;
}

function gamesOf(deps) {
  return deps?.catalog || catalog();
}

function knownGame(deps, gameId) {
  return gameById(gameId, gamesOf(deps));
}

function clock(deps) {
  return typeof deps?.now === 'function' ? Number(deps.now()) : Date.now();
}

async function rejectAudit(deps, game, reason) {
  if (!deps?.audit) return;
  await deps.audit.reject({ game: game || null, reason });
}

async function loadUser(interaction, targetUserId, known) {
  if (known && String(known.id) === String(targetUserId)) return known;
  if (String(interaction.user?.id) === String(targetUserId)) return interaction.user;
  try {
    if (typeof interaction.client?.users?.fetch === 'function') return await interaction.client.users.fetch(String(targetUserId));
  } catch { /* display name falls back */ }
  return { id: String(targetUserId), username: 'Player' };
}

function readersFor(deps, interaction, targetUserId) {
  if (typeof deps.readers === 'function') return deps.readers({ interaction, targetUserId });
  return buildReaders({
    backend: deps.backend,
    economy: deps.economy,
    store: deps.store,
    config: deps.config || {},
    interaction,
    targetUserId
  });
}

async function renderModel(deps, interaction, targetUserId, surface, knownUser) {
  const viewerId = String(interaction.user.id);
  const allowBalances = balancesPermitted(surface, viewerId, targetUserId);
  const model = await assembleCardModel({
    viewerId,
    targetUserId: String(targetUserId),
    allowBalances,
    readers: readersFor(deps, interaction, targetUserId),
    timeoutMs: deps.timeoutMs || 1500
  });
  if (model.hidden) return { model, embed: null, user: knownUser || null };
  const user = await loadUser(interaction, targetUserId, knownUser);
  return { model, embed: renderCardEmbed(model, user, gamesOf(deps)), user };
}

async function handleShow(interaction, deps, { targetUser, surface }) {
  const viewerId = String(interaction.user.id);
  const target = targetUser || interaction.user;
  const targetUserId = String(target.id || '');
  if (!DISCORD_ID.test(targetUserId)) {
    await deliver(interaction, { content: 'That player could not be found.' }, { ephemeral: true });
    return;
  }
  if (target.bot) {
    await deliver(interaction, { content: 'Bots do not have a player card.' }, { ephemeral: true });
    return;
  }
  const now = clock(deps);
  const view = deps.limiters.takeView(viewerId, now);
  if (!view.ok) {
    await deliver(interaction, { content: 'Please wait a few seconds before viewing another card.' }, { ephemeral: true });
    return;
  }
  const prefs = deps.store.getUser(targetUserId);
  const postingPublic = surface === 'public';
  if (prefs.hidden && (postingPublic || viewerId !== targetUserId)) {
    const content = postingPublic && viewerId === targetUserId
      ? 'Your card is hidden, so it was not posted.'
      : HIDDEN_TEXT;
    await deliver(interaction, { content }, { ephemeral: true });
    return;
  }
  if (postingPublic) {
    const channelId = String(interaction.channelId || interaction.channel?.id || '');
    const channel = deps.limiters.takePublicChannel(channelId, now);
    if (!channel.ok) {
      await deliver(interaction, { content: 'This channel can take another public card shortly.' }, { ephemeral: true });
      return;
    }
  }
  await defer(interaction, !postingPublic);
  const rendered = await renderModel(deps, interaction, targetUserId, surface, target);
  if (rendered.model.hidden) {
    await deliver(interaction, { content: HIDDEN_TEXT }, { ephemeral: true });
    return;
  }
  const payload = { embeds: [rendered.embed] };
  if (surface === 'own') payload.components = ownCardRows();
  await deliver(interaction, payload, { ephemeral: !postingPublic });
}

async function handleLink(interaction, deps) {
  const viewerId = String(interaction.user.id);
  const gameId = String(interaction.options.getString('game') || '');
  const known = knownGame(deps, gameId);
  const now = clock(deps);
  const limited = deps.limiters.takeLink(viewerId, known ? gameId : 'unknown', now);
  if (!limited.ok) {
    await rejectAudit(deps, known ? gameId : null, limited.reason);
    await deliver(interaction, { content: 'You are linking tags too quickly. Try again later.' }, { ephemeral: true });
    return;
  }
  const existing = deps.store.getUser(viewerId).tags;
  const validated = validateTag({
    gameId,
    tag: interaction.options.getString('tag'),
    name: interaction.options.getString('name') || '',
    games: gamesOf(deps),
    existingTags: existing
  });
  if (!validated.ok) {
    await rejectAudit(deps, validated.game, validated.reason);
    await deliver(interaction, { content: 'That tag was not saved. Check the game rules and try a different tag.' }, { ephemeral: true });
    return;
  }
  const saved = await deps.store.setTag(viewerId, validated.game, { tag: validated.tag, game: validated.name });
  if (!saved.ok) {
    await rejectAudit(deps, validated.game, saved.reason);
    await deliver(interaction, { content: 'That tag was not saved. You already have the maximum number of tags.' }, { ephemeral: true });
    return;
  }
  await deps.audit.append({
    actorId: viewerId,
    targetId: viewerId,
    game: validated.game,
    action: 'link',
    oldTag: saved.oldTag,
    newTag: saved.tag.tag,
    reason: 'ok'
  });
  const label = knownGame(deps, validated.game)?.label || validated.game;
  const shown = validated.game === 'other' ? `${validated.name}: ${validated.tag}` : validated.tag;
  await deliver(interaction, {
    content: `Saved **${escapeUserText(label)}**:\n${escapeUserText(shown)}`
  }, { ephemeral: true });
}

async function handlePlatformLink(interaction, deps) {
  const viewerId = String(interaction.user.id);
  const platformId = String(interaction.options.getString('platform') || '');
  const known = platformById(platformId);
  const slot = known ? `platform:${known.id}` : 'platform:unknown';
  const now = clock(deps);
  const limited = deps.limiters.takeLink(viewerId, slot, now);
  if (!limited.ok) {
    await rejectAudit(deps, known ? slot : null, limited.reason);
    await deliver(interaction, { content: 'You are linking tags too quickly. Try again later.' }, { ephemeral: true });
    return;
  }
  const validated = validatePlatform({ platformId, tag: interaction.options.getString('tag') });
  if (!validated.ok) {
    await rejectAudit(deps, validated.platform ? `platform:${validated.platform}` : null, validated.reason);
    await deliver(interaction, { content: 'That platform tag was not saved. Check the format and try a different tag.' }, { ephemeral: true });
    return;
  }
  const saved = await deps.store.setPlatform(viewerId, validated.platform, { tag: validated.tag });
  if (!saved.ok) {
    await rejectAudit(deps, `platform:${validated.platform}`, saved.reason);
    await deliver(interaction, { content: 'That platform tag was not saved.' }, { ephemeral: true });
    return;
  }
  await deps.audit.append({
    actorId: viewerId,
    targetId: viewerId,
    game: `platform:${validated.platform}`,
    action: 'link',
    oldTag: saved.oldTag,
    newTag: saved.tag.tag,
    reason: 'ok'
  });
  const label = platformById(validated.platform)?.label || validated.platform;
  await deliver(interaction, {
    content: `Saved **${escapeUserText(label)}**:\n${escapeUserText(saved.tag.tag)}`
  }, { ephemeral: true });
}

async function handlePlatformUnlink(interaction, deps) {
  const viewerId = String(interaction.user.id);
  const platformId = String(interaction.options.getString('platform') || '');
  const known = platformById(platformId);
  const slot = known ? `platform:${known.id}` : 'platform:unknown';
  const now = clock(deps);
  const limited = deps.limiters.takeLink(viewerId, slot, now);
  if (!limited.ok) {
    await rejectAudit(deps, known ? slot : null, limited.reason);
    await deliver(interaction, { content: 'You are changing tags too quickly. Try again later.' }, { ephemeral: true });
    return;
  }
  if (!known) {
    await rejectAudit(deps, null, 'unknown-platform');
    await deliver(interaction, { content: 'That platform is not in the card catalog.' }, { ephemeral: true });
    return;
  }
  const removed = await deps.store.removePlatform(viewerId, known.id);
  if (!removed.ok) {
    await deliver(interaction, { content: 'You do not have a tag for that platform.' }, { ephemeral: true });
    return;
  }
  await deps.audit.append({
    actorId: viewerId,
    targetId: viewerId,
    game: `platform:${known.id}`,
    action: 'unlink',
    oldTag: removed.removed.tag,
    newTag: null,
    reason: 'ok'
  });
  await deliver(interaction, { content: `Removed your **${escapeUserText(known.label)}** tag.` }, { ephemeral: true });
}

async function handleUnlink(interaction, deps) {
  const viewerId = String(interaction.user.id);
  const gameId = String(interaction.options.getString('game') || '');
  const known = knownGame(deps, gameId);
  const now = clock(deps);
  const limited = deps.limiters.takeLink(viewerId, known ? gameId : 'unknown', now);
  if (!limited.ok) {
    await rejectAudit(deps, known ? gameId : null, limited.reason);
    await deliver(interaction, { content: 'You are changing tags too quickly. Try again later.' }, { ephemeral: true });
    return;
  }
  if (!known) {
    await rejectAudit(deps, null, 'unknown-game');
    await deliver(interaction, { content: 'That game is not in the card catalog.' }, { ephemeral: true });
    return;
  }
  const removed = await deps.store.removeTag(viewerId, known.id);
  if (!removed.ok) {
    await deliver(interaction, { content: 'You do not have a tag for that game.' }, { ephemeral: true });
    return;
  }
  await deps.audit.append({
    actorId: viewerId,
    targetId: viewerId,
    game: known.id,
    action: 'unlink',
    oldTag: removed.removed.tag,
    newTag: null,
    reason: 'ok'
  });
  await deliver(interaction, { content: `Removed your **${escapeUserText(known.label)}** tag.` }, { ephemeral: true });
}

function catalogLines(entries, labelFor) {
  return entries.map((entry) => `${escapeUserText(labelFor(entry))}: ${escapeUserText(entry.tag)}`);
}

async function handleTags(interaction, deps) {
  const games = catalogLines(deps.store.listTags(interaction.user.id), (entry) => (
    entry.gameId === 'other' ? (entry.game || 'Other') : (knownGame(deps, entry.gameId)?.label || entry.gameId)
  ));
  const platforms = catalogLines(
    platformCatalog()
      .map((entry) => deps.store.listPlatforms(interaction.user.id).find((item) => item.platformId === entry.id))
      .filter(Boolean),
    (entry) => platformById(entry.platformId)?.label || entry.platformId
  );
  const sections = [];
  if (games.length) sections.push(`Games:\n${games.join('\n')}`);
  if (platforms.length) sections.push(`Platforms:\n${platforms.join('\n')}`);
  await deliver(interaction, {
    content: sections.length
      ? `${sections.join('\n\n')}\n\nLink again for the same game or platform to replace a tag.`
      : 'You have no gamer tags yet. Use `/card link` for a game and `/card platform link` for a platform.'
  }, { ephemeral: true });
}

async function handlePrivacy(interaction, deps) {
  const hidden = interaction.options.getBoolean('hidden') === true;
  await deps.store.setHidden(interaction.user.id, hidden);
  await deps.audit.append({
    actorId: String(interaction.user.id),
    targetId: String(interaction.user.id),
    game: null,
    action: 'privacy',
    oldTag: null,
    newTag: null,
    reason: hidden ? 'hidden' : 'visible'
  });
  await deliver(interaction, {
    content: hidden ? 'Your card is now hidden from other players.' : 'Your card is visible to other players again.'
  }, { ephemeral: true });
}

async function handleAdminClear(interaction, deps) {
  if (!isCardAdmin(interaction, deps.config || {})) {
    await deliver(interaction, { content: 'You need Administrator, or the O9 admin allow-list, to clear a tag.' }, { ephemeral: true });
    return;
  }
  const reason = String(interaction.options.getString('reason') || '').trim();
  if (reason.length < 3 || reason.length > 200) {
    await deliver(interaction, { content: 'A reason of 3 to 200 characters is required.' }, { ephemeral: true });
    return;
  }
  const target = interaction.options.getUser('user', true);
  const gameId = String(interaction.options.getString('game') || '');
  const platformId = String(interaction.options.getString('platform') || '');
  if (!DISCORD_ID.test(String(target?.id || '')) || Boolean(gameId) === Boolean(platformId)) {
    await deliver(interaction, { content: 'Choose one game or one platform to clear.' }, { ephemeral: true });
    return;
  }
  if (platformId) {
    const known = platformById(platformId);
    if (!known) {
      await rejectAudit(deps, null, 'unknown-platform');
      await deliver(interaction, { content: 'That player or platform could not be cleared.' }, { ephemeral: true });
      return;
    }
    const removed = await deps.store.removePlatform(target.id, known.id);
    if (!removed.ok) {
      await deliver(interaction, { content: 'That player does not have a tag for that platform.' }, { ephemeral: true });
      return;
    }
    await deps.audit.append({
      actorId: String(interaction.user.id),
      targetId: String(target.id),
      game: `platform:${known.id}`,
      action: 'admin-clear',
      oldTag: removed.removed.tag,
      newTag: null,
      reason
    });
    await deliver(interaction, {
      content: `Removed the **${escapeUserText(known.label)}** tag for ${escapeUserText(target.username || 'that player')}.`
    }, { ephemeral: true });
    return;
  }
  const known = knownGame(deps, gameId);
  if (!known) {
    await rejectAudit(deps, null, 'unknown-game');
    await deliver(interaction, { content: 'That player or game could not be cleared.' }, { ephemeral: true });
    return;
  }
  const removed = await deps.store.removeTag(target.id, known.id);
  if (!removed.ok) {
    await deliver(interaction, { content: 'That player does not have a tag for that game.' }, { ephemeral: true });
    return;
  }
  await deps.audit.append({
    actorId: String(interaction.user.id),
    targetId: String(target.id),
    game: known.id,
    action: 'admin-clear',
    oldTag: removed.removed.tag,
    newTag: null,
    reason
  });
  await deliver(interaction, {
    content: `Removed the **${escapeUserText(known.label)}** tag for ${escapeUserText(target.username || 'that player')}.`
  }, { ephemeral: true });
}

async function handleShare(interaction, deps) {
  const viewerId = String(interaction.user.id);
  const now = clock(deps);
  const view = deps.limiters.takeView(viewerId, now);
  if (!view.ok) {
    await deliver(interaction, { content: 'Please wait a few seconds before sharing your card.' }, { ephemeral: true });
    return;
  }
  if (deps.store.getUser(viewerId).hidden) {
    await deliver(interaction, { content: 'Your card is hidden, so it was not posted.' }, { ephemeral: true });
    return;
  }
  const channelId = String(interaction.channelId || interaction.channel?.id || '');
  const channelLimit = deps.limiters.takePublicChannel(channelId, now);
  if (!channelLimit.ok) {
    await deliver(interaction, { content: 'This channel can take another public card shortly.' }, { ephemeral: true });
    return;
  }
  await defer(interaction, true);
  const rendered = await renderModel(deps, interaction, viewerId, 'share', interaction.user);
  if (!interaction.channel || typeof interaction.channel.send !== 'function' || !rendered.embed) {
    await deliver(interaction, { content: 'Your public card could not be posted in this channel.' }, { ephemeral: true });
    return;
  }
  try {
    await interaction.channel.send(mentionSafe({ embeds: [rendered.embed] }));
  } catch {
    await deliver(interaction, { content: 'Your public card could not be posted in this channel.' }, { ephemeral: true });
    return;
  }
  await deliver(interaction, { content: 'Shared your public card in this channel.' }, { ephemeral: true });
}

async function handleViewButton(interaction, deps) {
  const customId = String(interaction.customId || '');
  const match = /^card:view:(\d{15,24})$/.exec(customId);
  if (!match) {
    await deliver(interaction, { content: 'That card button is not valid.' }, { ephemeral: true });
    return;
  }
  const targetUserId = match[1];
  const target = await loadUser(interaction, targetUserId, null);
  await handleShow(interaction, deps, {
    targetUser: { ...target, id: targetUserId, bot: target.bot === true },
    surface: 'view-button'
  });
}

async function handleContextMenu(interaction, deps) {
  const target = interaction.targetUser || { id: interaction.targetId, username: 'Player', bot: false };
  await handleShow(interaction, deps, { targetUser: target, surface: 'context' });
}

async function handleAutocomplete(interaction, deps) {
  const focused = interaction.options.getFocused(true);
  const name = focused && typeof focused === 'object' ? focused.name : 'game';
  const value = focused && typeof focused === 'object' ? focused.value : focused;
  if (!isEnabled(deps)) {
    await interaction.respond([]);
    return;
  }
  if (name === 'platform') {
    await interaction.respond(suggestPlatforms(value, platformCatalog()));
    return;
  }
  if (name === 'game') {
    await interaction.respond(suggestGames(value, gamesOf(deps)));
    return;
  }
  await interaction.respond([]);
}

async function dispatch(interaction, deps) {
  if (!interaction.guildId) {
    await deliver(interaction, { content: 'Player cards are used in the Khaos Nexus server.' }, { ephemeral: true });
    return;
  }
  if (interaction.isAutocomplete?.()) {
    await handleAutocomplete(interaction, deps);
    return;
  }
  if (!isEnabled(deps)) {
    await deliver(interaction, { content: 'Player cards are turned off.' }, { ephemeral: true });
    return;
  }
  if (interaction.isButton?.() && interaction.customId === 'card:share') {
    await handleShare(interaction, deps);
    return;
  }
  if (interaction.isButton?.() && interaction.customId === 'card:tags') {
    await deliver(interaction, {
      content: 'Use `/card link` for a game and `/card platform link` for a platform account. `/card unlink` and `/card platform unlink` remove them. `/card tags` lists them.'
    }, { ephemeral: true });
    return;
  }
  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('card:view:')) {
    await handleViewButton(interaction, deps);
    return;
  }
  if (interaction.isUserContextMenuCommand?.()) {
    await handleContextMenu(interaction, deps);
    return;
  }
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(true);
  if (group === 'admin' && sub === 'clear') {
    await handleAdminClear(interaction, deps);
    return;
  }
  if (group === 'platform' && sub === 'link') return handlePlatformLink(interaction, deps);
  if (group === 'platform' && sub === 'unlink') return handlePlatformUnlink(interaction, deps);
  if (sub === 'show') {
    const selected = interaction.options.getUser('user');
    await handleShow(interaction, deps, {
      targetUser: selected || interaction.user,
      surface: selected ? 'public' : 'own'
    });
    return;
  }
  if (sub === 'link') return handleLink(interaction, deps);
  if (sub === 'unlink') return handleUnlink(interaction, deps);
  if (sub === 'tags') return handleTags(interaction, deps);
  if (sub === 'privacy') return handlePrivacy(interaction, deps);
  await deliver(interaction, { content: 'That card action is not available.' }, { ephemeral: true });
}

async function handleCardInteraction(interaction, deps = {}) {
  if (!isCardInteraction(interaction)) return false;
  try {
    await dispatch(interaction, deps);
  } catch (error) {
    console.warn(`[Player Card] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
    const content = 'The player card could not be loaded.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(mentionSafe({ content }));
      else {
        await interaction.reply(mentionSafe({
          content,
          flags: MessageFlags.Ephemeral
        }));
      }
    } catch { /* the interaction was already closed */ }
  }
  return true;
}

async function registerCardCommands(guild) {
  const definitions = [cardCommandDefinition(), viewCardContextMenu()];
  const commands = await guild.commands.fetch();
  for (const definition of definitions) {
    const json = definition.toJSON();
    const type = json.type || ApplicationCommandType.ChatInput;
    const existing = commands.find((item) => item.name === json.name && (item.type || ApplicationCommandType.ChatInput) === type);
    if (existing) await guild.commands.edit(existing, json);
    else await guild.commands.create(json);
  }
  return definitions.map((item) => item.toJSON().name);
}

module.exports = {
  NO_MENTIONS,
  HIDDEN_TEXT,
  mentionSafe,
  cardCommandDefinition,
  viewCardContextMenu,
  viewCardButton,
  isCardInteraction,
  handleCardInteraction,
  registerCardCommands,
  balancesPermitted
};
