'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { ForgeSelfRepairObserver } = require('./forge-self-repair-observer.cjs');
const { ForgeSelfRepairNotifier } = require('./forge-self-repair-notifier.cjs');

const INSTALLED = Symbol.for('khaos.nexus.forge.self.repair.extension');
let activeObserver = null;

function incidentStringOption(option, description = 'Self-Repair incident ID') {
  return option
    .setName('incident')
    .setDescription(description)
    .setRequired(true)
    .setMaxLength(24);
}

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
      .setDescription('Show recent incidents and prepared repair candidates'))
    .addSubcommand((sub) => sub
      .setName('detail')
      .setDescription('Show one incident and its current policy decision')
      .addStringOption((opt) => incidentStringOption(opt)))
    .addSubcommand((sub) => sub
      .setName('ack')
      .setDescription('Acknowledge an open incident without resolving it')
      .addStringOption((opt) => incidentStringOption(opt))
      .addStringOption((opt) => opt
        .setName('note')
        .setDescription('Optional staff note')
        .setRequired(false)
        .setMaxLength(300)))
    .addSubcommand((sub) => sub
      .setName('snooze')
      .setDescription('Temporarily suppress an open incident handoff')
      .addStringOption((opt) => incidentStringOption(opt))
      .addIntegerOption((opt) => opt
        .setName('minutes')
        .setDescription('Snooze duration in minutes')
        .setRequired(true)
        .setMinValue(5)
        .setMaxValue(10080)))
    .addSubcommand((sub) => sub
      .setName('unsnooze')
      .setDescription('Remove an incident snooze')
      .addStringOption((opt) => incidentStringOption(opt)))
    .addSubcommand((sub) => sub
      .setName('prepare')
      .setDescription('Prepare the manual Forge handoff for an incident')
      .addStringOption((opt) => incidentStringOption(opt)))
    .addSubcommand((sub) => sub
      .setName('verify')
      .setDescription('Run zero-AI health and CI verification for an incident')
      .addStringOption((opt) => incidentStringOption(opt))
      .addStringOption((opt) => opt
        .setName('branch')
        .setDescription('Optional forge/* branch to include in CI verification')
        .setRequired(false)
        .setMaxLength(240)))
    .addSubcommand((sub) => sub
      .setName('policy')
      .setDescription('Show the hard Self-Repair safety policy'));
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
  if (snapshot.runtime) add('Sentinel Runtime', snapshot.runtime);
  if (snapshot.ci?.ref) lines.push(`CI ref: \`${String(snapshot.ci.ref).slice(0, 200)}\``);
  if (snapshot.ci?.sha) lines.push(`CI commit: \`${String(snapshot.ci.sha).slice(0, 12)}\``);
  const memory = snapshot.runtime?.process?.memory;
  if (memory) lines.push(`Runtime memory: **${Number(memory.rssMb || 0).toLocaleString()} MB RSS** • ${Number(memory.heapUsedMb || 0).toLocaleString()} MB heap used`);
  return lines;
}

function formatObserverStatus(status = {}) {
  const open = Array.isArray(status.openIncidents) ? status.openIncidents : [];
  const snapshot = status.lastSnapshot || {};
  return [
    '**🛡️ Nexus Self-Repair**',
    'Mode: **OBSERVE / MANUAL HANDOFF ONLY**',
    `Observer: **${status.enabled ? 'Enabled' : 'Disabled'}**`,
    'Automatic planning: **Disabled**',
    'Automatic repair execution: **Disabled**',
    'Automatic merge/deploy/restart: **Disabled**',
    `Open incidents: **${open.length}**`,
    `Last pass: ${status.lastRunAt ? `\`${status.lastRunAt}\`` : '**Not run yet**'}`,
    '',
    ...snapshotLines(snapshot),
    '',
    '_The observer may prepare a manual Forge handoff, but it cannot call a model task, merge, deploy, or restart anything._'
  ].join('\n').slice(0, 1900);
}

function formatIncident(incident = {}) {
  const candidate = incident.repairCandidate || {};
  const statusIcon = incident.status === 'resolved' ? '✅' : '⚠️';
  const lines = [
    `${statusIcon} **${String(incident.type || 'unknown').slice(0, 80)}** • \`${String(incident.id || '').slice(0, 40)}\``,
    `Status: **${String(incident.status || 'unknown')}** • Severity: **${String(incident.severity || 'medium').toUpperCase()}** • Risk: **${String(incident.risk || 'none').toUpperCase()}**`,
    `Seen: **${Number(incident.seenCount || 1)}x** • Occurrences: **${Number(incident.occurrenceCount || 1)}**`,
    `Candidate: **${String(candidate.action || 'hold')}** • AI invoked: **No**`
  ];
  if (incident.acknowledgedAt) lines.push(`Acknowledged: \`${String(incident.acknowledgedAt).slice(0, 40)}\``);
  if (incident.snoozedUntil) lines.push(`Snoozed until: \`${String(incident.snoozedUntil).slice(0, 40)}\``);
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

