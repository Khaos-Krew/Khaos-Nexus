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
const { cardFindAlertChannelId, cardImageEnabled, isCardAdmin, DISCORD_ID } = require('./card-config.cjs');
const { catalog, gameById, platformById, platformCatalog, suggestGames, suggestPlatforms, validatePlatform, validateTag } = require('./tag-validate.cjs');
const { suggestWhere } = require('./lookup-key.cjs');
const { assembleCardModel, balancesPermitted, buildReaders } = require('./card-model.cjs');
const { escapeUserText, renderCardEmbed } = require('./card-embed.cjs');
const { buildCardImageModel } = require('./card-image-model.cjs');
const { renderCardPng } = require('./card-image.cjs');
const {
  LOOKUP_MISS_TEXT,
  LOOKUP_OFF_TEXT,
  LOOKUP_PAD_MS,
  LOOKUP_STARTING_TEXT,
  performLookup
} = require('./lookup-service.cjs');
const { addBirthdayCommands, handleBirthdayCommand, handleBirthdayReveal, suggestBirthdayTimezone } = require('./birthday-commands.cjs');

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

function cardCommandDefinition({ findEnabled = false, birthdayEnabled = false } = {}) {
  // Discord only allows subcommands or root options, not both. `/card` and
  // `/card user:` are the `show` subcommand (user optional). Admin clear and
  // admin find cannot take a command-level Administrator default without
  // hiding the rest of /card, so Administrator is enforced at runtime.
  const command = new SlashCommandBuilder()
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
      .setDescription('Hide your card, or let members find you by a tag')
      .addBooleanOption((option) => option.setName('hidden').setDescription('Hide your card from other players').setRequired(false))
      .addBooleanOption((option) => option.setName('findable').setDescription('Let members find you by your tags').setRequired(false)));
  if (birthdayEnabled) addBirthdayCommands(command);
  if (findEnabled) {
    command.addSubcommand((sub) => sub
      .setName('find')
      .setDescription('Find a member by an exact game or platform tag')
      .addStringOption((option) => option.setName('tag').setDescription('Exact tag to find').setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName('where').setDescription('Limit the search to one game or platform').setRequired(false).setAutocomplete(true)));
  }
  command.addSubcommandGroup((group) => group
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
      .addStringOption((option) => platformOption(option, true))));
  command.addSubcommandGroup((group) => {
    group
      .setName('admin')
      .setDescription('Staff Admin player-card tools')
      .addSubcommand((sub) => sub
        .setName('clear')
        .setDescription('Remove a player tag. Only staff Admins can use this.')
        .addUserOption((option) => option.setName('user').setDescription('Player').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Why this tag is being removed').setRequired(true).setMinLength(3).setMaxLength(200))
        .addStringOption((option) => option.setName('game').setDescription('Game tag to remove').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => platformOption(option, false)));
    if (findEnabled) {
      group.addSubcommand((sub) => sub
        .setName('find')
        .setDescription('Find a tag, including hidden cards. Do not repost results.')
        .addStringOption((option) => option.setName('tag').setDescription('Tag or prefix of at least 3 characters').setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName('reason').setDescription('Why this lookup is needed. Do not repost the results.').setRequired(true).setMinLength(3).setMaxLength(200))
        .addStringOption((option) => option.setName('where').setDescription('Limit the search to one game or platform').setRequired(false).setAutocomplete(true)));
    }
    return group;
  });
  return command;
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
  if (interaction?.isButton?.() && (customId === 'card:share' || customId === 'card:tags' || customId === 'card:findable:on' || customId === 'card:bday:reveal' || customId.startsWith('card:view:'))) return true;
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

function imageEnabled(deps) {
  if (typeof deps?.imageEnabled === 'boolean') return deps.imageEnabled;
  return cardImageEnabled();
}

function avatarUrlOf(user) {
  try {
    const url = user?.displayAvatarURL?.({ size: 256, extension: 'png' });
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  } catch {
    return null;
  }
}

async function cardMessage(deps, model, user, surface) {
  const embed = renderCardEmbed(model, user, gamesOf(deps), platformCatalog());
  if (!embed) return { content: 'The player card could not be loaded.' };
  if (!imageEnabled(deps)) return { embeds: [embed] };
  try {
    const imageModel = buildCardImageModel(model, user, {
      includeBalances: surface === 'own',
      games: gamesOf(deps),
      platforms: platformCatalog()
    });
    if (!imageModel) return { embeds: [embed] };
    const render = typeof deps.renderCardPng === 'function' ? deps.renderCardPng : renderCardPng;
    const png = await render(imageModel, {
      avatarUrl: avatarUrlOf(user),
      fetch: deps.fetch,
      timeoutMs: deps.imageTimeoutMs,
      avatarTimeoutMs: deps.avatarTimeoutMs
    });
    if (!Buffer.isBuffer(png) || png.length < 8) throw new Error('empty-image');
    return { files: [{ attachment: png, name: 'player-card.png' }] };
  } catch (error) {
    console.warn(`[Player Card] image fallback: ${String(error?.message || error).slice(0, 180)}`);
    return { embeds: [embed] };
  }
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
  const payload = await cardMessage(deps, rendered.model, rendered.user, surface);
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
  await deliver(interaction, withFindablePrompt({
    content: `Saved **${escapeUserText(label)}**:\n${escapeUserText(shown)}`
  }, deps, viewerId), { ephemeral: true });
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
  await deliver(interaction, withFindablePrompt({
    content: `Saved **${escapeUserText(label)}**:\n${escapeUserText(saved.tag.tag)}`
  }, deps, viewerId), { ephemeral: true });
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

function withFindablePrompt(payload, deps, userId) {
  if (deps?.findEnabled !== true || typeof deps.store?.getUser !== 'function') return payload;
  if (deps.store.getUser(userId).findable === true) return payload;
  return {
    ...payload,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('card:findable:on')
        .setLabel('Let members find me by my tags')
        .setStyle(ButtonStyle.Secondary)
    )]
  };
}

