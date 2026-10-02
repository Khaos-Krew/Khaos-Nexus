'use strict';

const {
  ActionRowBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { loadConfig } = require('../shared/config.cjs');
const { categoryIdForInteraction } = require('../game-bots/category-gate.cjs');
const { errorClass } = require('../game-bots/command-failure.cjs');
const { snowflake, upsertEmbed } = require('../game-bots/panel-message.cjs');
const { craftIsStaff, decideCategory, readCraftCategory, realmDecisionAllowed } = require('./access.cjs');
const { buildRealmEmbed, buildStatusPayload, COLORS, MOTTO } = require('./embeds.cjs');
const { craftHelpText } = require('./help.cjs');
const { redactSecret } = require('./protocol.cjs');
const { minecraftCommand, pingBedrock, pingJava, probeServerStatus, runRcon } = require('./query.cjs');
const { openCraftStore } = require('./store.cjs');
const { handleMcPointsCommand, installMcEconomyLoops } = require('./mc-points-commands.cjs');

const STATUS_IDENTITY = Object.freeze({
  titles: Object.freeze([
    'Nexus Craft server status',
    'Nexus Craft • Java',
    'Nexus Craft • Bedrock',
    'Nexus Craft • Geyser'
  ]),
  footerPrefixes: Object.freeze(['Nexus Craft • status', `${MOTTO} • status`])
});
const LOOP = Symbol.for('khaos.nexus.craft.statusLoop');

function ephemeral(content) {
  return {
    content: String(content || '').slice(0, 1900),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function publicText(value, max) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/@/g, '@\u200b')
    .replace(/```/g, "'''")
    .trim()
    .slice(0, max);
}

function safeLink(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function guildIdOf(env) {
  return String(env.DISCORD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || '').trim();
}

function optionString(interaction, name) {
  return interaction.options?.getString?.(name) ?? '';
}

function optionInteger(interaction, name) {
  const value = interaction.options?.getInteger?.(name);
  return Number.isInteger(value) ? value : null;
}

function serverNameOf(interaction) {
  return optionString(interaction, 'server') || 'default';
}

function mcAdminCommand() {
  return new SlashCommandBuilder()
    .setName('mcadmin')
    .setDescription('Staff: Minecraft orders, links, and kits.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) => sub
      .setName('orders')
      .setDescription('List queued Minecraft orders.')
      .addStringOption((option) => option.setName('user').setDescription('Discord user id.').setMaxLength(32)))
    .addSubcommand((sub) => sub
      .setName('resolve')
      .setDescription('Open Sentinal to deliver, refund, or resend an order.')
      .addStringOption((option) => option.setName('order').setDescription('Order id.').setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName('action').setDescription('What to do.').setRequired(true).addChoices(
        { name: 'Delivered', value: 'delivered' },
        { name: 'Refund', value: 'refund' },
        { name: 'Resend failed', value: 'resend' }
      )))
    .addSubcommand((sub) => sub
      .setName('link-revoke')
      .setDescription('Revoke a Minecraft link.')
      .addStringOption((option) => option.setName('user').setDescription('Discord user id.').setRequired(true).setMaxLength(32)))
    .addSubcommand((sub) => sub.setName('kits').setDescription('List Starter Kit claims.'));
}

function craftCommands(env = process.env) {
  const server = (sub) => sub.addStringOption((option) => option
    .setName('server')
    .setDescription('Saved server name. Blank uses default.')
    .setMaxLength(32)
    .setRequired(false));
  const flags = mcPointsFlags(env);
  const mc = new SlashCommandBuilder()
      .setName('mc')
      .setDescription('Minecraft status and staff RCON controls.')
      .setDMPermission(false)
      .addSubcommand((sub) => sub
        .setName('status')
        .setDescription('Java server-list ping and optional Bedrock RakNet ping. No RCON.')
        .addStringOption((option) => option.setName('host').setDescription('Server hostname or IP.').setRequired(true).setMaxLength(255))
        .addStringOption((option) => option.setName('edition').setDescription('Which ping to run.').addChoices(
          { name: 'Java', value: 'java' },
          { name: 'Bedrock', value: 'bedrock' },
          { name: 'Java and Bedrock', value: 'both' }
        ))
        .addIntegerOption((option) => option.setName('port').setDescription('Java port. Default 25565.').setMinValue(1).setMaxValue(65535))
        .addIntegerOption((option) => option.setName('bedrock_port').setDescription('Bedrock port. Default 19132.').setMinValue(1).setMaxValue(65535)))
      .addSubcommand((sub) => sub
        .setName('panel')
        .setDescription('Staff: post or take over the durable status embed in this channel.')
        .addStringOption((option) => option.setName('host').setDescription('Public join hostname or IP.').setRequired(true).setMaxLength(255))
        .addStringOption((option) => option.setName('type').setDescription('Java, Bedrock, or a Java server with Geyser.').addChoices(
          { name: 'Java', value: 'java' },
          { name: 'Bedrock', value: 'bedrock' },
          { name: 'Geyser', value: 'geyser' }
        ))
        .addIntegerOption((option) => option.setName('port').setDescription('Java join port. Default 25565.').setMinValue(1).setMaxValue(65535))
        .addIntegerOption((option) => option.setName('bedrock_port').setDescription('Bedrock join port. Default 19132.').setMinValue(1).setMaxValue(65535)))
      .addSubcommand((sub) => server(sub.setName('players').setDescription('Staff: list players over Java RCON.')))
      .addSubcommand((sub) => server(sub
        .setName('say')
        .setDescription('Staff: broadcast a chat line over Java RCON.')
        .addStringOption((option) => option.setName('message').setDescription('Text to say.').setRequired(true).setMaxLength(200))))
      .addSubcommandGroup((group) => group
        .setName('whitelist')
        .setDescription('Staff: Java whitelist over RCON.')
        .addSubcommand((sub) => server(sub
          .setName('add')
          .setDescription('Add a player to the whitelist.')
          .addStringOption((option) => option.setName('name').setDescription('Player name.').setRequired(true).setMaxLength(32))))
        .addSubcommand((sub) => server(sub
          .setName('remove')
          .setDescription('Remove a player from the whitelist.')
          .addStringOption((option) => option.setName('name').setDescription('Player name.').setRequired(true).setMaxLength(32))))
        .addSubcommand((sub) => server(sub.setName('list').setDescription('List the whitelist.'))))
      .addSubcommand((sub) => server(sub
        .setName('kick')
        .setDescription('Staff: kick a player over Java RCON.')
        .addStringOption((option) => option.setName('name').setDescription('Player name.').setRequired(true).setMaxLength(32))
        .addStringOption((option) => option.setName('reason').setDescription('Optional kick reason.').setMaxLength(100))))
      .addSubcommand((sub) => server(sub
        .setName('cmd')
        .setDescription('Staff: send one raw Java RCON command.')
        .addStringOption((option) => option.setName('command').setDescription('Exact server command, one line.').setRequired(true).setMaxLength(1000))));
  if (flags.pointsEnabled) {
    mc.addSubcommandGroup((group) => group
      .setName('link')
      .setDescription('Link this Discord account to your Minecraft Java account.')
      .addSubcommand((sub) => sub
        .setName('start')
        .setDescription('Whisper a link code to your online Minecraft player.')
        .addStringOption((option) => option.setName('username').setDescription('Your in-game name.').setRequired(true).setMaxLength(16)))
      .addSubcommand((sub) => sub
        .setName('confirm')
        .setDescription('Confirm the whispered in-game link code.')
        .addStringOption((option) => option.setName('code').setDescription('Code from the in-game whisper.').setRequired(true).setMaxLength(16)))
      .addSubcommand((sub) => sub.setName('status').setDescription('Show your Minecraft link.')))
      .addSubcommand((sub) => sub.setName('unlink').setDescription('Unlink Minecraft. You can link again after 30 days.'));
  }
  if (flags.shopEnabled) {
    mc.addSubcommand((sub) => sub.setName('shop').setDescription('Where to spend Nexus Points on Minecraft items.'));
  }
  if (flags.starterKitEnabled) {
    mc.addSubcommand((sub) => sub.setName('starter').setDescription('How to claim the free one-time Starter Kit.'));
  }
  const commands = [
    new SlashCommandBuilder()
      .setName('craft')
      .setDescription('Nexus Craft help and edition support.')
      .setDMPermission(false)
      .addSubcommand((sub) => sub.setName('help').setDescription('Commands, setup, and which editions support RCON.')),
    new SlashCommandBuilder()
      .setName('mcrcon')
      .setDescription('Staff: save Minecraft Java RCON in the Discord store.')
      .setDMPermission(false)
      .addSubcommand((sub) => server(sub
        .setName('setup')
        .setDescription('Staff: save host, port, and password. The reply does not repeat the password.')
        .addStringOption((option) => option.setName('host').setDescription('RCON hostname or IP.').setRequired(true).setMaxLength(255))
        .addIntegerOption((option) => option.setName('port').setDescription('RCON port.').setRequired(true).setMinValue(1).setMaxValue(65535))
        .addStringOption((option) => option.setName('password').setDescription('RCON password. Stored encrypted and never echoed.').setRequired(true).setMaxLength(256))))
      .addSubcommand((sub) => server(sub.setName('status').setDescription('Staff: show saved RCON without the password.')))
      .addSubcommand((sub) => server(sub
        .setName('clear')
        .setDescription('Staff: delete one saved RCON server.')
        .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm the delete.').setRequired(true)))),
    mc
  ];
  if (flags.pointsEnabled || flags.shopEnabled || flags.starterKitEnabled || flags.shopDeliveryEnabled) {
    commands.push(mcAdminCommand());
  }
  commands.push(new SlashCommandBuilder()
      .setName('realm')
      .setDescription('Discord listing board for Minecraft Realms.')
      .setDMPermission(false)
      .addSubcommand((sub) => sub
        .setName('post')
        .setDescription('Post your Realm. Apply messages the owner in private.')
        .addStringOption((option) => option.setName('name').setDescription('Realm name.').setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName('edition').setDescription('Java or Bedrock.').setRequired(true).addChoices(
          { name: 'Java', value: 'java' },
          { name: 'Bedrock', value: 'bedrock' }
        ))
        .addStringOption((option) => option.setName('description').setDescription('Description or rules.').setRequired(true).setMaxLength(1000))
        .addIntegerOption((option) => option.setName('slots').setDescription('Open slots.').setRequired(true).setMinValue(0).setMaxValue(50))
        .addStringOption((option) => option.setName('image').setDescription('Optional http(s) image URL.').setMaxLength(300)))
      .addSubcommand((sub) => sub
        .setName('edit')
        .setDescription('Edit your own Realm listing.')
        .addStringOption((option) => option.setName('listing').setDescription('Listing id from the embed footer.').setRequired(true).setMaxLength(16))
        .addStringOption((option) => option.setName('name').setDescription('Realm name.').setMaxLength(80))
        .addStringOption((option) => option.setName('edition').setDescription('Java or Bedrock.').addChoices(
          { name: 'Java', value: 'java' },
          { name: 'Bedrock', value: 'bedrock' }
        ))
        .addStringOption((option) => option.setName('description').setDescription('Description or rules.').setMaxLength(1000))
        .addIntegerOption((option) => option.setName('slots').setDescription('Open slots.').setMinValue(0).setMaxValue(50))
        .addStringOption((option) => option.setName('image').setDescription('Optional http(s) image URL. Use - to clear.').setMaxLength(300)))
      .addSubcommand((sub) => sub
        .setName('close')
        .setDescription('Close your own Realm listing.')
        .addStringOption((option) => option.setName('listing').setDescription('Listing id from the embed footer.').setRequired(true).setMaxLength(16)))
      .addSubcommand((sub) => sub
        .setName('channel')
        .setDescription('Staff: save this channel as the Realms board when the env var is unset.')
        .addChannelOption((option) => option.setName('channel').setDescription('Board channel. Blank uses this channel.').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))));
  return commands;
}

function statusLines(label, host, port, result, error) {
  const lines = [`**${label}** \`${host}:${port}\``];
  if (error) {
    lines.push(String(error.message || error));
    return lines;
  }
  lines.push(`MOTD: ${result.motd || '—'}`);
  lines.push(`Version: ${result.version || '—'}`);
  lines.push(`Players: ${result.online}/${result.max}`);
  return lines;
}

async function queryStatus({ host, edition = 'java', javaPort = 25565, bedrockPort = 19132 } = {}) {
  const lines = [];
  const wantJava = edition !== 'bedrock';
  const wantBedrock = edition === 'bedrock' || edition === 'both';
  const jobs = [];
  if (wantJava) {
    jobs.push(pingJava(host, javaPort).then((result) => statusLines('Java', host, javaPort, result)).catch((error) => statusLines('Java', host, javaPort, null, error)));
  }
  if (wantBedrock) {
    jobs.push(pingBedrock(host, bedrockPort).then((result) => statusLines('Bedrock', host, bedrockPort, result)).catch((error) => statusLines('Bedrock', host, bedrockPort, null, error)));
  }
  const parts = await Promise.all(jobs);
  for (const part of parts) lines.push(...part, '');
  if (wantBedrock) lines.push('Bedrock players can join a Java server through Geyser. RCON still controls that Java server.');
  return lines.join('\n').trim().slice(0, 1800);
}

function listingPayload(listing) {
  return buildRealmEmbed(listing);
}

function panelKind(type, javaPort, bedrockPort) {
  if (type === 'java' || type === 'bedrock' || type === 'geyser') return type;
  if (bedrockPort && !javaPort) return 'bedrock';
  if (bedrockPort && javaPort) return 'geyser';
  return 'java';
}

function decisionPayload(listing, application, status = 'pending') {
  const titles = { pending: 'Realm application', approved: 'Realm application — Approved', denied: 'Realm application — Denied' };
  const colors = { pending: COLORS.gunmetal, approved: COLORS.fieryRed, denied: COLORS.black };
  const decided = status !== 'pending';
  return {
    embeds: [{
      title: titles[status] || titles.pending,
      color: colors[status] || colors.pending,
      description: status === 'approved'
        ? 'Approved. The owner still adds this player inside Minecraft.'
        : status === 'denied' ? 'Denied. No game invite was sent.' : 'Approve or deny this application.',
      fields: [
        { name: 'Realm', value: publicText(listing.name, 80) || '—', inline: true },
        { name: 'Edition', value: listing.edition === 'bedrock' ? 'Bedrock' : 'Java', inline: true },
        { name: 'Gamertag', value: publicText(application.gamertag, 32) || '—', inline: false },
        { name: 'Note', value: publicText(application.note, 200) || '—', inline: false },
        { name: 'Applicant', value: `<@${application.applicantId}>`, inline: false }
      ],
      footer: { text: `${MOTTO} • realm-app:${application.id}` }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `craft:realm:approve:${application.id}`, disabled: decided },
        { type: 2, style: 4, label: 'Deny', custom_id: `craft:realm:deny:${application.id}`, disabled: decided }
      ]
    }],
    allowedMentions: { parse: [] }
  };
}

