'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkConfigProfileStore, countSettings } = require('./ark-config-profiles.cjs');
const { ArkConfigApplyStore, previewProfile, applyProfile, rollbackTransaction } = require('./ark-config-profile-service.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.config.profile.extension');
const BOUND = Symbol.for('khaos.nexus.ark.config.profile.bound');

function commandDefinition() {
  const command = new SlashCommandBuilder()
    .setName('arkprofile')
    .setDescription('Manage versioned ARK dynamic configuration profiles.');

  command.addSubcommand((sub) => sub.setName('list').setDescription('List ARK config profiles.'));
  command.addSubcommand((sub) => sub.setName('create').setDescription('Create an empty ARK config profile.')
    .addStringOption((o) => o.setName('id').setDescription('Stable profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('name').setDescription('Friendly profile name.').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('description').setDescription('What this profile is for.').setMaxLength(300)));
  command.addSubcommand((sub) => sub.setName('clone').setDescription('Clone an existing ARK config profile.')
    .addStringOption((o) => o.setName('source').setDescription('Source profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('id').setDescription('New profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('name').setDescription('New friendly name.').setMaxLength(100)));
  command.addSubcommand((sub) => sub.setName('set').setDescription('Set one INI value in a profile revision.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('file').setDescription('Target INI file.').setRequired(true).addChoices({ name: 'GameUserSettings.ini', value: 'gus' }, { name: 'Game.ini', value: 'game' }))
    .addStringOption((o) => o.setName('section').setDescription('INI section name.').setRequired(true).setMaxLength(120))
    .addStringOption((o) => o.setName('key').setDescription('INI setting key.').setRequired(true).setMaxLength(120))
    .addStringOption((o) => o.setName('value').setDescription('INI setting value.').setRequired(true).setMaxLength(2000)));
  command.addSubcommand((sub) => sub.setName('unset').setDescription('Remove one INI value from a profile revision.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('file').setDescription('Target INI file.').setRequired(true).addChoices({ name: 'GameUserSettings.ini', value: 'gus' }, { name: 'Game.ini', value: 'game' }))
    .addStringOption((o) => o.setName('section').setDescription('INI section name.').setRequired(true).setMaxLength(120))
    .addStringOption((o) => o.setName('key').setDescription('INI setting key.').setRequired(true).setMaxLength(120)));
  command.addSubcommand((sub) => sub.setName('view').setDescription('View a profile revision and configured settings.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('history').setDescription('View retained profile revision history.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('restore-revision').setDescription('Restore an older retained profile revision as a new revision.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addIntegerOption((o) => o.setName('revision').setDescription('Revision to restore.').setRequired(true).setMinValue(1)));
  command.addSubcommand((sub) => sub.setName('preview').setDescription('Preview whether a profile would change a registered ARK server.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('apply').setDescription('Apply a profile to a registered ARK server with backups and verification.')
    .addStringOption((o) => o.setName('profile').setDescription('Profile id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm the live config write.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('transactions').setDescription('List recent config apply transactions for a server.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64)));
  command.addSubcommand((sub) => sub.setName('rollback').setDescription('Rollback one recorded config profile transaction.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('transaction').setDescription('Transaction UUID from /arkprofile transactions.').setRequired(true).setMaxLength(80))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm rollback of the recorded transaction.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('clear-restart').setDescription('Clear the pending config-restart marker after the ARK server has restarted.')
    .addStringOption((o) => o.setName('server').setDescription('ARK cluster server id.').setRequired(true).setMaxLength(64))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm that the server has restarted.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('delete').setDescription('Delete a reusable config profile; apply history remains retained.')
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

function getRequired(store, id) {
  const profile = store.get(id);
  if (!profile) throw new Error(`Unknown ARK config profile: ${id}`);
  return profile;
}

function getServerRequired(registry, id) {
  const server = registry.get(id);
  if (!server) throw new Error(`Unknown ARK cluster server: ${id}`);
  return server;
}

function profileLines(profile) {
  const lines = [];
  for (const fileKey of ['gus', 'game']) {
    for (const [section, settings] of Object.entries(profile.files?.[fileKey]?.sections || {})) {
      for (const [key, value] of Object.entries(settings)) {
        lines.push(`• \`${fileKey}\` **[${section}] ${key}** = \`${String(value).replace(/`/g, 'ˋ').slice(0, 160)}\``);
      }
    }
  }
  return lines;
}

async function refreshPanel(client) {
  if (client.__nexusArkClusterContext?.runRefresh) await client.__nexusArkClusterContext.runRefresh('config-profile', false);
}

async function handleCommand(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'arkprofile') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ARK config profile management requires Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const { profiles, registry, applies, client } = context;

  if (sub === 'list') {
    const list = profiles.list();
    const lines = list.map((profile) => {
      const counts = countSettings(profile.files);
      return `• \`${profile.id}\` • **${profile.name}** • r${profile.revision} • ${counts.total} setting(s)`;
    });
    await interaction.editReply({ content: (`🧩 **ARK Dynamic Config Profiles**\n\n${lines.join('\n') || 'No profiles yet.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'create') {
    const profile = profiles.create({ id: interaction.options.getString('id', true), name: interaction.options.getString('name', true), description: interaction.options.getString('description') || '' });
    await interaction.editReply({ content: `✅ Created ARK config profile \`${profile.id}\` at revision 1. Add values with \`/arkprofile set\`.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'clone') {
    const profile = profiles.clone(interaction.options.getString('source', true), { id: interaction.options.getString('id', true), name: interaction.options.getString('name') || '' });
    await interaction.editReply({ content: `✅ Cloned profile into \`${profile.id}\` with ${countSettings(profile.files).total} setting(s).`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'set') {
    const profile = profiles.setSetting({
      profileId: interaction.options.getString('profile', true),
      fileKey: interaction.options.getString('file', true),
      section: interaction.options.getString('section', true),
      key: interaction.options.getString('key', true),
      value: interaction.options.getString('value', true)
    });
    await interaction.editReply({ content: `✅ Updated \`${profile.id}\` to revision ${profile.revision}.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'unset') {
    const profile = profiles.unsetSetting({
      profileId: interaction.options.getString('profile', true),
      fileKey: interaction.options.getString('file', true),
      section: interaction.options.getString('section', true),
      key: interaction.options.getString('key', true)
    });
    await interaction.editReply({ content: `✅ Updated \`${profile.id}\` to revision ${profile.revision}.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'view') {
    const profile = getRequired(profiles, interaction.options.getString('profile', true));
    const lines = profileLines(profile);
    const head = `🧩 **${profile.name}** • \`${profile.id}\` • revision ${profile.revision}\n${profile.description || 'No description.'}\n\n`;
    await interaction.editReply({ content: `${head}${lines.join('\n') || 'No settings configured.'}`.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'history') {
    const profile = getRequired(profiles, interaction.options.getString('profile', true));
    const lines = [...profile.history].reverse().slice(0, 20).map((item) => `• r${item.revision} • <t:${Math.floor(new Date(item.savedAt).getTime() / 1000)}:R> • ${item.note || 'snapshot'}`);
    await interaction.editReply({ content: (`🕘 **${profile.name} Revision History**\nCurrent: r${profile.revision}\n\n${lines.join('\n') || 'No older revisions retained.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'restore-revision') {
    const profile = profiles.restoreRevision(interaction.options.getString('profile', true), interaction.options.getInteger('revision', true));
    await interaction.editReply({ content: `✅ Restored the selected snapshot as new revision **r${profile.revision}** of \`${profile.id}\`.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'preview') {
    const profile = getRequired(profiles, interaction.options.getString('profile', true));
    const server = getServerRequired(registry, interaction.options.getString('server', true));
    const preview = await previewProfile({ server, profile });
    await interaction.editReply({ content: `🔎 **Profile Preview**\nServer: **${server.mapName}**\nProfile: \`${profile.id}\` r${profile.revision}\nSettings: ${preview.settings}\nGameUserSettings.ini: ${preview.files.gus.changed ? 'would change' : 'unchanged'} (${preview.files.gus.configured} configured)\nGame.ini: ${preview.files.game.changed ? 'would change' : 'unchanged'} (${preview.files.game.configured} configured)\nRestart required if applied: **${preview.restartRequired ? 'yes' : 'no'}**`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'apply') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Apply cancelled because confirm was false.');
    const profile = getRequired(profiles, interaction.options.getString('profile', true));
    const server = getServerRequired(registry, interaction.options.getString('server', true));
    const result = await applyProfile({ server, profile, actorId: interaction.user.id, applyStore: applies, dryRun: false });
    if (result.transaction) {
      registry.upsert({ ...server, configProfile: profile.id });
      registry.setRestartRequired(server.id, { required: result.restartRequired, reason: `Config profile ${profile.id} r${profile.revision} applied`, transactionId: result.transaction.id });
      await refreshPanel(client);
    }
    await interaction.editReply({ content: result.transaction ? `✅ Applied \`${profile.id}\` r${profile.revision} to **${server.mapName}**.\nChanged settings: ${result.appliedSettings}\nTransaction: \`${result.transaction.id}\`\n⚠️ **ARK restart required.** Sentinal did not restart the server automatically.` : `✅ \`${profile.id}\` already matches **${server.mapName}**; no files were written and no restart is required.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'transactions') {
    const server = getServerRequired(registry, interaction.options.getString('server', true));
    const list = applies.listForServer(server.id, 12);
    const lines = list.map((item) => `• \`${item.id}\` • \`${item.profileId}\` r${item.profileRevision} • <t:${Math.floor(new Date(item.appliedAt).getTime() / 1000)}:R>${item.rolledBackAt ? ' • rolled back' : ''}`);
    await interaction.editReply({ content: (`🧾 **${server.mapName} Config Transactions**\n\n${lines.join('\n') || 'No profile transactions recorded.'}`).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'rollback') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Rollback cancelled because confirm was false.');
    const server = getServerRequired(registry, interaction.options.getString('server', true));
    const result = await rollbackTransaction({ server, transactionId: interaction.options.getString('transaction', true), applyStore: applies });
    registry.setRestartRequired(server.id, { required: result.restartRequired, reason: `Config transaction ${result.transactionId} rolled back`, transactionId: result.transactionId });
    await refreshPanel(client);
    await interaction.editReply({ content: `✅ Rolled back transaction \`${result.transactionId}\` on **${server.mapName}**. Restored ${result.restored} backed-up setting step(s).\n⚠️ **ARK restart required.**`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'clear-restart') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Restart marker was not cleared because confirm was false.');
    const server = getServerRequired(registry, interaction.options.getString('server', true));
    registry.setRestartRequired(server.id, { required: false });
    await refreshPanel(client);
    await interaction.editReply({ content: `✅ Cleared the pending config-restart marker for **${server.mapName}**.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'delete') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Delete cancelled because confirm was false.');
    const id = interaction.options.getString('profile', true);
    const inUse = registry.list({ includeDisabled: true }).filter((server) => server.configProfile === id);
    if (inUse.length) throw new Error(`Profile ${id} is assigned to: ${inUse.map((server) => server.mapName).join(', ')}. Assign another profile before deleting it.`);
    const removed = profiles.remove(id);
    if (!removed) throw new Error(`Unknown ARK config profile: ${id}`);
    await interaction.editReply({ content: `✅ Deleted reusable profile \`${removed.id}\`. Existing apply transaction history and server backups were preserved.`, allowedMentions: { parse: [] } });
    return true;
  }

  throw new Error('Unsupported ARK config profile operation.');
}

function installArkConfigProfileExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const registry = new ArkClusterRegistry();
  const profiles = new ArkConfigProfileStore();
  const applies = new ArkConfigApplyStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkProfileLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleCommand(interaction, { config, registry, profiles, applies, client }).catch(async (error) => {
          if (interaction.commandName !== 'arkprofile') return;
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
        const gen1 = registry.get('gen1');
        if (gen1?.configProfile) profiles.ensure({ id: gen1.configProfile, name: 'Gen 1 Live', description: 'Sentinal-managed live configuration profile for Genesis Part 1.' });
        console.log(`[Nexus Sentinal] ARK dynamic config profiles ready: profiles=${profiles.list().length}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK dynamic config profiles unavailable: ${String(error?.message || error).slice(0, 300)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  commandDefinition,
  registerCommand,
  getRequired,
  getServerRequired,
  profileLines,
  handleCommand,
  installArkConfigProfileExtension
};