function lookupButtonLabel(name) {
  const clean = String(name || 'Card').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `View ${clean || 'Card'}`.slice(0, 80);
}

function lookupLines(rows, { duplicate = false, staff = false } = {}) {
  const lines = [];
  if (duplicate) lines.push('More than one member uses this tag.');
  if (staff) lines.push('Do not repost these results.');
  for (const row of rows) {
    const marks = [];
    if (staff && row.hidden) marks.push('hidden card');
    if (staff && row.findable !== true) marks.push('not findable');
    const suffix = marks.length ? ` · ${marks.join(', ')}` : '';
    lines.push(`${escapeUserText(row.displayName)} (<@${row.userId}>) · ${escapeUserText(row.slotLabel)} · ${escapeUserText(row.tag)}${suffix}`);
  }
  return lines.join('\n');
}

function lookupComponents(rows) {
  const buttons = rows.slice(0, 5).map((row) => viewCardButton(row.userId).setLabel(lookupButtonLabel(row.displayName)));
  if (!buttons.length) return undefined;
  return [new ActionRowBuilder().addComponents(...buttons)];
}

function lookupContext(interaction, deps) {
  return {
    actorId: String(interaction.user.id),
    guildId: String(interaction.guildId || ''),
    member: interaction.member,
    store: deps.store,
    index: deps.index,
    limits: deps.lookupLimits,
    audit: deps.audit,
    config: deps.config || {},
    env: deps.env || process.env,
    now: clock(deps),
    findEnabled: deps.findEnabled === true,
    lookupPadMs: Number.isFinite(deps.lookupPadMs) ? deps.lookupPadMs : LOOKUP_PAD_MS,
    fetchMember: async (userId) => {
      const fetch = interaction.guild?.members?.fetch;
      if (typeof fetch !== 'function') return null;
      return fetch.call(interaction.guild.members, String(userId));
    }
  };
}

async function notifyLookupBreaker(interaction, deps) {
  const guildId = String(interaction.guildId || '');
  console.error(`[Player Card] tag lookup paused for guild ${guildId} after the hourly limit.`);
  if (typeof deps.onGuildBreaker === 'function') {
    try { await deps.onGuildBreaker({ guildId }); } catch { /* the member reply still goes out */ }
  }
  const channelId = cardFindAlertChannelId(deps.config || {}, deps.env || process.env);
  if (!DISCORD_ID.test(channelId) || typeof interaction.client?.channels?.fetch !== 'function') return;
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (channel && typeof channel.send === 'function') {
      await channel.send(mentionSafe({
        content: 'Tag lookup is paused in this server for an hour because the hourly lookup limit was reached.'
      }));
    }
  } catch { /* alerting staff is best effort */ }
}

async function auditAdminFindDenied(deps, interaction, reason) {
  if (!deps?.audit) return;
  await deps.audit.append({
    action: 'admin-find',
    actorId: String(interaction.user?.id || ''),
    guildId: String(interaction.guildId || ''),
    game: null,
    folded: null,
    reason: String(reason || 'denied').slice(0, 200) || 'denied',
    outcome: 'denied',
    hit: false,
    hitCount: 0,
    resultIds: []
  });
}