function applyModal(listingId) {
  return new ModalBuilder()
    .setCustomId(`craft:realm:submit:${listingId}`)
    .setTitle('Apply to this Realm')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('gamertag').setLabel('Gamertag').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Note').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200)
      )
    );
}

function modalValue(fields, key) {
  if (!fields) return '';
  if (typeof fields.getTextInputValue === 'function') {
    try { return fields.getTextInputValue(key); } catch { return ''; }
  }
  return '';
}

function cleanGamertag(value) {
  const text = String(value || '').replace(/[\r\n\u0000]/g, '').trim();
  if (!text || text.length > 32 || /[@#<>]/.test(text)) return '';
  return text;
}

function passwordLabel(value) {
  if (value === 'missing' || value === 'unreadable') return value;
  return 'configured';
}

function rconStatusText(entries) {
  if (!entries.length) return 'No Minecraft RCON servers are saved. Staff use `/mcrcon setup`. Host, port, and password are not read from Railway.';
  const lines = ['**Minecraft RCON**', 'Source: Discord store. Railway env is not a connection source.', ''];
  for (const entry of entries) {
    lines.push(`\`${entry.name}\` host ${entry.host ? `\`${entry.host}\`` : 'missing'} port ${entry.port || 'missing'} password **${passwordLabel(entry.password)}**`);
  }
  return lines.join('\n').slice(0, 1900);
}

function requireStaff(interaction, config) {
  if (craftIsStaff(interaction, config)) return true;
  return false;
}

async function replyStaff(interaction) {
  if (interaction.deferred || interaction.replied) await interaction.followUp(ephemeral('Only Nexus staff can use that command.'));
  else await interaction.reply(ephemeral('Only Nexus staff can use that command.'));
}

function boardChannel(store, env) {
  const raw = env.NEXUS_CRAFT_REALMS_CHANNEL_ID;
  if (raw !== undefined && String(raw).trim() !== '') {
    const id = String(raw).trim();
    if (!/^\d{17,20}$/.test(id)) return { id: '', source: 'invalid' };
    return { id, source: 'env' };
  }
  const saved = store.boardChannelId();
  if (saved) return { id: saved, source: 'discord' };
  return { id: '', source: 'unset' };
}

async function refreshListingMessage(client, listing) {
  if (!listing.channelId || typeof client?.channels?.fetch !== 'function') return listing;
  const channel = await client.channels.fetch(listing.channelId).catch(() => null);
  const existing = listing.messageId && channel?.messages?.fetch
    ? await channel.messages.fetch(listing.messageId).catch(() => null)
    : null;
  if (existing?.edit) {
    await existing.edit(listingPayload(listing));
    return listing;
  }
  if (!channel || typeof channel.send !== 'function') return listing;
  const sent = await channel.send(listingPayload(listing));
  return { ...listing, messageId: snowflake(sent.id), channelId: snowflake(channel.id) };
}

async function ensureRcon(store, name) {
  const server = store.getServer(name);
  if (!server?.host || !server.port || !server.password) {
    const label = server?.passwordUnreadable ? 'unreadable' : 'not configured';
    throw new Error(`RCON for \`${name}\` is ${label}. Staff use \`/mcrcon setup\`. Host, port, and password are not read from Railway.`);
  }
  return server;
}

async function runStaffRcon(interaction, context, kind, args, serverName = '') {
  if (!requireStaff(interaction, context.config)) {
    await replyStaff(interaction);
    return;
  }
  const name = serverName || serverNameOf(interaction);
  const command = minecraftCommand(kind, args);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const server = await ensureRcon(context.store, name);
  const response = redactSecret(await runRcon(server, command), [server.password]);
  const body = response ? `\`\`\`text\n${String(response).replace(/```/g, "'''").slice(0, 1400)}\n\`\`\`` : 'The server returned an empty response.';
  const shown = redactSecret(command.split(' ')[0], [server.password]);
  await interaction.editReply({ content: `**${name}** \`${shown}\`\n${body}`.slice(0, 1900), allowedMentions: { parse: [] } });
}

