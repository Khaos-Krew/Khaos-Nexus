'use strict';

const path = require('node:path');
const { ChannelType, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { reportCommandFailure } = require('../game-bots/command-failure.cjs');
const { isStaff, registerOpsCommands } = require('../game-bots/ops-spine.cjs');
const { resolveCategoryConfig } = require('../game-bots/category-gate.cjs');
const {
  LFG_ACTIVITIES,
  BUILD_TYPES,
  ROLE_GROUPS,
  roleGroup,
  planRoles,
  roleDiff,
  sanitizePublic,
  safeHttpLink,
  lfgTtlMs,
  createLfgEntry,
  classLabel,
  buildTypeLabel,
  lfgMessage,
  buildShareMessage,
  roleMenuPayload,
  roleInstruction,
  seasonChecklistMessage,
  toggleItem,
  seasonPostMessage,
  sanctuaryStatusText,
  helpEmbed,
  SanctuaryStore,
  resolveButtonChannel,
  buttonChannelLabel
} = require('./sanctuary-suite.cjs');

const EXPIRY = Symbol.for('khaos.nexus.sanctuary.expiry');

function choiceOptions(items) {
  return items.map((item) => ({ name: item.label, value: item.value }));
}

function classChoices() {
  return ROLE_GROUPS[0].roles.map((role) => ({ name: role.label, value: role.key }));
}

function sanctuaryCommands() {
  return [
    new SlashCommandBuilder()
      .setName('sanctuary')
      .setDescription('Sanctuary Nexus roles, groups, builds, and season notes.')
      .addSubcommand((sub) => sub.setName('help').setDescription('List Sanctuary Nexus commands. Wallet and shop stay on Nexus Sentinal.'))
      .addSubcommand((sub) => sub
        .setName('roles')
        .setDescription('Choose class, world tier, and seasonal interest roles.')
        .addBooleanOption((option) => option.setName('post').setDescription('Staff: post the role menu in the button channel.')))
      .addSubcommand((sub) => sub
        .setName('lfg')
        .setDescription('Post a helltide, boss, pit, or seasonal group.')
        .addStringOption((option) => option.setName('activity').setDescription('Group activity').setRequired(true).addChoices(...choiceOptions(LFG_ACTIVITIES)))
        .addStringOption((option) => option.setName('note').setDescription('Short note for the group').setMaxLength(200))
        .addChannelOption((option) => option.setName('voice').setDescription('Optional voice channel').addChannelTypes(ChannelType.GuildVoice)))
      .addSubcommand((sub) => sub
        .setName('build')
        .setDescription('Share a build link and tags. The link is not opened.')
        .addStringOption((option) => option.setName('link').setDescription('http(s) build link').setRequired(true).setMaxLength(300))
        .addStringOption((option) => option.setName('class').setDescription('Class tag').setRequired(true).addChoices(...classChoices()))
        .addStringOption((option) => option.setName('type').setDescription('Build type').setRequired(true).addChoices(...choiceOptions(BUILD_TYPES)))
        .addStringOption((option) => option.setName('note').setDescription('Short note').setMaxLength(200)))
      .addSubcommand((sub) => sub.setName('season').setDescription('Show your season checklist.'))
      .addSubcommand((sub) => sub
        .setName('seasonpost')
        .setDescription('Staff: post a season note with a Herald template.')
        .addStringOption((option) => option.setName('title').setDescription('Note title').setMaxLength(120))
        .addStringOption((option) => option.setName('note').setDescription('Note body').setMaxLength(500)))
      .addSubcommand((sub) => sub
        .setName('status')
        .setDescription('Staff: Discord ready, category gate, guild, and latency.')
        .addBooleanOption((option) => option.setName('reregister').setDescription('Staff: register this bot\'s commands again.')))
  ];
}

function dataFile(env = process.env) {
  const dir = String(env.NEXUS_DATA_DIR || '').trim() || path.resolve(__dirname, '../../data');
  return path.join(dir, 'sanctuary-nexus.json');
}

function ephemeral(content, extra = {}) {
  const payload = {
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
    ...extra
  };
  if (content) payload.content = String(content).slice(0, 1900);
  return payload;
}

async function registerSanctuaryCommands(guild) {
  const definitions = sanctuaryCommands();
  const commands = await guild.commands.fetch();
  for (const command of definitions) {
    const json = command.toJSON();
    const existing = commands.find((item) => item.name === json.name);
    if (existing) await guild.commands.edit(existing, json);
    else await guild.commands.create(json);
  }
  console.log(`[Sanctuary Nexus] registered ${definitions.map((item) => `/${item.name}`).join(', ')}`);
  return { registered: true };
}

function roleNamesOf(guild) {
  const cache = guild?.roles?.cache;
  const values = cache && typeof cache.values === 'function' ? [...cache.values()] : [];
  return values.map((role) => String(role?.name || ''));
}

function roleIdByName(guild, name) {
  const cache = guild?.roles?.cache;
  if (!cache) return '';
  if (typeof cache.find === 'function') {
    const found = cache.find((role) => role?.name === name);
    return found?.id ? String(found.id) : '';
  }
  const values = typeof cache.values === 'function' ? [...cache.values()] : [];
  const found = values.find((role) => role?.name === name);
  return found?.id ? String(found.id) : '';
}

function memberRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  if (Array.isArray(cache)) return cache.map(String);
  return [];
}

