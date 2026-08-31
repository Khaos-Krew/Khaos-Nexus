'use strict';

const path = require('node:path');
const {
  AttachmentBuilder,
  Client,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const { meta: legacyMeta, titleCase } = require('./ark-cache-shop-extension.cjs');
const { ArkDinoBoxTokenService } = require('./ark-dino-box-token-service.cjs');

const COMMAND_NAME = 'cachetoken';
const TOKEN_ISSUER_VERSION = 3;
const INSTALLED = Symbol.for('khaos.nexus.dino.box.token.issuer.extension');
const BOUND = Symbol.for('khaos.nexus.dino.box.token.issuer.extension.bound');
const COIN_NAME = 'nexus-points-coin.png';
const COIN_PATH = path.join(process.cwd(), 'config', 'ark', 'arkshopui', 'assets', COIN_NAME);

function cacheDisplayName(cacheId) {
  const id = String(cacheId || '').toLowerCase();
  return CONFIG.caches[id]?.displayName || legacyMeta(id).name || `${titleCase(id)} Cache`;
}

function cacheChoices() {
  return [
    { name: 'Any Dino Cache', value: 'any' },
    ...Object.keys(CONFIG.caches).map((id) => ({ name: cacheDisplayName(id).slice(0, 100), value: id }))
  ];
}

function tokenCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Owner-only Dino Box token management')
    .addSubcommand((sub) => sub
      .setName('give')
      .setDescription('Give one single-use Dino Box token to a Discord member')
      .addUserOption((opt) => opt.setName('user').setDescription('Token recipient').setRequired(true))
      .addStringOption((opt) => opt
        .setName('cache')
        .setDescription('Cache this token can redeem; Any Cache lets the player choose')
        .setRequired(true)
        .addChoices(...cacheChoices())));
}

function isGuildOwner(interaction) {
  return Boolean(interaction?.guild?.ownerId && String(interaction.guild.ownerId) === String(interaction.user?.id || ''));
}

function tokenScopeLabel(scope) {
  if (scope === '*' || scope === 'any') return 'Any Dino Cache';
  return cacheDisplayName(scope);
}

function tokenCardPayload({ token, recipientId }) {
  const scope = tokenScopeLabel(token.cacheType);
  return {
    embeds: [{
      title: '🪙 Nexus Dino Box Token',
      description: `You received **1 single-use Dino Box Token**.\n\n**Valid for:** ${scope}\n**Bound to:** <@${recipientId}>\n\nRedeem it in **#dino-box-shop** by choosing an eligible cache and pressing **Redeem Token**.`,
      color: 0xb00020,
      fields: [{ name: 'Token Code', value: `\`${token.code}\``, inline: false }],
      image: { url: `attachment://${COIN_NAME}` },
      footer: { text: 'Nexus Sentinal • Single use • 0 ArkShop Points charged' }
    }],
    files: [new AttachmentBuilder(COIN_PATH, { name: COIN_NAME })],
    allowedMentions: { parse: [] }
  };
}

async function registerCommand(guild) {
  const commands = await guild.commands.fetch();
  const definition = tokenCommand().toJSON();
  const existing = commands.find((item) => item.name === COMMAND_NAME);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
}

async function handleGive(interaction, tokenService) {
  if (!isGuildOwner(interaction)) {
    return interaction.reply({
      content: '⛔ Only the Discord server owner can issue Dino Box Tokens.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }

  const recipient = interaction.options.getUser('user', true);
  if (recipient.bot) {
    return interaction.reply({ content: 'Bots cannot receive Dino Box Tokens.', flags: MessageFlags.Ephemeral });
  }
  const choice = String(interaction.options.getString('cache', true) || '').toLowerCase();
  const cacheId = choice === 'any' ? '*' : choice;
  if (cacheId !== '*' && !CONFIG.caches[cacheId]) throw new Error('Unknown Dino Cache.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const token = await tokenService.issueToken({
    cacheId,
    issuedToDiscordUserId: String(recipient.id),
    issuedByDiscordUserId: String(interaction.user.id),
    sourceLabel: 'discord-server-owner-grant'
  });

  let delivered = true;
  try {
    await recipient.send(tokenCardPayload({ token, recipientId: recipient.id }));
  } catch {
    delivered = false;
  }

  const scope = tokenScopeLabel(token.cacheType);
  if (delivered) {
    return interaction.editReply({
      content: `✅ Gave <@${recipient.id}> **1 Nexus Dino Box Token** for **${scope}**. The token was delivered privately by DM.`,
      allowedMentions: { users: [String(recipient.id)] }
    });
  }

  return interaction.editReply({
    content: `⚠️ Token created for <@${recipient.id}> (**${scope}**), but their DMs are closed.\nGive them this bound token manually: \`${token.code}\``,
    files: [new AttachmentBuilder(COIN_PATH, { name: COIN_NAME })],
    allowedMentions: { users: [String(recipient.id)] }
  });
}

function installArkDinoBoxTokenIssuerExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const tokenService = options.tokenService || new ArkDinoBoxTokenService();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusDinoBoxTokenIssuerLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, async () => {
        for (const guild of client.guilds.cache.values()) {
          try { await registerCommand(guild); }
          catch (error) { console.error('[Nexus Sentinal] cachetoken command registration failed:', String(error?.message || error).slice(0, 300)); }
        }
      });
      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction.isChatInputCommand?.() || interaction.commandName !== COMMAND_NAME) return;
        void (async () => {
          if (interaction.options.getSubcommand() !== 'give') return;
          await handleGive(interaction, tokenService);
        })().catch(async (error) => {
          const payload = { content: `⚠️ **Cache Token:** ${String(error?.message || error).slice(0, 400)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  COMMAND_NAME,
  TOKEN_ISSUER_VERSION,
  COIN_NAME,
  COIN_PATH,
  cacheDisplayName,
  cacheChoices,
  tokenCommand,
  isGuildOwner,
  tokenScopeLabel,
  tokenCardPayload,
  registerCommand,
  handleGive,
  installArkDinoBoxTokenIssuerExtension
};
