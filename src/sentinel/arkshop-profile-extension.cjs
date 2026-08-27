'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkShopProfileStore, counts, GENERAL_KEYS } = require('./arkshop-profiles.cjs');
const { ArkShopApplyStore, previewArkShopProfile, applyArkShopProfile, rollbackArkShopTransaction, parseArkShopText } = require('./arkshop-profile-service.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkshop.profile.extension');
const BOUND = Symbol.for('khaos.nexus.arkshop.profile.bound');

const SECTION_CHOICES = [
  { name: 'Kits', value: 'Kits' },
  { name: 'Shop Items', value: 'ShopItems' },
  { name: 'Sell Items', value: 'SellItems' }
];

function commandDefinition() {
  const command = new SlashCommandBuilder()
    .setName('arkshopadmin')
    .setDescription('Manage Sentinal versioned ArkShop economy profiles.');
  command.addSubcommand((sub) => sub.setName('profiles').setDescription('List ArkShop profiles.'));
  command.addSubcommand((sub) => sub.setName('import-live').setDescription('Import the current protected live ArkShop config into a reusable profile.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('profile').setDescription('Profile id to create/update.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('name').setDescription('Friendly profile name.').setMaxLength(100)));
  command.addSubcommand((sub) => sub.setName('view').setDescription('View ArkShop profile counts and managed sections.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('set-entry').setDescription('Create or replace a kit/shop/sell entry in a profile.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('section').setDescription('ArkShop section.').setRequired(true).addChoices(...SECTION_CHOICES))
    .addStringOption((o) => o.setName('id').setDescription('ArkShop entry id used in buy/kit commands.').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('json').setDescription('Entry definition as JSON object.').setRequired(true).setMaxLength(4000)));
  command.addSubcommand((sub) => sub.setName('remove-entry').setDescription('Remove a kit/shop/sell entry from a profile.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('section').setDescription('ArkShop section.').setRequired(true).addChoices(...SECTION_CHOICES))
    .addStringOption((o) => o.setName('id').setDescription('Entry id.').setRequired(true).setMaxLength(80)));
  command.addSubcommand((sub) => sub.setName('set-general').setDescription('Set an approved ArkShop General economy/display setting in a profile.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('key').setDescription('Approved General key.').setRequired(true).addChoices(...[...GENERAL_KEYS].map((key) => ({ name: key.slice(0, 100), value: key }))))
    .addStringOption((o) => o.setName('value').setDescription('JSON value, e.g. 15, true, or {"Enabled":true,...}.').setRequired(true).setMaxLength(2000)));
  command.addSubcommand((sub) => sub.setName('history').setDescription('View retained ArkShop profile revisions.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('restore-revision').setDescription('Restore a retained profile revision as a new revision.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addIntegerOption((o) => o.setName('revision').setDescription('Revision number.').setRequired(true).setMinValue(1)));
  command.addSubcommand((sub) => sub.setName('preview').setDescription('Compare a profile to the live ArkShop config without writing.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('apply').setDescription('Apply an ArkShop profile with backup, verification, and ArkShop.Reload.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm live ArkShop change.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('transactions').setDescription('List recent ArkShop profile apply transactions.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('rollback').setDescription('Restore a previous ArkShop config backup and reload it.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('transaction').setDescription('ArkShop transaction UUID.').setRequired(true).setMaxLength(80))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm ArkShop rollback.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('delete-profile').setDescription('Delete an unused ArkShop profile; backups/transactions remain.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm profile deletion.').setRequired(true)));
  return command;
}

async function registerCommand(guild) {
  const definition = commandDefinition().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
}

function requiredProfile(store, id) {
  const profile = store.get(id);
  if (!profile) throw new Error(`Unknown ArkShop profile: ${id}`);
  return profile;
}

function requiredServer(registry, id) {
  const server = registry.get(id);
  if (!server) throw new Error(`Unknown ARK cluster server: ${id}`);
  return server;
}

function parseJsonInput(text) {
  const raw = String(text ?? '').trim();
  try { return JSON.parse(raw); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
}

async function refreshPanel(client) {
  if (client.__nexusArkClusterContext?.runRefresh) await client.__nexusArkClusterContext.runRefresh('arkshop-profile', false);
}

async function handleCommand(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'arkshopadmin') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ArkShop management requires Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const { profiles, registry, applies, client } = context;

  if (sub === 'profiles') {
    const list = profiles.list();
    const lines = list.map((profile) => {
      const c = counts(profile.data);
      return `• \`${profile.id}\` • **${profile.name}** • r${profile.revision} • ${c.shopItems} shop / ${c.kits} kits / ${c.sellItems} sell`;
    });
    await interaction.editReply({ content: (`🛒 **Sentinal ArkShop Profiles**\n\n${lines.join('\n') || 'No ArkShop profiles yet. Use /arkshopadmin import-live first.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'import-live') {
    const server = requiredServer(registry, interaction.options.getString('server', true));
    const live = await readConfig(server.envPrefix, 'arkshop');
    const config = parseArkShopText(live.text);
    const profile = profiles.importLive({
      id: interaction.options.getString('profile', true),
      name: interaction.options.getString('name') || `${server.mapName} Live Shop`,
      description: `Imported from ${server.mapName} by Sentinal. Protected Mysql and Discord webhook fields are excluded.`,
      config
    });
    const c = counts(profile.data);
    await interaction.editReply({ content: `✅ Imported the live ArkShop config into \`${profile.id}\` r${profile.revision}.\nShop items: ${c.shopItems} • Kits: ${c.kits} • Sell items: ${c.sellItems}\n🔐 MySQL credentials and Discord webhook URL were not stored in the profile.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'view') {
    const profile = requiredProfile(profiles, interaction.options.getString('profile', true));
    const c = counts(profile.data);
    const sections = profile.data.managedSections.join(', ') || 'none';
    const sampleShop = Object.keys(profile.data.ShopItems || {}).slice(0, 15).join(', ') || 'none';
    const sampleKits = Object.keys(profile.data.Kits || {}).slice(0, 15).join(', ') || 'none';
    await interaction.editReply({ content: `🛒 **${profile.name}** • \`${profile.id}\` r${profile.revision}\n${profile.description || 'No description.'}\n\n**Managed sections:** ${sections}\n**Shop items:** ${c.shopItems} (${sampleShop})\n**Kits:** ${c.kits} (${sampleKits})\n**Sell items:** ${c.sellItems}\n**General overrides:** ${c.general}`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'set-entry') {
    const definition = parseJsonInput(interaction.options.getString('json', true));
    const profile = profiles.setEntry({
      profileId: interaction.options.getString('profile', true),
      section: interaction.options.getString('section', true),
      entryId: interaction.options.getString('id', true),
      definition
    });
    await interaction.editReply({ content: `✅ Updated \`${profile.id}\` to r${profile.revision}. Preview before applying live.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'remove-entry') {
    const profile = profiles.removeEntry({ profileId: interaction.options.getString('profile', true), section: interaction.options.getString('section', true), entryId: interaction.options.getString('id', true) });
    await interaction.editReply({ content: `✅ Removed the entry from \`${profile.id}\`; profile is now r${profile.revision}.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'set-general') {
    const profile = profiles.setGeneral({ profileId: interaction.options.getString('profile', true), key: interaction.options.getString('key', true), value: parseJsonInput(interaction.options.getString('value', true)) });
    await interaction.editReply({ content: `✅ Updated safe General setting in \`${profile.id}\`; profile is now r${profile.revision}.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'history') {
    const profile = requiredProfile(profiles, interaction.options.getString('profile', true));
    const lines = [...profile.history].reverse().slice(0, 20).map((item) => `• r${item.revision} • <t:${Math.floor(new Date(item.savedAt).getTime() / 1000)}:R> • ${item.note || 'snapshot'}`);
    await interaction.editReply({ content: (`🕘 **${profile.name} History** • current r${profile.revision}\n\n${lines.join('\n') || 'No earlier revisions retained.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'restore-revision') {
    const profile = profiles.restoreRevision(interaction.options.getString('profile', true), interaction.options.getInteger('revision', true));
    await interaction.editReply({ content: `✅ Restored the selected snapshot as new revision r${profile.revision} of \`${profile.id}\`.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'preview') {
    const server = requiredServer(registry, interaction.options.getString('server', true));
    const profile = requiredProfile(profiles, interaction.options.getString('profile', true));
    const preview = await previewArkShopProfile({ server, profile });
    const c = preview.counts;
    await interaction.editReply({ content: `🔎 **ArkShop Profile Preview**\nServer: **${server.mapName}**\nProfile: \`${profile.id}\` r${profile.revision}\nWould change live config: **${preview.changed ? 'yes' : 'no'}**\nManaged: ${preview.managedSections.join(', ') || 'none'}\nShop items: ${c.shopItems} • Kits: ${c.kits} • Sell items: ${c.sellItems}\nRestart required: **no** — successful apply uses \`ArkShop.Reload\`.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'apply') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('ArkShop apply cancelled because confirm was false.');
    const server = requiredServer(registry, interaction.options.getString('server', true));
    const profile = requiredProfile(profiles, interaction.options.getString('profile', true));
    const result = await applyArkShopProfile({ server, profile, actorId: interaction.user.id, applyStore: applies });
    if (result.transaction) {
      registry.upsert({ ...server, shopProfile: profile.id });
      await refreshPanel(client);
    }
    await interaction.editReply({ content: result.transaction ? `✅ Applied ArkShop profile \`${profile.id}\` r${profile.revision} to **${server.mapName}**.\nBackup created: yes\nReload: \`ArkShop.Reload\`\nTransaction: \`${result.transaction.id}\`\n**No ARK restart required.**` : `✅ Live ArkShop already matches \`${profile.id}\`; nothing was written or reloaded.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'transactions') {
    const server = requiredServer(registry, interaction.options.getString('server', true));
    const list = applies.listForServer(server.id, 12);
    const lines = list.map((item) => `• \`${item.id}\` • \`${item.profileId}\` r${item.profileRevision} • <t:${Math.floor(new Date(item.appliedAt).getTime() / 1000)}:R>${item.rolledBackAt ? ' • rolled back' : ''}`);
    await interaction.editReply({ content: (`🧾 **${server.mapName} ArkShop Transactions**\n\n${lines.join('\n') || 'No ArkShop profile transactions recorded.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'rollback') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('ArkShop rollback cancelled because confirm was false.');
    const server = requiredServer(registry, interaction.options.getString('server', true));
    const result = await rollbackArkShopTransaction({ server, transactionId: interaction.options.getString('transaction', true), applyStore: applies });
    await refreshPanel(client);
    await interaction.editReply({ content: `✅ Restored ArkShop transaction \`${result.transactionId}\` on **${server.mapName}** and ran \`ArkShop.Reload\`. No ARK restart required.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'delete-profile') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('ArkShop profile deletion cancelled because confirm was false.');
    const id = interaction.options.getString('profile', true);
    const inUse = registry.list({ includeDisabled: true }).filter((server) => server.shopProfile === id);
    if (inUse.length) throw new Error(`ArkShop profile ${id} is assigned to: ${inUse.map((server) => server.mapName).join(', ')}.`);
    const removed = profiles.remove(id);
    if (!removed) throw new Error(`Unknown ArkShop profile: ${id}`);
    await interaction.editReply({ content: `✅ Deleted reusable ArkShop profile \`${removed.id}\`. Transaction records and server backups were preserved.`, allowedMentions: { parse: [] } });
    return true;
  }

  throw new Error('Unsupported ArkShop management operation.');
}

function installArkShopProfileExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const registry = new ArkClusterRegistry();
  const profiles = new ArkShopProfileStore();
  const applies = new ArkShopApplyStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkShopProfileLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleCommand(interaction, { config, registry, profiles, applies, client }).catch(async (error) => {
          if (interaction.commandName !== 'arkshopadmin') return;
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        const guildId = String(config.discord?.guildId || '');
        if (!guildId) throw new Error('NEXUS_DISCORD_GUILD_ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerCommand(guild);
        console.log(`[Nexus Sentinal] ArkShop profile management ready: profiles=${profiles.list().length}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ArkShop profile management unavailable: ${String(error?.message || error).slice(0, 300)}`));
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  SECTION_CHOICES,
  commandDefinition,
  registerCommand,
  requiredProfile,
  requiredServer,
  parseJsonInput,
  handleCommand,
  installArkShopProfileExtension
};