function formatIncidentDetail(incident = {}) {
  const decision = incident.policyDecision || {};
  const evidence = incident.evidence || {};
  const lines = [
    '**🛡️ Self-Repair Incident Detail**',
    formatIncident(incident),
    '',
    `Manual handoff allowed: **${decision.mayPrepareManualHandoff ? 'Yes' : 'No'}**`,
    `Zero-AI verification allowed: **${decision.mayRunZeroAiVerification === false ? 'No' : 'Yes'}**`,
    `Staff confirmation required: **Yes**`
  ];
  if (decision.blockers?.length) lines.push(`Policy blockers: ${decision.blockers.map((item) => `\`${String(item)}\``).join(', ')}`);
  if (evidence.error) lines.push(`Evidence: ${String(evidence.error).slice(0, 500)}`);
  if (incident.acknowledgementNote) lines.push(`Staff note: ${String(incident.acknowledgementNote).slice(0, 300)}`);
  if (incident.verification) {
    lines.push(`Last verification: **${incident.verification.complete ? 'Complete' : incident.verification.passed ? 'Pass pending threshold' : 'Not clear'}** at \`${String(incident.verification.checkedAt || '').slice(0, 40)}\``);
  }
  return lines.join('\n').slice(0, 1900);
}

function formatPreparedHandoff(prepared = {}) {
  const incident = prepared.incident || {};
  const candidate = prepared.candidate || {};
  const decision = prepared.decision || {};
  const lines = [
    '**🧰 Self-Repair Manual Handoff**',
    `Incident: \`${String(incident.id || '').slice(0, 40)}\``,
    `Candidate: **${String(candidate.action || 'hold')}**`,
    'AI/model task invoked by preparation: **No**',
    'Automatic execution: **Disabled**'
  ];
  if (!prepared.handoff) {
    lines.push(`Policy blockers: ${(decision.blockers || ['hold-only']).map((item) => `\`${String(item)}\``).join(', ')}`);
    if (candidate.goal) lines.push('', '**Recommended investigation**', String(candidate.goal).slice(0, 1050));
    return lines.join('\n').slice(0, 1900);
  }
  lines.push(`Next staff action: **/${prepared.handoff.command}**`);
  if (prepared.handoff.branch) lines.push(`Branch: \`${String(prepared.handoff.branch).slice(0, 200)}\``);
  lines.push('', '**Prepared goal**', String(prepared.handoff.goal || '').slice(0, 1150));
  lines.push('', '_This only prepares the handoff. The existing /forge confirmation gate still controls any model-backed execution._');
  return lines.join('\n').slice(0, 1900);
}