async function handleFind(interaction, deps, { staff = false } = {}) {
  if (deps.findEnabled !== true || !deps.lookupLimits || !deps.store) {
    await deliver(interaction, { content: LOOKUP_OFF_TEXT }, { ephemeral: true });
    return;
  }
  if (staff) {
    const reason = String(interaction.options.getString('reason') || '').trim();
    if (!isCardAdmin(interaction, deps.config || {})) {
      await auditAdminFindDenied(deps, interaction, reason);
      await deliver(interaction, { content: 'Only staff Admins can use this. Ask an Admin if you need it.' }, { ephemeral: true });
      return;
    }
    if (reason.length < 3 || reason.length > 200) {
      await auditAdminFindDenied(deps, interaction, reason);
      await deliver(interaction, { content: 'A reason of 3 to 200 characters is required.' }, { ephemeral: true });
      return;
    }
  }
  const result = await performLookup({
    ...lookupContext(interaction, deps),
    query: interaction.options.getString('tag'),
    where: interaction.options.getString('where'),
    staff,
    staffReason: staff ? String(interaction.options.getString('reason') || '').trim() : ''
  });
  if (result.alert) await notifyLookupBreaker(interaction, deps);
  if (result.kind === 'disabled') {
    await deliver(interaction, { content: LOOKUP_OFF_TEXT }, { ephemeral: true });
    return;
  }
  if (result.kind === 'starting') {
    await deliver(interaction, { content: LOOKUP_STARTING_TEXT }, { ephemeral: true });
    return;
  }
  if (result.kind === 'staff-short') {
    await deliver(interaction, { content: result.text }, { ephemeral: true });
    return;
  }
  if (result.kind === 'hit') {
    const payload = { content: lookupLines(result.rows, { duplicate: result.duplicate === true, staff }) };
    if (!staff) payload.components = lookupComponents(result.rows);
    await deliver(interaction, payload, { ephemeral: true });
    return;
  }
  await deliver(interaction, { content: result.text || LOOKUP_MISS_TEXT }, { ephemeral: true });
}

async function handleFindableButton(interaction, deps) {
  const userId = String(interaction.user.id);
  const before = deps.store.getUser(userId).findable === true;
  if (!before) {
    await deps.store.setFindable(userId, true);
    if (deps.audit) {
      await deps.audit.append({
        actorId: userId,
        targetId: userId,
        game: null,
        action: 'privacy',
        oldTag: null,
        newTag: null,
        reason: 'findable'
      });
    }
  }
  await deliver(interaction, {
    content: before ? 'Members can already find you by your tags.' : 'Members can now find you by your tags.'
  }, { ephemeral: true });
}

async function handlePrivacy(interaction, deps) {
  const hidden = interaction.options.getBoolean('hidden');
  const findable = interaction.options.getBoolean('findable');
  const userId = String(interaction.user.id);
  const messages = [];
  if (typeof hidden === 'boolean') {
    await deps.store.setHidden(userId, hidden);
    if (deps.audit) {
      await deps.audit.append({
        actorId: userId,
        targetId: userId,
        game: null,
        action: 'privacy',
        oldTag: null,
        newTag: null,
        reason: hidden ? 'hidden' : 'visible'
      });
    }
    messages.push(hidden ? 'Your card is now hidden from other players.' : 'Your card is visible to other players again.');
  }
  if (typeof findable === 'boolean') {
    const before = deps.store.getUser(userId).findable === true;
    if (before !== findable) {
      await deps.store.setFindable(userId, findable);
      if (deps.audit) {
        await deps.audit.append({
          actorId: userId,
          targetId: userId,
          game: null,
          action: 'privacy',
          oldTag: null,
          newTag: null,
          reason: findable ? 'findable' : 'not-findable'
        });
      }
    }
    messages.push(findable ? 'Members can find you by your tags.' : 'Members cannot find you by your tags.');
  }
  await deliver(interaction, {
    content: messages.length
      ? messages.join('\n')
      : 'Choose whether your card is hidden, and whether members can find you by your tags.'
  }, { ephemeral: true });
}

async function handleAdminClear(interaction, deps) {
  if (!isCardAdmin(interaction, deps.config || {})) {
    await deliver(interaction, { content: 'Only staff Admins can use this. Ask an Admin if you need it.' }, { ephemeral: true });
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
    const payload = await cardMessage(deps, rendered.model, rendered.user, 'share');
    await interaction.channel.send(mentionSafe(payload));
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
  if (name === 'timezone') {
    await interaction.respond(suggestBirthdayTimezone(value));
    return;
  }
  if (name === 'where') {
    await interaction.respond(suggestWhere(value, gamesOf(deps), platformCatalog()));
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
  if (interaction.isButton?.() && interaction.customId === 'card:findable:on') {
    await handleFindableButton(interaction, deps);
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
  if (interaction.isButton?.() && interaction.customId === 'card:bday:reveal') {
    await handleBirthdayReveal(interaction, deps);
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
  if (group === 'admin' && sub === 'find') {
    await handleFind(interaction, deps, { staff: true });
    return;
  }
  if (sub === 'find') {
    await handleFind(interaction, deps, { staff: false });
    return;
  }
  if (group === 'birthday') return handleBirthdayCommand(interaction, deps);
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

async function registerCardCommands(guild, { findEnabled = false, birthdayEnabled = false } = {}) {
  const definitions = [cardCommandDefinition({ findEnabled: findEnabled === true, birthdayEnabled: birthdayEnabled === true }), viewCardContextMenu()];
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
