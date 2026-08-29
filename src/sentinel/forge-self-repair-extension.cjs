'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { ForgeSelfRepairObserver } = require('./forge-self-repair-observer.cjs');

const INSTALLED = Symbol.for('khaos.nexus.forge.self.repair.extension');
let activeObserver = null;

function selfRepairCommand() {
  return new SlashCommandBuilder()
    .setName('selfrepair')
    .setDescription('Observation-only Nexus self-repair controls')
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show the observer state and current incidents'))
    .addSubcommand((sub) => sub
      .setName('check')
      .setDescription('Run a zero-AI health and CI observation pass now'))
    .addSubcommand((sub) => sub
      .setName('incidents')
      .setDescription('Show recent incidents and prepared repair candidates'));
}

function memberIsSelfRepairOperator(interaction, config) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user?.id || ''))) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = interaction.member?.roles?.cache;
  return Boolean(roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id))));
}

function iconFor(ok) {
  return ok ? '✅' : '⚠️';
}

function snapshotLines(snapshot = {}) {
  const lines = [];
  const add = (label, item) => {
    const ok = Boolean(item?.ok);
    const state = String(item?.state || (ok ? 'healthy' : 'unknown')).slice(0, 100);
    lines.push(`${iconFor(ok)} **${label}:** ${state}`);
  };
  add('Nexus Backend', snapshot.backend);
  add('Sentinel Admin', snapshot.sentinelAdmin);
  add('Forge Runtime', snapshot.forge);
  add('Nexus CI', snapshot.ci);
  if (snapshot.ci?.ref) lines.push(`CI ref: \`${String(snapshot.ci.ref).slice(0, 200)}\``);
  if (snapshot.ci?.sha) lines.push(`CI commit: \`${String(snapshot.ci.sha).slice(0, 12)}\``);
  return lines;
}

function formatObserverStatus(status = {}) {
  const open = Array.isArray(status.openIncidents) ? status.openIncidents : [];
  const snapshot = status.lastSnapshot || {};
  return [
    '**🛡️ Nexus Self-Repair V1**',
    `Mode: **OBSERVE ONLY**`,
    `Observer: **${status.enabled ? 'Enabled' : 'Disabled'}**`,
    `Automatic repair execution: **Disabled**`,
    `AI invocation path: **None**`,
    `Open incidents: **${open.length}**`,
    `Last pass: ${status.lastRunAt ? `\`${status.lastRunAt}\`` : '**Not run yet**'}`,
    '',
    ...snapshotLines(snapshot),
    '',
    '_The observer can prepare repair candidates, but it cannot call Forge AI tasks, merge, deploy, or restart Sentinel._'
  ].join('\n').slice(0, 1900);
}

function formatIncident(incident = {}) {
  const candidate = incident.repairCandidate || {};
  const statusIcon = incident.status === 'resolved' ? '✅' : '⚠️';
  const lines = [
    `${statusIcon} **${String(incident.type || 'unknown').slice(0, 80)}** • \`${String(incident.id || '').slice(0, 40)}\``,
    `Status: **${String(incident.status || 'unknown')}** • Seen: **${Number(incident.seenCount || 1)}x**`,
    `Candidate: **${String(candidate.action || 'hold')}** • AI invoked: **No**`
  ];
  if (candidate.branch) lines.push(`Branch: \`${String(candidate.branch).slice(0, 180)}\``);
  if (incident.evidence?.ref) lines.push(`Ref: \`${String(incident.evidence.ref).slice(0, 180)}\``);
  const failed = Array.isArray(incident.evidence?.failedChecks) ? incident.evidence.failedChecks : [];
  if (failed.length) lines.push(`Failed: ${failed.slice(0, 5).map((item) => `\`${String(item.name || 'check').slice(0, 80)}\``).join(', ')}`);
  return lines.join('\n');
}

function formatIncidentList(status = {}) {
  const recent = Array.isArray(status.recentIncidents) ? status.recentIncidents : [];
  if (!recent.length) {
    return '**🛡️ Nexus Self-Repair Incidents**\nNo incidents have been recorded. Observation mode has not invoked any AI repair task.';
  }
  const sections = recent.slice(0, 6).map(formatIncident);
  return ['**🛡️ Nexus Self-Repair Incidents**', ...sections.map((item) => `\n${item}`), '', '_Prepared candidates remain inert until a staff member explicitly sends work through Forge._'].join('\n').slice(0, 1900);
}

function installForgeSelfRepairExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = options.config || loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const logger = options.logger || console;
  const observer = options.observer || new ForgeSelfRepairObserver({ logger });
  activeObserver = observer;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusForgeSelfRepairLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (guildId) {
          const guild = await this.guilds.fetch(guildId);
          const definition = selfRepairCommand();
          const commandJson = normalizeRequiredOptions(definition.toJSON());
          const commands = await guild.commands.fetch();
          const existing = commands.find((item) => item.name === definition.name);
          if (existing) await guild.commands.edit(existing, commandJson);
          else await guild.commands.create(commandJson);
          logger.log?.(`[Nexus Sentinal] registered /selfrepair in guild ${guild.id}`);
        }
      } catch (error) {
        logger.warn?.(`[Nexus Sentinal] Self-Repair command registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }

      const state = observer.configuration();
      if (!state.enabled) {
        logger.log?.('[Nexus Sentinal] Self-Repair observer installed but disabled.');
        return;
      }
      observer.start();
      logger.log?.(`[Nexus Sentinal] Self-Repair observer armed: mode=observe intervalSeconds=${Math.round(state.intervalMs / 1000)} automaticExecution=false aiInvocation=false`);
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'selfrepair') return;
      try {
        if (!memberIsSelfRepairOperator(interaction, config)) {
          await interaction.reply({ content: 'Self-repair engineering controls are restricted to Nexus staff.', flags: MessageFlags.Ephemeral });
          return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          await interaction.reply({ content: formatObserverStatus(observer.status()), flags: MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'incidents') {
          await interaction.reply({ content: formatIncidentList(observer.status()), flags: MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'check') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await observer.runOnce('staff-check');
          const status = observer.status();
          await interaction.editReply({
            content: [
              formatObserverStatus(status),
              '',
              `Manual observation pass: **${result.skipped ? `Skipped (${result.reason})` : result.ok ? 'Healthy' : 'Incident detected'}**`,
              '**AI/model tokens used by this pass: 0**'
            ].join('\n').slice(0, 1900)
          });
          logger.log?.(`[Nexus Sentinal] Self-Repair staff check actor=${interaction.user.id} ok=${result.ok} skipped=${Boolean(result.skipped)} aiInvoked=false`);
        }
      } catch (error) {
        const content = `⚠️ Self-Repair observation did not complete: ${String(error?.message || error).slice(0, 1400)}`;
        logger.warn?.(`[Nexus Sentinal] Self-Repair interaction error: ${String(error?.message || error).slice(0, 400)}`);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });

    return originalLogin.apply(this, args);
  };
}

function currentForgeSelfRepairObserver() {
  return activeObserver;
}

module.exports = {
  selfRepairCommand,
  memberIsSelfRepairOperator,
  formatObserverStatus,
  formatIncident,
  formatIncidentList,
  installForgeSelfRepairExtension,
  currentForgeSelfRepairObserver
};
