'use strict';

const { SlashCommandBuilder } = require('discord.js');
const crypto = require('node:crypto');

function installArkControlCommandExtension() {
  const target = require('./commands.cjs');
  if (target.createCommands.__khaosArkControlPatched) return;
  const original = target.createCommands;
  const wrapped = function createCommandsWithArkControl(options = {}) {
    const commands = original(options);
    const enabled = options.isModuleEnabled ? options.isModuleEnabled('game-server-control') : true;
    if (!enabled) return commands;
    const serverOption = (sub) => sub.addStringOption((o) => o.setName('server').setDescription('Configured ARK server').setRequired(true).setAutocomplete(true));
    commands.push(
      new SlashCommandBuilder().setName('arkconfig').setDescription('Owner-only guarded ARK config control.')
        .addSubcommand((sub) => serverOption(sub.setName('read').setDescription('Read an allowlisted ARK config file.'))
          .addStringOption((o) => o.setName('file').setDescription('Config file').setRequired(true).addChoices(
            { name: 'Game.ini', value: 'gameIni' }, { name: 'GameUserSettings.ini', value: 'gameUserSettings' }, { name: 'ArkShop', value: 'arkShop' }
          )))
        .addSubcommand((sub) => serverOption(sub.setName('setini').setDescription('Set one INI key while preserving the rest of the file.'))
          .addStringOption((o) => o.setName('file').setDescription('INI file').setRequired(true).addChoices({ name: 'Game.ini', value: 'gameIni' }, { name: 'GameUserSettings.ini', value: 'gameUserSettings' }))
          .addStringOption((o) => o.setName('section').setDescription('INI section').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('key').setDescription('INI key').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true).setMaxLength(1000))
          .addBooleanOption((o) => o.setName('apply').setDescription('Actually write the change; false is dry-run').setRequired(true)))
        .addSubcommand((sub) => serverOption(sub.setName('rollback').setDescription('Restore a Sentinel-created config backup.'))
          .addStringOption((o) => o.setName('file').setDescription('Config file').setRequired(true).addChoices(
            { name: 'Game.ini', value: 'gameIni' }, { name: 'GameUserSettings.ini', value: 'gameUserSettings' }, { name: 'ArkShop', value: 'arkShop' }
          ))
          .addStringOption((o) => o.setName('backup').setDescription('Exact Sentinel backup path').setRequired(true).setMaxLength(1000))),
      new SlashCommandBuilder().setName('arkshop').setDescription('Owner-only ArkShop configuration control.')
        .addSubcommand((sub) => serverOption(sub.setName('set').setDescription('Set one ArkShop JSON value and reload ArkShop.'))
          .addStringOption((o) => o.setName('path').setDescription('Dot path, for example General.ItemsPerPage').setRequired(true).setMaxLength(500))
          .addStringOption((o) => o.setName('value').setDescription('JSON value, for example true, 25, or "text"').setRequired(true).setMaxLength(1000))
          .addBooleanOption((o) => o.setName('apply').setDescription('Actually write/reload; false is dry-run').setRequired(true))),
      new SlashCommandBuilder().setName('arkdb').setDescription('Owner-only ArkShop MySQL diagnostics.')
        .addSubcommand((sub) => serverOption(sub.setName('status').setDescription('Probe the configured ArkShop MySQL endpoint without authenticating.')))
    );
    return commands;
  };
  Object.defineProperty(wrapped, '__khaosArkControlPatched', { value: true });
  target.createCommands = wrapped;
}

