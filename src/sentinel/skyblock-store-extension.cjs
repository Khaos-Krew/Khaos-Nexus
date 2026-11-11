'use strict';

// Khaos Nexus Skyblock cosmetics store (Tebex) for Sentinal /shop.
// Scoped to the guilds in SENTINAL_SKYBLOCK_SHOP_GUILD_IDS (default: the
// workshop test guild only). The main guild keeps its existing /shop until the
// owner approves going public. Sentinal never takes payments: it only shows the
// catalog and links to the Tebex checkout.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');

const INSTALLED = Symbol.for('khaos.nexus.sentinal.skyblock.store');
const WORKSHOP_GUILD_ID = '1542989954672627803';
const SNOWFLAKE = /^\d{17,20}$/;

const CATALOG = Object.freeze([
  { id: 'kn_cloud_step_trail', name: 'Cloud Step Trail', price: '2.99', line: 'A light cloud particle trail. Looks only.' },
  { id: 'kn_nexus_trails_pack', name: 'Nexus Trails Pack', price: '5.99', line: 'Cloud Step, Melody and Petal Drift trails. Looks only.' },
  { id: 'kn_rift_mist_trail', name: 'Rift Mist Trail', price: '4.99', line: 'A rift-mist particle trail. Looks only.' },
  { id: 'kn_island_founder_look', name: 'Island Founder Armor Look', price: '3.99', line: 'Armor overlay. Your real armor still protects you. No stats.' },
  { id: 'kn_nexus_vanguard_look', name: 'Nexus Vanguard Armor Look', price: '6.99', line: 'Armor overlay. No stat changes.' },
  { id: 'kn_skylight_effects_pack', name: 'Skylight Effects Pack', price: '4.99', line: 'Heart Burst, Star Arrow and Leaf Arrow effects. No damage change.' }
]);

const RANKS = Object.freeze([
  { id: 'kn_shade_creeper', name: 'Shade Creeper', price: '9.99', line: '[Shade Creeper] title, chat colors, 4 homes, 2 island homes.' },
  { id: 'kn_void_enderman', name: 'Void Enderman', price: '19.99', line: 'Everything in Shade Creeper, plus /nick with colors, 5 homes, 3 island homes.' },
  { id: 'kn_cipher_runner_perm', name: 'Cipher Runner (Permanent)', price: '9.99', line: 'Cipher title, Cipher spark by your name, 4 homes, Cloud Step trail.' }
]);

const FOOTER = 'Cosmetics and convenience only. Never pay-to-win.';

function guildIds(env = process.env) {
  const raw = String(env.SENTINAL_SKYBLOCK_SHOP_GUILD_IDS ?? WORKSHOP_GUILD_ID);
  return new Set(raw.split(/[\s,]+/).map((v) => v.trim()).filter((v) => SNOWFLAKE.test(v)));
}

function storeUrl(env = process.env) {
  const raw = String(env.SENTINAL_SKYBLOCK_STORE_URL || '').trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function showRanks(env = process.env) {
  return String(env.SENTINAL_SKYBLOCK_SHOP_RANKS || '').trim().toLowerCase() === 'true';
}

function isSkyblockShopGuild(guildId, env = process.env) {
  const id = String(guildId || '').trim();
  return Boolean(id) && guildIds(env).has(id);
}

function shopCommand() {
  return new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Khaos Nexus Skyblock cosmetics store')
    .setDMPermission(false);
}

function itemLines(items) {
  return items.map((item) => `**${item.name}** — $${item.price}\n${item.line}`).join('\n').slice(0, 1024);
}

function shopPayload(env = process.env) {
  const url = storeUrl(env);
  const embed = new EmbedBuilder()
    .setTitle('Khaos Nexus Skyblock Store')
    .setColor(0x7b2cbf)
    .setDescription([
      'Support the server and look good doing it. Everything here is a cosmetic or a small convenience. No power, no paid boosts.',
      '',
      url
        ? 'Press **Open Store** to check out on Tebex. Enter the exact name you see in-game. Items arrive in-game within a few minutes while you are online.'
        : 'Checkout is opening soon. Prices are shown in USD.',
      '',
      'After it arrives, open `/cosmetics` in-game to equip it.'
    ].join('\n'))
    .addFields({ name: 'Wardrobe', value: itemLines(CATALOG) });
  if (showRanks(env)) embed.addFields({ name: 'Supporter ranks (one-time)', value: itemLines(RANKS) });
  embed.addFields({
    name: 'Free ways to earn',
    value: 'Vote daily for a Common Key and in-game money, play island milestones, and join events for earn-only titles and trails.'
  });
  embed.setFooter({ text: `${FOOTER} Questions? Open a ticket or ask Kirito.` });
  const components = [];
  if (url) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Store').setURL(url)
    ));
  }
  return { embeds: [embed], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function handleSkyblockShopInteraction(interaction, env = process.env) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'shop') return false;
  if (!isSkyblockShopGuild(interaction.guildId, env)) return false;
  await interaction.reply(shopPayload(env));
  return true;
}

async function registerSkyblockShop(client, env = process.env) {
  const results = [];
  for (const id of guildIds(env)) {
    try {
      const guild = await client.guilds.fetch(id);
      const json = shopCommand().toJSON();
      const commands = await guild.commands.fetch();
      const existing = commands.find((item) => item.name === json.name);
      if (existing) await guild.commands.edit(existing, json);
      else await guild.commands.create(json);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({ id, ok: false, reason: String(error?.code || error?.name || 'error') });
    }
  }
  return results;
}

function installSkyblockStoreExtension(env = process.env) {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function skyblockStoreLogin(...args) {
    const client = this;
    client.on(Events.InteractionCreate, (interaction) => {
      void handleSkyblockShopInteraction(interaction, env).catch((error) => {
        console.warn(`[Nexus Skyblock Store] interaction failed: ${String(error?.message || error).slice(0, 180)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      const results = await registerSkyblockShop(client, env);
      for (const r of results) {
        console.log(`[Nexus Skyblock Store] /shop guild=${r.id} ok=${r.ok}${r.ok ? '' : ` reason=${r.reason}`} store=${storeUrl(env) ? 'set' : 'unset'}`);
      }
    });
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  CATALOG,
  RANKS,
  WORKSHOP_GUILD_ID,
  guildIds,
  storeUrl,
  isSkyblockShopGuild,
  shopCommand,
  shopPayload,
  handleSkyblockShopInteraction,
  registerSkyblockShop,
  installSkyblockStoreExtension
};