function formatVerification(result = {}) {
  const verification = result.incident?.verification || {};
  const lines = [
    '**🔎 Self-Repair Verification**',
    `Incident: \`${String(result.incident?.id || '').slice(0, 40)}\``,
    `Original condition cleared: **${verification.conditionCleared ? 'Yes' : 'No'}**`,
    `Verification pass: **${result.passed ? 'Yes' : 'No'}**`,
    `Required passes: **${Number(verification.consecutivePasses || 0)}/${Number(verification.requiredPasses || 1)}**`,
    `Complete: **${result.complete ? 'Yes' : 'No'}**`,
    'AI/model tokens used: **0**'
  ];
  if (result.branchCi) {
    lines.push(`Branch CI: **${result.branchCi.ok ? 'Healthy' : 'Not healthy'}** • \`${String(result.branchCi.ref || '').slice(0, 180)}\`` • ${String(result.branchCi.state || 'unknown').toUpperCase()}`);
    if (result.branchCi.failedChecks?.length) lines.push(`Failed checks: ${result.branchCi.failedChecks.slice(0, 5).map((item) => `\`${String(item.name || 'check').slice(0, 80)}\``).join(', ')}`);
  }
  return lines.join('\n').slice(0, 1900);
}

function formatPolicy(policy = {}, notifier = {}) {
  return [
    '**🔒 Nexus Self-Repair Safety Policy**',
    `Execution mode: **${String(policy.executionMode || 'manual-confirmation-only')}**`,
    'Automatic planning: **Disabled**',
    'Automatic repair execution: **Disabled**',
    'Automatic PR merge: **Disabled**',
    'Automatic deployment: **Disabled**',
    'Automatic Sentinel/game-server restart: **Disabled**',
    'Staff confirmation: **Required**',
    `Verification passes required: **${Number(policy.verificationPassesRequired || 1)}**`,
    `Max snooze: **${Number(policy.maxSnoozeMinutes || 0).toLocaleString()} minutes**`,
    `RSS warning threshold: **${Number(policy.rssWarnMb || 0) > 0 ? `${Number(policy.rssWarnMb).toLocaleString()} MB` : 'Disabled'}**`,
    `Discord incident alerts: **${notifier.enabled && notifier.channelConfigured ? 'Enabled' : 'Disabled'}**`,
    '',
    '_These boundaries are enforced in code; they are not prompt-only instructions._'
  ].join('\n').slice(0, 1900);
}

function installForgeSelfRepairExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = options.config || loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const logger = options.logger || console;
  const observer = options.observer || new ForgeSelfRepairObserver({ logger });
  const notifier = options.notifier || new ForgeSelfRepairNotifier({ logger });
  activeObserver = observer;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusForgeSelfRepairLogin(...args) {
    const client = this;
    observer.setIncidentChangeHandler((event, incident) => notifier.notify(client, event === 'opened' ? 'opened' : 'resolved', incident));

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
      const alertState = notifier.configuration();
      if (!state.enabled) {
        logger.log?.('[Nexus Sentinal] Self-Repair observer installed but disabled.');
        return;
      }
      observer.start();
      logger.log?.(`[Nexus Sentinal] Self-Repair observer armed: mode=observe intervalSeconds=${Math.round(state.intervalMs / 1000)} automaticExecution=false aiInvocation=false alerts=${alertState.enabled && alertState.channelConfigured}`);
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
        if (sub === 'policy') {
          await interaction.reply({ content: formatPolicy(observer.policyStatus(), notifier.configuration()), flags: MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'detail') {
          const id = interaction.options.getString('incident', true);
          const incident = observer.status().recentIncidents.find((item) => item.id === String(id).trim().toUpperCase());
          await interaction.reply({ content: incident ? formatIncidentDetail(incident) : 'That Self-Repair incident was not found.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'ack') {
          const id = interaction.options.getString('incident', true);
          const note = interaction.options.getString('note', false) || '';
          const incident = observer.acknowledgeIncident(id, interaction.user.id, note);
          await interaction.reply({ content: `✅ Acknowledged \`${incident.id}\`. The incident remains open until the observed condition actually clears.`, flags: MessageFlags.Ephemeral });
          logger.log?.(`[Nexus Sentinal] Self-Repair acknowledge actor=${interaction.user.id} incident=${incident.id}`);
          return;
        }
        if (sub === 'snooze') {
          const id = interaction.options.getString('incident', true);
          const minutes = interaction.options.getInteger('minutes', true);
          const result = observer.snoozeIncident(id, minutes, interaction.user.id);
          await interaction.reply({ content: `💤 Snoozed \`${result.incident.id}\` for **${result.minutes} minutes** (until \`${result.until}\`). Observation continues; only the manual handoff is suppressed.`, flags: MessageFlags.Ephemeral });
          logger.log?.(`[Nexus Sentinal] Self-Repair snooze actor=${interaction.user.id} incident=${result.incident.id} minutes=${result.minutes}`);
          return;
        }
        if (sub === 'unsnooze') {
          const id = interaction.options.getString('incident', true);
          const incident = observer.unsnoozeIncident(id, interaction.user.id);
          await interaction.reply({ content: `✅ Snooze removed from \`${incident.id}\`.`, flags: MessageFlags.Ephemeral });
          logger.log?.(`[Nexus Sentinal] Self-Repair unsnooze actor=${interaction.user.id} incident=${incident.id}`);
          return;
        }
        if (sub === 'prepare') {
          const id = interaction.options.getString('incident', true);
          const prepared = observer.prepareIncident(id);
          await interaction.reply({ content: formatPreparedHandoff(prepared), flags: MessageFlags.Ephemeral });
          logger.log?.(`[Nexus Sentinal] Self-Repair handoff prepared actor=${interaction.user.id} incident=${prepared.incident.id} candidate=${prepared.candidate.action || 'hold'} aiInvoked=false`);
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
          return;
        }
        if (sub === 'verify') {
          const id = interaction.options.getString('incident', true);
          const branch = interaction.options.getString('branch', false) || '';
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await observer.verifyIncident(id, { actorId: interaction.user.id, branch });
          await interaction.editReply({ content: formatVerification(result) });
          logger.log?.(`[Nexus Sentinal] Self-Repair verify actor=${interaction.user.id} incident=${result.incident.id} passed=${result.passed} complete=${result.complete} aiInvoked=false`);
        }
      } catch (error) {
        const content = `⚠️ Self-Repair operation did not complete: ${String(error?.message || error).slice(0, 1400)}`;
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
  formatIncidentDetail,
  formatPreparedHandoff,
  formatVerification,
  formatPolicy,
  installForgeSelfRepairExtension,
  currentForgeSelfRepairObserver
};