function rconForbidden(store, name) {
  const forbidden = [];
  try {
    const server = store.getServer(name || 'default');
    if (server?.host) forbidden.push(server.host);
    if (server?.password) forbidden.push(server.password);
    if (server?.port) forbidden.push(String(server.port));
  } catch {}
  return forbidden;
}

function rconReady(store, name) {
  try {
    return store.publicStatus(name || 'default').password === 'configured';
  } catch {
    return false;
  }
}

async function publishStatusPanel(client, store, panel) {
  const kind = panel.kind === 'bedrock' || panel.kind === 'geyser' || panel.kind === 'java'
    ? panel.kind
    : 'geyser';
  const snapshot = await probeServerStatus({
    host: panel.host,
    kind,
    javaPort: panel.javaPort || 25565,
    bedrockPort: panel.bedrockPort || 19132
  });
  const rconName = panel.rconName || 'default';
  const body = buildStatusPayload({
    ...snapshot,
    kind,
    includeStaffActions: kind === 'java' && rconReady(store, rconName),
    rconName,
    forbidden: rconForbidden(store, rconName)
  });
  const result = await upsertEmbed(client, panel.channelId, panel.messageId, body, {
    identity: STATUS_IDENTITY,
    botId: client?.user?.id,
    banner: false
  });
  if (result?.messageId && result.messageId !== panel.messageId) {
    store.setStatusPanel({ ...panel, messageId: result.messageId });
  }
  return result;
}

