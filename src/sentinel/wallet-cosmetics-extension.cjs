'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const {
  walletCommandDefinition,
  parseWalletCustomId,
  walletEmbedPayload,
  walletEquipRow,
  equipRefusal
} = require('./wallet-cosmetics-ui.cjs');

const INSTALLED = Symbol.for('khaos.nexus.wallet.cosmetics.extension');

function walletProfile(response) {
  if (response?.profile && typeof response.profile === 'object') return response.profile;
  return null;
}

async function communityLevelFor(backend, userId) {
  if (typeof backend?.communityLevel !== 'function') return null;
  try {
    const response = await backend.communityLevel(String(userId));
    const level = Number(response?.profile?.level);
    if (response?.ok && Number.isInteger(level) && level >= 1 && level <= 10000) return level;
  } catch {}
  return null;
}

async function readBalances(economyClient, userId) {
  if (!economyClient || (typeof economyClient.configured === 'function' && economyClient.configured() === false)) {
    return { balances: null, unavailable: true };
  }
  try {
    const result = await economyClient.balances(String(userId));
    return { balances: result?.balances || {}, unavailable: false };
  } catch {
    return { balances: null, unavailable: true };
  }
}

async function syncWalletView(backend, userId, { walletOpened = false, level = undefined } = {}) {
  if (typeof backend?.syncWalletCosmetics !== 'function') {
    return { ok: false, reason: 'cosmetics-unavailable' };
  }
  const resolvedLevel = level === undefined ? await communityLevelFor(backend, userId) : level;
  const body = { walletOpened: walletOpened === true };
  if (Number.isInteger(resolvedLevel)) body.level = resolvedLevel;
  try {
    const response = await backend.syncWalletCosmetics(String(userId), body);
    if (!response || response.ok === false) return { ok: false, reason: response?.reason || 'cosmetics-sync-failed', response };
    return { ok: true, profile: walletProfile(response), level: resolvedLevel };
  } catch (error) {
    return { ok: false, reason: 'cosmetics-sync-failed', error: String(error?.message || error).slice(0, 180) };
  }
}

async function registerWalletCommand(guild) {
  const definition = walletCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === 'wallet');
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.toJSON();
}

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

async function replyWallet(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function showWallet(interaction, backend, economyClient, { walletOpened = false } = {}) {
  const userId = String(interaction.user?.id || '');
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [synced, money] = await Promise.all([
    syncWalletView(backend, userId, { walletOpened }),
    readBalances(economyClient, userId)
  ]);
  const profile = synced.profile || { discordUserId: userId, equippedTitle: null, equippedTheme: null };
  const payload = walletEmbedPayload(profile, {
    userId,
    balances: money.balances,
    balancesUnavailable: money.unavailable
  });
  if (!synced.ok) {
    const badges = payload.embeds[0].fields.find((field) => field.name.includes('Achievements'));
    if (badges) badges.value = 'Cosmetic unlocks did not save. Your level and wallet balances were not changed.';
  }
  await interaction.editReply(payload);
  return true;
}

async function equipSelection(interaction, backend, economyClient, selection = {}) {
  const userId = String(interaction.user?.id || '');
  if (typeof backend?.equipWalletCosmetic !== 'function') {
    await replyWallet(interaction, { content: 'Wallet cosmetics are unavailable right now. Nothing was equipped.', embeds: [], components: [] });
    return true;
  }
  let result;
  try {
    result = await backend.equipWalletCosmetic(userId, selection);
  } catch (error) {
    const message = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 180);
    await replyWallet(interaction, { content: `Wallet cosmetics could not be saved (${message}). Nothing was equipped.`, embeds: [], components: [] });
    return true;
  }
  if (!result || result.ok === false) {
    await replyWallet(interaction, { content: equipRefusal(result?.reason), embeds: [], components: [] });
    return true;
  }
  const money = await readBalances(economyClient, userId);
  const payload = walletEmbedPayload(result.profile || {}, {
    userId,
    balances: money.balances,
    balancesUnavailable: money.unavailable
  });
  if (interaction.deferred || interaction.replied || typeof interaction.update !== 'function') await replyWallet(interaction, payload);
  else await interaction.update(payload);
  return true;
}