function installArkControlRuntime(runtime) {
  const pending = new Map();
  function onParentMessage(message) {
    if (message?.type !== 'ark-control-response') return false;
    const payload = message.payload || {};
    const waiter = pending.get(payload.requestId);
    if (!waiter) return false;
    pending.delete(payload.requestId);
    clearTimeout(waiter.timer);
    if (payload.ok) waiter.resolve(payload.result);
    else waiter.reject(new Error(payload.error || 'ARK control request failed.'));
    return true;
  }
  function request(operation, args, userId) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('ARK control request timed out.')); }, 20000);
      timer.unref?.();
      pending.set(requestId, { resolve, reject, timer });
      runtime.send('ark-control-request', { requestId, operation, args, userId });
    });
  }
  function servers() { return (runtime.getBootstrap()?.config?.servers || []).filter((s) => s.enabled !== false && String(s.game || '').toLowerCase() === 'ark'); }
  function findServer(name) { return servers().find((s) => s.name.toLowerCase() === String(name || '').toLowerCase()); }
  function owner(interaction) { return String(interaction.user?.id || '') === String(runtime.getBootstrap()?.config?.discord?.ownerUserId || ''); }
  function isInteraction(interaction) { return ['arkconfig', 'arkshop', 'arkdb'].includes(interaction?.commandName); }

  async function handle(interaction) {
    if (!isInteraction(interaction)) return false;
    if (interaction.isAutocomplete()) {
      const focused = String(interaction.options.getFocused() || '').toLowerCase();
      await interaction.respond(servers().filter((s) => s.name.toLowerCase().includes(focused)).slice(0, 25).map((s) => ({ name: s.name, value: s.name })));
      return true;
    }
    if (!interaction.isChatInputCommand()) return false;
    if (!owner(interaction)) { await interaction.reply({ content: 'ARK config, ArkShop, and ArkShop DB controls are restricted to the configured Khaos Nexus Owner.', ephemeral: true }); return true; }
    const server = findServer(interaction.options.getString('server'));
    if (!server) { await interaction.reply({ content: 'That ARK server is not configured or enabled.', ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    try {
      let result;
      const sub = interaction.options.getSubcommand();
      if (interaction.commandName === 'arkconfig' && sub === 'read') {
        result = await request('read', { serverId: server.id, fileKey: interaction.options.getString('file') }, interaction.user.id);
        const preview = String(result.content || '').replace(/```/g, "'''").slice(0, 1300);
        await interaction.editReply(`**${server.name} — ${result.label}**\nHash: \`${result.hash}\`\nRestart required after edits: **${result.restartRequired ? 'yes' : 'no'}**\n\`\`\`ini\n${preview}\n\`\`\``);
        return true;
      }
      if (interaction.commandName === 'arkconfig' && sub === 'setini') {
        const apply = interaction.options.getBoolean('apply');
        result = await request('set-ini', { serverId: server.id, fileKey: interaction.options.getString('file'), section: interaction.options.getString('section'), key: interaction.options.getString('key'), value: interaction.options.getString('value'), dryRun: !apply }, interaction.user.id);
      } else if (interaction.commandName === 'arkconfig' && sub === 'rollback') {
        result = await request('rollback', { serverId: server.id, fileKey: interaction.options.getString('file'), backupPath: interaction.options.getString('backup') }, interaction.user.id);
      } else if (interaction.commandName === 'arkshop' && sub === 'set') {
        let value;
        try { value = JSON.parse(interaction.options.getString('value')); } catch { throw new Error('ArkShop value must be valid JSON. Put text values in double quotes.'); }
        const apply = interaction.options.getBoolean('apply');
        result = await request('set-arkshop', { serverId: server.id, jsonPath: interaction.options.getString('path'), value, dryRun: !apply }, interaction.user.id);
      } else if (interaction.commandName === 'arkdb' && sub === 'status') {
        result = await request('mysql-probe', { serverId: server.id }, interaction.user.id);
      } else throw new Error('Unsupported ARK control command.');
      const text = JSON.stringify(result, null, 2).replace(/```/g, "'''").slice(0, 1700);
      await interaction.editReply(`**${server.name}**\n\`\`\`json\n${text}\n\`\`\``);
      return true;
    } catch (error) {
      await interaction.editReply({ content: `ARK control failed: ${String(error.message || error).slice(0, 1700)}` });
      return true;
    }
  }

  return { isInteraction, handle, onParentMessage };
}

module.exports = { installArkControlCommandExtension, installArkControlRuntime };