async function ensureRole(guild, me, name) {
  const existingId = roleIdByName(guild, name);
  if (existingId) return existingId;
  const canManage = Boolean(me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
  if (!canManage || typeof guild?.roles?.create !== 'function') return '';
  const top = Number(me?.roles?.highest?.position || 0);
  const position = top > 1 ? top - 1 : undefined;
  const created = await guild.roles.create({
    name,
    hoist: false,
    mentionable: true,
    permissions: [],
    ...(position ? { position } : {}),
    reason: 'Sanctuary Nexus self-role'
  });
  return created?.id ? String(created.id) : '';
}

async function resolvedRoleGroups(guild, me) {
  let names = roleNamesOf(guild);
  let plan = planRoles(names, me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
  if (plan.create) {
    for (const name of plan.missing) {
      try { await ensureRole(guild, me, name); } catch { /* instruction embed covers the remainder */ }
    }
    if (typeof guild?.roles?.fetch === 'function') await guild.roles.fetch().catch(() => null);
    names = roleNamesOf(guild);
    plan = planRoles(names, false);
  }
  if (!plan.ready) return { ready: false, missing: plan.missing, groups: [] };
  const groups = ROLE_GROUPS.map((group) => ({
    id: group.id,
    placeholder: group.placeholder,
    max: group.max,
    roles: group.roles.map((role) => {
      const id = roleIdByName(guild, role.name);
      return id ? { id, label: role.label } : null;
    }).filter(Boolean)
  }));
  return { ready: groups.every((group) => group.roles.length === roleGroup(group.id).roles.length), missing: plan.missing, groups };
}

function armExpiry(entry, context) {
  if (context.schedule === false || !entry?.id || entry.closed) return;
  const timers = context.timers || new Map();
  context.timers = timers;
  const previous = timers.get(entry.id);
  if (previous) clearTimeout(previous);
  const delay = Math.max(0, Number(entry.expiresAt) - Date.now());
  const timer = setTimeout(() => {
    timers.delete(entry.id);
    void expireLfg(entry.id, context);
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(entry.id, timer);
}

async function expireLfg(id, context) {
  const store = context.store;
  const entry = store?.getLfg?.(id);
  if (!entry || entry.closed) return;
  entry.closed = true;
  entry.reason = 'expired';
  store.saveLfg(entry);
  if (!entry.channelId || !entry.messageId || typeof context.client?.channels?.fetch !== 'function') return;
  const channel = await context.client.channels.fetch(entry.channelId).catch(() => null);
  const message = await channel?.messages?.fetch?.(entry.messageId).catch(() => null);
  if (message?.edit) await message.edit(lfgMessage(entry)).catch(() => {});
}

function warnButtonChannel(resolved) {
  if (resolved?.source === 'invalid') {
    console.warn(`[Sanctuary Nexus] button channel skipped: ${resolved.envName} is not a Discord channel id`);
    return;
  }
  console.warn('[Sanctuary Nexus] button channel skipped: SANCTUARY_BUTTON_CHANNEL_ID is unset; panel was not posted');
}

async function sendToButtonChannel(discord, env, payload, messageId = '') {
  const resolved = resolveButtonChannel(env);
  if (!resolved.ok) {
    warnButtonChannel(resolved);
    return { posted: false, reason: resolved.source === 'invalid' ? 'invalid' : 'unset', resolved };
  }
  const channel = typeof discord?.channels?.fetch === 'function'
    ? await discord.channels.fetch(resolved.id).catch(() => null)
    : null;
  if (!channel || typeof channel.send !== 'function') {
    console.warn(`[Sanctuary Nexus] button channel skipped: ${resolved.envName} could not be fetched`);
    return { posted: false, reason: 'missing-channel', resolved };
  }
  if (messageId && channel.messages?.fetch) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing?.edit) {
      await existing.edit(payload);
      return { posted: true, updated: true, messageId: String(existing.id || messageId), channelId: resolved.id, resolved };
    }
  }
  const sent = await channel.send(payload);
  return { posted: true, updated: false, messageId: String(sent?.id || ''), channelId: resolved.id, resolved };
}

async function syncRoleMenu(context, guild) {
  const resolved = resolveButtonChannel(context.env);
  if (!resolved.ok) {
    warnButtonChannel(resolved);
    return { posted: false, reason: resolved.source === 'invalid' ? 'invalid' : 'unset' };
  }
  let me = guild?.members?.me || null;
  if (!me && typeof guild?.members?.fetchMe === 'function') me = await guild.members.fetchMe().catch(() => null);
  const groups = await resolvedRoleGroups(guild, me);
  if (!groups.ready) {
    console.warn('[Sanctuary Nexus] role menu auto-post skipped: Sanctuary roles are not ready');
    return { posted: false, reason: 'roles-not-ready' };
  }
  const result = await sendToButtonChannel(context.client, context.env, roleMenuPayload(groups.groups), context.store?.panelId?.('roles'));
  if (result.posted) context.store?.setPanelId?.('roles', result.messageId);
  return result;
}

async function replyWith(interaction, payload, { update = false } = {}) {
  if (update && typeof interaction.update === 'function') return interaction.update(payload);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function handleSanctuaryInteraction(interaction, context = {}) {
  const command = interaction.isChatInputCommand?.() && interaction.commandName === 'sanctuary';
  const customId = String(interaction.customId || '');
  const component = customId.startsWith('sanctuary:');
  if (!command && !component) return false;
  const config = context.config || {};
  const env = context.env || process.env;
  const store = context.store;
  const guildId = String(config.discord?.guildId || env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  if (guildId && String(interaction.guildId || '') !== guildId) return true;

  if (component && customId.startsWith('sanctuary:roles:')) {
    const group = roleGroup(customId.slice('sanctuary:roles:'.length));
    if (!group) return true;
    const guild = interaction.guild;
    const groupIds = group.roles.map((role) => roleIdByName(guild, role.name)).filter(Boolean);
    const selected = (interaction.values || []).map(String).filter((id) => groupIds.includes(id));
    const diff = roleDiff(memberRoleIds(interaction.member), groupIds, selected);
    try {
      for (const id of diff.add) await interaction.member?.roles?.add?.(id);
      for (const id of diff.remove) await interaction.member?.roles?.remove?.(id);
    } catch (error) {
      await replyWith(interaction, ephemeral('Sanctuary Nexus could not change that role. Move the bot role above the Sanctuary roles and grant Manage Roles.'), { update: true });
      return true;
    }
    const me = guild?.members?.me;
    const resolved = await resolvedRoleGroups(guild, me);
    const menu = resolved.ready ? roleMenuPayload(resolved.groups) : roleInstruction(resolved.missing);
    await replyWith(interaction, { content: 'Roles updated.', ...menu }, { update: true });
    return true;
  }

  if (component && customId.startsWith('sanctuary:lfg:close:')) {
    const entry = store?.getLfg?.(customId.slice('sanctuary:lfg:close:'.length));
    if (!entry) {
      await replyWith(interaction, ephemeral('That group is no longer listed.'), { update: false });
      return true;
    }
    const host = entry.userId && entry.userId === String(interaction.user?.id || '');
    if (!host && !isStaff(interaction, config)) {
      await replyWith(interaction, ephemeral('Only the host or Sanctuary Nexus staff can close this group.'));
      return true;
    }
    entry.closed = true;
    entry.reason = 'closed';
    store.saveLfg(entry);
    const timer = context.timers?.get(entry.id);
    if (timer) clearTimeout(timer);
    await replyWith(interaction, lfgMessage(entry), { update: true });
    return true;
  }

  if (component && customId.startsWith('sanctuary:check:')) {
    const itemId = customId.slice('sanctuary:check:'.length);
    const userId = String(interaction.user?.id || '');
    const next = toggleItem(store?.checksFor?.(userId) || [], itemId);
    store?.setChecks?.(userId, next);
    await replyWith(interaction, { ...seasonChecklistMessage(next), flags: MessageFlags.Ephemeral }, { update: true });
    return true;
  }

  if (!command) return false;
  const sub = interaction.options?.getSubcommand?.(false) || '';
  if (sub === 'help' || !sub) {
    await interaction.reply(ephemeral('', helpEmbed()));
    return true;
  }
  if (!interaction.guildId) {
    await interaction.reply(ephemeral('Use Sanctuary Nexus in a server channel.'));
    return true;
  }

  if (sub === 'roles') {
    const post = Boolean(interaction.options?.getBoolean?.('post'));
    if (post && !isStaff(interaction, config)) {
      await interaction.reply(ephemeral('Posting the role menu is restricted to Sanctuary Nexus staff.'));
      return true;
    }
    const me = interaction.guild?.members?.me;
    const resolved = await resolvedRoleGroups(interaction.guild, me);
    const menu = resolved.ready ? roleMenuPayload(resolved.groups) : roleInstruction(resolved.missing);
    if (post) {
      if (!resolved.ready) {
        await interaction.reply(ephemeral('', menu));
        return true;
      }
      const published = await sendToButtonChannel(context.client || interaction.client, env, menu, store?.panelId?.('roles'));
      if (!published.posted) {
        await interaction.reply(ephemeral('Role menu was not posted. Set SANCTUARY_BUTTON_CHANNEL_ID and try again.'));
        return true;
      }
      store?.setPanelId?.('roles', published.messageId);
      await interaction.reply(ephemeral(published.updated ? 'Role menu updated in the button channel.' : 'Role menu posted in the button channel.'));
      return true;
    }
    await interaction.reply(ephemeral('', menu));
    return true;
  }

  if (sub === 'lfg') {
    const activity = interaction.options?.getString?.('activity') || '';
    const voice = interaction.options?.getChannel?.('voice');
    const entry = createLfgEntry({
      userId: interaction.user?.id,
      activity,
      note: interaction.options?.getString?.('note') || '',
      voiceId: voice?.id || '',
      channelId: interaction.channelId,
      ttlMs: lfgTtlMs(env)
    });
    if (!entry.activity) {
      await interaction.reply(ephemeral('Choose a helltide, boss, pit, or seasonal group.'));
      return true;
    }
    const published = await sendToButtonChannel(context.client || interaction.client, env, lfgMessage(entry));
    if (!published.posted) {
      await interaction.reply(ephemeral('Group was not posted. Set SANCTUARY_BUTTON_CHANNEL_ID and try again.'));
      return true;
    }
    entry.channelId = published.channelId;
    entry.messageId = published.messageId;
    store?.saveLfg?.(entry);
    armExpiry(entry, context);
    await interaction.reply(ephemeral('Group posted in the Sanctuary button channel.'));
    return true;
  }

  if (sub === 'build') {
    const link = safeHttpLink(interaction.options?.getString?.('link'));
    if (!link) {
      await interaction.reply(ephemeral('Share an http or https link. Sanctuary Nexus does not open it.'));
      return true;
    }
    await interaction.reply(buildShareMessage({
      link,
      className: classLabel(interaction.options?.getString?.('class')),
      buildType: buildTypeLabel(interaction.options?.getString?.('type')),
      note: sanitizePublic(interaction.options?.getString?.('note') || '', 200) || 'None',
      userId: String(interaction.user?.id || '').replace(/\D/g, '').slice(0, 20)
    }));
    return true;
  }

  if (sub === 'season') {
    const done = store?.checksFor?.(interaction.user?.id) || [];
    await interaction.reply(ephemeral('', seasonChecklistMessage(done)));
    return true;
  }

  if (sub === 'seasonpost') {
    if (!isStaff(interaction, config)) {
      await interaction.reply(ephemeral('Season notes are restricted to Sanctuary Nexus staff.'));
      return true;
    }
    await interaction.reply(seasonPostMessage({
      title: interaction.options?.getString?.('title') || '',
      note: interaction.options?.getString?.('note') || ''
    }));
    return true;
  }

  if (sub === 'status') {
    if (!isStaff(interaction, config)) {
      await interaction.reply(ephemeral('Status is restricted to Sanctuary Nexus staff.'));
      return true;
    }
    let registered;
    if (interaction.options?.getBoolean?.('reregister')) {
      try {
        const guild = interaction.guild || await interaction.client.guilds.fetch(interaction.guildId);
        await registerSanctuaryCommands(guild);
        await registerOpsCommands(interaction.client, 'sanctuary', env, { config });
        registered = true;
      } catch {
        registered = false;
      }
    }
    const category = resolveCategoryConfig('sanctuary', env);
    const text = sanctuaryStatusText({
      ready: Boolean(interaction.client?.isReady?.()),
      readyFlag: String(env.READY ?? '').trim(),
      category,
      guildName: interaction.guild?.name || '',
      guildConfigured: Boolean(interaction.guildId),
      ping: interaction.client?.ws?.ping,
      registered,
      buttonChannel: buttonChannelLabel(resolveButtonChannel(env))
    });
    await interaction.reply(ephemeral(text));
    return true;
  }

  await interaction.reply(ephemeral('That Sanctuary Nexus command is not available.'));
  return true;
}

function bindSanctuaryCommands(client, options = {}) {
  const config = options.config || loadConfig();
  const env = options.env || process.env;
  const store = options.store || new SanctuaryStore(dataFile(env));
  const context = { config, env, store, client, schedule: options.schedule !== false, timers: new Map() };
  client[EXPIRY] = context.timers;

  client.once(Events.ClientReady, () => {
    void (async () => {
      const guildId = String(config.discord?.guildId || env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
      if (!guildId) {
        console.warn('[Sanctuary Nexus] command registration skipped: DISCORD_GUILD_ID is missing');
        return;
      }
      const guild = await client.guilds.fetch(guildId);
      await registerSanctuaryCommands(guild);
      await syncRoleMenu(context, guild);
      for (const entry of store.state?.lfg || []) {
        if (!entry.closed) armExpiry(entry, context);
      }
    })().catch((error) => console.error(`[Sanctuary Nexus] command registration failed: ${String(error?.message || error).slice(0, 300)}`));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleSanctuaryInteraction(interaction, context).catch((error) => {
      void reportCommandFailure(interaction, error, { bot: 'sanctuary', botName: 'Sanctuary Nexus', env });
    });
  });
  return client;
}

module.exports = {
  sanctuaryCommands,
  registerSanctuaryCommands,
  bindSanctuaryCommands,
  handleSanctuaryInteraction,
  resolvedRoleGroups,
  ensureRole,
  syncRoleMenu,
  sendToButtonChannel
};