async function handleWalletInteraction(interaction, { backend, economyClient } = {}) {
  const customId = String(interaction?.customId || '');
  if (interaction?.isButton?.() && customId.startsWith('nxwallet:')) {
    const parsed = parseWalletCustomId(customId);
    if (!parsed || parsed.action !== 'open') return false;
    if (String(interaction.user?.id || '') !== parsed.userId) {
      await interaction.reply(ephemeral('This wallet belongs to another member. Use `/wallet show` to open your own.'));
      return true;
    }
    const viewed = await syncWalletView(backend, parsed.userId, { walletOpened: false });
    const row = walletEquipRow(parsed.slot, viewed.profile || {}, parsed.userId);
    if (!row) {
      await interaction.reply(ephemeral('No unlocked cosmetics are available in that slot yet.'));
      return true;
    }
    await interaction.reply(ephemeral(
      parsed.slot === 'theme' ? 'Choose an unlocked theme.' : 'Choose an unlocked title.',
      { components: [row] }
    ));
    return true;
  }

  if (interaction?.isStringSelectMenu?.() && customId.startsWith('nxwallet:')) {
    const parsed = parseWalletCustomId(customId);
    if (!parsed || parsed.action !== 'equip') return false;
    if (String(interaction.user?.id || '') !== parsed.userId) {
      await interaction.reply(ephemeral('This wallet belongs to another member. Use `/wallet show` to open your own.'));
      return true;
    }
    const selected = String(interaction.values?.[0] || '');
    const selection = parsed.slot === 'theme' ? { themeId: selected } : { titleId: selected };
    return equipSelection(interaction, backend, economyClient, selection);
  }

  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'wallet') return false;
  const sub = interaction.options?.getSubcommand?.();
  if (sub === 'show') return showWallet(interaction, backend, economyClient, { walletOpened: true });
  if (sub === 'cosmetics') {
    const titleId = interaction.options.getString?.('title') || '';
    const themeId = interaction.options.getString?.('theme') || '';
    if (!titleId && !themeId) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const [viewed, money] = await Promise.all([
        syncWalletView(backend, String(interaction.user.id), { walletOpened: false }),
        readBalances(economyClient, String(interaction.user.id))
      ]);
      const rows = ['title', 'theme']
        .map((slot) => walletEquipRow(slot, viewed.profile || {}, interaction.user.id))
        .filter(Boolean);
      const payload = walletEmbedPayload(viewed.profile || { discordUserId: String(interaction.user.id) }, {
        userId: String(interaction.user.id),
        balances: money.balances,
        balancesUnavailable: money.unavailable,
        buttons: false,
        components: rows
      });
      if (!rows.length) {
        payload.content = 'No unlocked titles or themes are available yet.';
        delete payload.components;
      }
      await interaction.editReply(payload);
      return true;
    }
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return equipSelection(interaction, backend, economyClient, {
      ...(titleId ? { titleId } : {}),
      ...(themeId ? { themeId } : {})
    });
  }
  await replyWallet(interaction, { content: 'Unknown `/wallet` subcommand.' });
  return true;
}

function installWalletCosmeticsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function walletCosmeticsLogin(...args) {
    const client = this;
    const backend = new BackendClient(loadConfig());
    const economyClient = new NexusEconomyClient();
    client.on(Events.InteractionCreate, (interaction) => {
      void handleWalletInteraction(interaction, { backend, economyClient }).catch((error) => {
        console.warn(`[Nexus Wallet] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerWalletCommand(guild);
        console.log(`[Nexus Wallet] registered /wallet in guild ${guild.id}`);
      } catch (error) {
        console.error(`[Nexus Wallet] /wallet registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  walletProfile,
  communityLevelFor,
  readBalances,
  syncWalletView,
  registerWalletCommand,
  showWallet,
  equipSelection,
  handleWalletInteraction,
  installWalletCosmeticsExtension
};