function startStatusLoop(client, store, env) {
  if (client[LOOP]) return;
  const seconds = Number(env.NEXUS_CRAFT_STATUS_REFRESH_SECONDS || 120);
  const delay = Math.max(30, Math.min(900, Number.isFinite(seconds) ? seconds : 120)) * 1000;
  const timer = setInterval(() => {
    const panel = store.getStatusPanel();
    if (!panel?.channelId || !panel.host) return;
    void publishStatusPanel(client, store, panel).catch((error) => {
      console.warn(`[Nexus Craft] status panel class=${errorClass(error)}`);
    });
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  client[LOOP] = timer;
}

async function notifyOwner(client, listing, application) {
  const payload = decisionPayload(listing, application, 'pending');
  const body = {
    embeds: payload.embeds,
    components: payload.components,
    allowedMentions: { parse: [] }
  };
  try {
    const user = await client.users.fetch(listing.ownerId);
    await user.send(body);
    return 'dm';
  } catch (error) {
    console.warn(`[Nexus Craft] realm owner dm class=${errorClass(error)}`);
  }
  return 'unsent';
}

async function notifyApplicant(client, interaction, application, listing, status) {
  const next = status === 'approved'
    ? `You were approved for **${publicText(listing.name, 80)}** (${listing.edition === 'bedrock' ? 'Bedrock' : 'Java'}). The Realm owner still adds you inside Minecraft. Nexus Craft cannot add you to a Realm.`
    : `Your application to **${publicText(listing.name, 80)}** was declined.`;
  let delivered = false;
  try {
    const user = await client.users.fetch(application.applicantId);
    await user.send({ content: next, allowedMentions: { parse: [] } });
    delivered = true;
  } catch (error) {
    console.warn(`[Nexus Craft] applicant dm class=${errorClass(error)}`);
  }
  const channel = interaction.channel;
  if (channel && typeof channel.isThread === 'function' && channel.isThread() && typeof channel.send === 'function') {
    try {
      await channel.send({ content: `<@${application.applicantId}>\n${next}`, allowedMentions: { parse: [], users: [application.applicantId] } });
      delivered = true;
    } catch (error) {
      console.warn(`[Nexus Craft] applicant thread class=${errorClass(error)}`);
    }
  }
  return delivered;
}

async function handleRealmDecision(interaction, context, action, applicationId) {
  const application = context.store.getApplication(applicationId);
  const listing = application ? context.store.getListing(application.listingId) : null;
  const staff = craftIsStaff(interaction, context.config);
  if (!application || !listing || !realmDecisionAllowed({
    actorId: interaction.user?.id,
    listingOwnerId: listing?.ownerId,
    staff
  })) {
    await interaction.reply(ephemeral('Only the Realm owner or Nexus staff can approve or deny this application.'));
    return;
  }
  if (application.status !== 'pending') {
    await interaction.reply(ephemeral('This application is already decided.'));
    return;
  }
  const status = action === 'approve' ? 'approved' : 'denied';
  context.store.setApplicationStatus(application.id, status);
  const payload = decisionPayload(listing, application, status);
  if (typeof interaction.update === 'function') await interaction.update(payload);
  else await interaction.reply(payload);
  const client = context.client || interaction.client;
  const delivered = await notifyApplicant(client, interaction, application, listing, status);
  const note = status === 'approved'
    ? 'Approved. The owner still adds them inside Minecraft.'
    : 'Denied.';
  if (typeof interaction.followUp === 'function') {
    await interaction.followUp(ephemeral(delivered ? note : `${note} I could not message the applicant.`));
  }
}

async function handleCraftInteraction(interaction, context) {
  const env = context.env || process.env;
  const store = context.store;
  const config = context.config || {};
  const customId = String(interaction.customId || '');
  const decisionButton = /^craft:realm:(approve|deny):([a-f0-9]{12})$/.exec(customId);
  if (!decisionButton) {
    const categoryId = await categoryIdForInteraction(interaction);
    const gate = decideCategory(env, categoryId);
    if (!gate.allow) {
      if (!interaction.replied && !interaction.deferred) await interaction.reply(ephemeral(gate.message));
      return;
    }
  }

  if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
    const name = String(interaction.commandName || '');
    const sub = interaction.options?.getSubcommand?.(false) || '';
    const group = interaction.options?.getSubcommandGroup?.(false) || '';
    if (name === 'craft' && sub === 'help') {
      await interaction.reply(ephemeral(craftHelpText(env)));
      return;
    }
    if (name === 'mcrcon') {
      if (!requireStaff(interaction, config)) return replyStaff(interaction);
      const server = serverNameOf(interaction);
      if (sub === 'setup') {
        const saved = store.saveServer({
          name: server,
          host: optionString(interaction, 'host'),
          port: optionInteger(interaction, 'port'),
          password: optionString(interaction, 'password'),
          actorId: interaction.user?.id
        });
        console.log(`[Nexus Craft] RCON saved server=${saved.name} password=${passwordLabel(saved.password)}`);
        await interaction.reply(ephemeral([
          `Saved RCON for \`${saved.name}\`.`,
          `Host: \`${saved.host}\``,
          `Port: \`${saved.port}\``,
          `Password: **${passwordLabel(saved.password)}**.`,
          'Railway env is not used for this connection.'
        ].join('\n')));
        return;
      }
      if (sub === 'status') {
        const named = optionString(interaction, 'server');
        const entries = named ? [store.publicStatus(named)] : store.listPublicStatus();
        await interaction.reply(ephemeral(rconStatusText(entries)));
        return;
      }
      if (sub === 'clear') {
        if (interaction.options?.getBoolean?.('confirm') !== true) {
          await interaction.reply(ephemeral('Clear cancelled. Nothing was deleted.'));
          return;
        }
        const existed = store.clearServer(server);
        await interaction.reply(ephemeral(existed ? `Cleared RCON for \`${server}\`. The password was discarded.` : `No saved RCON named \`${server}\`.`));
        return;
      }
    }
    if (name === 'mcadmin') {
      await handleMcPointsCommand(interaction, {
        ...context,
        isStaff: requireStaff(interaction, config),
        ephemeral,
        ephemeralFlags: MessageFlags.Ephemeral
      });
      return;
    }
    if (name === 'mc') {
      if (sub === 'status') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const edition = optionString(interaction, 'edition') || 'java';
        const kind = edition === 'bedrock' ? 'bedrock' : edition === 'both' ? 'geyser' : 'java';
        const snapshot = await probeServerStatus({
          host: optionString(interaction, 'host'),
          kind,
          javaPort: optionInteger(interaction, 'port') || 25565,
          bedrockPort: optionInteger(interaction, 'bedrock_port') || 19132
        });
        await interaction.editReply(buildStatusPayload({ ...snapshot, kind, includeStaffActions: false }));
        return;
      }
      if (sub === 'panel') {
        if (!requireStaff(interaction, config)) return replyStaff(interaction);
        const channelId = snowflake(interaction.channelId);
        if (!channelId) {
          await interaction.reply(ephemeral('Post the status panel from a channel inside the Craft category.'));
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const javaPort = optionInteger(interaction, 'port');
        const bedrockPort = optionInteger(interaction, 'bedrock_port');
        const panel = store.setStatusPanel({
          channelId,
          messageId: store.getStatusPanel()?.messageId || '',
          host: optionString(interaction, 'host'),
          javaPort: javaPort || 25565,
          bedrockPort: bedrockPort || 19132,
          kind: panelKind(optionString(interaction, 'type'), javaPort, bedrockPort),
          rconName: serverNameOf(interaction)
        });
        const client = context.client || interaction.client;
        const result = await publishStatusPanel(client, store, panel);
        startStatusLoop(client, store, env);
        await interaction.editReply({
          content: result?.messageId ? 'Updated the Nexus Craft status panel. Later restarts edit that same message.' : 'The status panel could not be posted in this channel.',
          allowedMentions: { parse: [] }
        });
        return;
      }
      if (sub === 'players') return runStaffRcon(interaction, context, 'list', {});
      if (sub === 'say') return runStaffRcon(interaction, context, 'say', { message: optionString(interaction, 'message') });
      if (sub === 'kick') return runStaffRcon(interaction, context, 'kick', { name: optionString(interaction, 'name'), reason: optionString(interaction, 'reason') });
      if (sub === 'cmd') return runStaffRcon(interaction, context, 'raw', { command: optionString(interaction, 'command') });
      if (group === 'whitelist' && sub === 'add') return runStaffRcon(interaction, context, 'whitelist-add', { name: optionString(interaction, 'name') });
      if (group === 'whitelist' && sub === 'remove') return runStaffRcon(interaction, context, 'whitelist-remove', { name: optionString(interaction, 'name') });
      if (group === 'whitelist' && sub === 'list') return runStaffRcon(interaction, context, 'whitelist-list', {});
      const mcPoints = await handleMcPointsCommand(interaction, {
        ...context,
        isStaff: requireStaff(interaction, config),
        ephemeral,
        ephemeralFlags: MessageFlags.Ephemeral
      });
      if (mcPoints) return;
    }
    if (name === 'realm') {
      if (sub === 'channel') {
        if (!requireStaff(interaction, config)) return replyStaff(interaction);
        if (boardChannel(store, env).source === 'env' || boardChannel(store, env).source === 'invalid') {
          await interaction.reply(ephemeral('The Realms board channel is set by NEXUS_CRAFT_REALMS_CHANNEL_ID.'));
          return;
        }
        const selected = interaction.options?.getChannel?.('channel');
        const id = snowflake(selected?.id || interaction.channelId);
        store.setBoardChannel(id);
        await interaction.reply(ephemeral(`Realms board channel saved: <#${id}>.`));
        return;
      }
      if (sub === 'post' || sub === 'edit' || sub === 'close') {
        const actorId = snowflake(interaction.user?.id);
        if (sub === 'post') {
          const target = boardChannel(store, env);
          if (!target.id) {
            await interaction.reply(ephemeral(target.source === 'invalid'
              ? 'NEXUS_CRAFT_REALMS_CHANNEL_ID is not a Discord channel id.'
              : 'The Realms board is not configured. Set NEXUS_CRAFT_REALMS_CHANNEL_ID or have staff run `/realm channel`.'));
            return;
          }
          const image = safeLink(optionString(interaction, 'image'));
          if (optionString(interaction, 'image') && !image) {
            await interaction.reply(ephemeral('The image must be an http or https URL without a password.'));
            return;
          }
          const client = context.client || interaction.client;
          const channel = await client.channels.fetch(target.id);
          if (!channel || typeof channel.send !== 'function') {
            await interaction.reply(ephemeral('The Realms board channel could not be posted in.'));
            return;
          }
          const draft = {
            ownerId: actorId,
            name: publicText(optionString(interaction, 'name'), 80),
            edition: optionString(interaction, 'edition') === 'bedrock' ? 'bedrock' : 'java',
            description: publicText(optionString(interaction, 'description'), 1000),
            slots: optionInteger(interaction, 'slots') ?? 0,
            image,
            channelId: target.id
          };
          const listing = store.createListing(draft);
          let sent;
          try {
            sent = await channel.send(listingPayload(listing));
          } catch (error) {
            store.saveListing({ ...listing, status: 'closed' });
            throw error;
          }
          store.saveListing({ ...listing, messageId: snowflake(sent.id), channelId: target.id });
          await interaction.reply(ephemeral(`Posted **${draft.name}**. Listing id \`${listing.id}\` is in the embed footer. Close or edit it with that id.`));
          return;
        }
        const listing = store.getListing(optionString(interaction, 'listing'));
        if (!listing || listing.ownerId !== actorId) {
          await interaction.reply(ephemeral('Only the Realm owner can change that listing.'));
          return;
        }
        const next = { ...listing };
        if (sub === 'close') next.status = 'closed';
        if (sub === 'edit') {
          const name = optionString(interaction, 'name');
          const edition = optionString(interaction, 'edition');
          const description = optionString(interaction, 'description');
          const slots = optionInteger(interaction, 'slots');
          const imageRaw = optionString(interaction, 'image');
          if (name) next.name = publicText(name, 80);
          if (edition === 'java' || edition === 'bedrock') next.edition = edition;
          if (description) next.description = publicText(description, 1000);
          if (slots !== null) next.slots = slots;
          if (imageRaw === '-') next.image = '';
          else if (imageRaw) {
            const image = safeLink(imageRaw);
            if (!image) {
              await interaction.reply(ephemeral('The image must be an http or https URL without a password.'));
              return;
            }
            next.image = image;
          }
        }
        const client = context.client || interaction.client;
        const saved = store.saveListing(await refreshListingMessage(client, next));
        await interaction.reply(ephemeral(sub === 'close' ? `Closed \`${saved.id}\`.` : `Updated \`${saved.id}\`.`));
        return;
      }
    }
    return;
  }

  if (typeof interaction.isButton === 'function' && interaction.isButton()) {
    const staffAction = /^craft:staff:(players|whitelist):([a-z0-9][a-z0-9_-]{0,31})$/.exec(customId);
    if (staffAction) {
      const kind = staffAction[1] === 'players' ? 'list' : 'whitelist-list';
      await runStaffRcon(interaction, context, kind, {}, staffAction[2]);
      return;
    }
    const apply = /^craft:realm:apply:([a-f0-9]{12})$/.exec(customId);
    if (apply) {
      const listing = store.getListing(apply[1]);
      if (!listing || listing.status !== 'open') {
        await interaction.reply(ephemeral('That Realm listing is closed.'));
        return;
      }
      await interaction.showModal(applyModal(listing.id));
      return;
    }
    if (decisionButton) {
      await handleRealmDecision(interaction, context, decisionButton[1], decisionButton[2]);
      return;
    }
    if (customId.startsWith('craft:')) await interaction.reply(ephemeral('That control is not available.'));
    return;
  }

  if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
    const submit = /^craft:realm:submit:([a-f0-9]{12})$/.exec(customId);
    if (!submit) {
      if (customId.startsWith('craft:')) await interaction.reply(ephemeral('That form is not available.'));
      return;
    }
    const listing = store.getListing(submit[1]);
    if (!listing || listing.status !== 'open') {
      await interaction.reply(ephemeral('That Realm listing is closed.'));
      return;
    }
    const gamertag = cleanGamertag(modalValue(interaction.fields, 'gamertag'));
    if (!gamertag) {
      await interaction.reply(ephemeral('Add a gamertag without mentions.'));
      return;
    }
    const note = publicText(modalValue(interaction.fields, 'note'), 200);
    let application;
    try {
      application = store.addApplication({
        listingId: listing.id,
        applicantId: interaction.user?.id,
        gamertag,
        note
      });
    } catch (error) {
      await interaction.reply(ephemeral(error?.code === 'PENDING' ? error.message : 'That application could not be saved.'));
      return;
    }
    const client = context.client || interaction.client;
    const where = await notifyOwner(client, listing, application);
    if (where === 'unsent' && craftIsStaff(interaction, config)) {
      const review = decisionPayload(listing, application, 'pending');
      await interaction.reply({
        ...review,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
      return;
    }
    const place = where === 'dm'
      ? 'The Realm owner was notified by private message.'
      : 'The Realm owner could not be reached by private message. Nothing was posted in this channel.';
    await interaction.reply(ephemeral(`Application sent for **${publicText(listing.name, 80)}**. ${place}`));
  }
}

async function registerCraftCommands(client, env) {
  const guildId = guildIdOf(env);
  if (!guildId) {
    console.warn('[Nexus Craft] slash command registration skipped: guild id missing');
    return;
  }
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  const definitions = craftCommands(env);
  for (const command of definitions) {
    const json = command.toJSON();
    const existing = commands.find((item) => item.name === json.name);
    if (existing) await guild.commands.edit(existing, json);
    else await guild.commands.create(json);
  }
  console.log(`[Nexus Craft] registered ${definitions.map((item) => `/${item.name}`).join(', ')}`);
}

function startCraftDiscord({ env = process.env, state = {}, token, client } = {}) {
  const discord = client || new Client({ intents: [GatewayIntentBits.Guilds] });
  const store = openCraftStore(env);
  const config = loadConfig();
  const context = { env, store, config, client: discord };
  const clientId = String(env.NEXUS_CRAFT_CLIENT_ID || env.DISCORD_CLIENT_ID || '').trim();
  console.log('[Nexus Craft] starting');
  console.log(`[Nexus Craft] client id ${clientId ? 'present' : 'missing'}`);
  console.log(`[Nexus Craft] guild id ${guildIdOf(env) ? 'present' : 'missing'}`);
  console.log(`[Nexus Craft] category ${readCraftCategory(env).code}`);
  discord.on(Events.InteractionCreate, (interaction) => {
    void handleCraftInteraction(interaction, context).catch(async (error) => {
      console.warn(`[Nexus Craft] interaction class=${errorClass(error)}`);
      const detail = redactSecret(String(error?.message || ''), []);
      const safe = detail && detail.length <= 300 && !/token|secret|password\s*[:=]/i.test(detail)
        ? detail
        : 'Something went wrong running that command.';
      const payload = ephemeral(safe);
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {}
    });
  });
  discord.once(Events.ClientReady, (ready) => {
    state.discord = 'ready';
    console.log(`[Nexus Craft] Discord ready as ${ready.user?.tag || 'bot'}`);
    void registerCraftCommands(discord, env).catch((error) => {
      console.warn(`[Nexus Craft] command registration class=${errorClass(error)}`);
    });
    if (store.getStatusPanel()?.host) startStatusLoop(discord, store, env);
    installMcEconomyLoops({ store, env });
  });
  discord.on(Events.Error, (error) => console.error(`[Nexus Craft] Discord error class=${errorClass(error)}`));
  return discord.login(token).then(() => discord);
}

module.exports = {
  craftCommands,
  handleCraftInteraction,
  handleRealmDecision,
  listingPayload,
  notifyOwner,
  queryStatus,
  registerCraftCommands,
  startCraftDiscord,
  startStatusLoop
};
