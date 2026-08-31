'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { ForgeClient } = require('./forge-client.cjs');
const { ForgeWorkerClient } = require('./forge-worker-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.forge.control-plane.extension');

function commandDefinition() {
  return new SlashCommandBuilder()
    .setName('forgeops')
    .setDescription('Forge orchestration and Nexus build-worker controls')
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Check Forge and all Nexus worker lanes'))
    .addSubcommand((sub) => sub
      .setName('validate')
      .setDescription('Queue check and test jobs for a branch without deploying it')
      .addStringOption((opt) => opt
        .setName('branch')
        .setDescription('Branch or git ref to validate')
        .setRequired(true)
        .setMaxLength(240))
      .addStringOption((opt) => opt
        .setName('lane')
        .setDescription('Worker lane that should own this validation')
        .setRequired(true)
        .addChoices(
          { name: 'Forge engineering', value: 'forge' },
          { name: 'ARK server/config', value: 'ark' },
          { name: 'General', value: 'general' }
        )));
}

function memberIsOperator(interaction, config) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user?.id || ''))) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = interaction.member?.roles?.cache;
  return Boolean(roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id))));
}

function compactHealth(result, lane) {
  if (result.status === 'rejected') return `❌ ${lane}: ${String(result.reason?.message || result.reason).slice(0, 180)}`;
  const value = result.value || {};
  return `✅ ${lane}: ${value.nodeId || 'online'} • state=${value.state || 'unknown'} • active=${value.activeJobId || 'none'}`;
}

function jobId(result) {
  return String(result?.job_id || result?.jobId || 'unknown');
}

function installForgeControlPlaneExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const logger = options.logger || console;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const forge = options.forge || new ForgeClient();
  const workers = options.workers || new ForgeWorkerClient();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusForgeControlPlaneLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = commandDefinition();
        const commandJson = normalizeRequiredOptions(definition.toJSON());
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, commandJson);
        else await guild.commands.create(commandJson);
        logger.log?.(`[Nexus Sentinal] registered /forgeops in guild ${guild.id}`);
      } catch (error) {
        logger.error?.(`[Nexus Sentinal] Forge control-plane registration failed: ${String(error?.message || error).slice(0, 400)}`);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'forgeops') return;
      try {
        if (!memberIsOperator(interaction, config)) {
          await interaction.reply({ content: 'Forge orchestration controls are restricted to Nexus staff.', flags: MessageFlags.Ephemeral });
          return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const workerConfig = workers.configuration();
          const [forgeHealth, forgeLane, arkLane, generalLane] = await Promise.allSettled([
            forge.health(),
            workers.health('forge'),
            workers.health('ark'),
            workers.health('general')
          ]);
          let cluster = null;
          try { cluster = await workers.cluster('forge'); } catch {}
          const forgeText = forgeHealth.status === 'fulfilled'
            ? `✅ Forge: ${forgeHealth.value.version} • ${forgeHealth.value.writePolicy}`
            : `❌ Forge: ${String(forgeHealth.reason?.message || forgeHealth.reason).slice(0, 180)}`;
          const lines = [
            '**🔥 Nexus Forge Control Plane**',
            forgeText,
            compactHealth(forgeLane, 'forge'),
            compactHealth(arkLane, 'ark'),
            compactHealth(generalLane, 'general'),
            '',
            `Worker token: **${workerConfig.tokenConfigured ? 'Configured' : 'Missing'}**`
          ];
          if (cluster) {
            lines.push(
              `Nodes: **${Array.isArray(cluster.nodes) ? cluster.nodes.length : 0}**`,
              `Active/queued jobs: **${Array.isArray(cluster.jobs) ? cluster.jobs.length : 0}**`,
              `Recent releases: **${Array.isArray(cluster.releases) ? cluster.releases.length : 0}**`
            );
          }
          lines.push('', '_Forge proposes/builds; workers validate; Sentinel remains the live-server authority._');
          await interaction.editReply({ content: lines.join('\n').slice(0, 1900) });
          return;
        }

        if (sub === 'validate') {
          const branch = String(interaction.options.getString('branch', true)).trim();
          const lane = String(interaction.options.getString('lane', true)).trim().toLowerCase();
          if (!branch || branch.length > 240 || /[\r\n\0]/.test(branch)) {
            await interaction.reply({ content: 'A valid branch/ref is required.', flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await workers.queueValidationPipeline({
            lane,
            gitRef: branch,
            metadata: {
              requestedByDiscordUserId: String(interaction.user.id),
              requestedVia: '/forgeops validate'
            }
          });
          await interaction.editReply({
            content: [
              `✅ **Forge validation pipeline queued on ${lane.toUpperCase()} lane**`,
              `Ref: \`${branch}\``,
              `Validation job: \`${jobId(result.validation)}\``,
              `Test job: \`${jobId(result.test)}\``,
              '',
              '**No production deployment was requested.**'
            ].join('\n')
          });
          logger.log?.(`[Nexus Sentinal] Forge worker validation actor=${interaction.user.id} lane=${lane} ref=${branch} validation=${jobId(result.validation)} test=${jobId(result.test)}`);
        }
      } catch (error) {
        const content = `⚠️ Forge orchestration request failed: ${String(error?.message || error).slice(0, 1500)}`;
        logger.error?.(`[Nexus Sentinal] Forge control-plane request failed: ${String(error?.message || error).slice(0, 500)}`);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch {}
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  commandDefinition,
  memberIsOperator,
  installForgeControlPlaneExtension
};
