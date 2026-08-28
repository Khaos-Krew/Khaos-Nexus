'use strict';

const crypto = require('node:crypto');
const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { ForgeClient } = require('./forge-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.forge.extension');
const PENDING_TTL_MS = 5 * 60 * 1000;

function forgeCommand() {
  return new SlashCommandBuilder()
    .setName('forge')
    .setDescription('Khaos Nexus Forge engineering controls')
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Check the Sentinel to Forge bridge and Forge runtime'))
    .addSubcommand((sub) => sub
      .setName('ci')
      .setDescription('Check Forge branch CI without using an AI model')
      .addStringOption((opt) => opt
        .setName('branch')
        .setDescription('Forge branch or repository ref to inspect')
        .setRequired(true)
        .setMaxLength(240)))
    .addSubcommand((sub) => sub
      .setName('plan')
      .setDescription('Ask Forge for a read-only engineering plan')
      .addStringOption((opt) => opt
        .setName('goal')
        .setDescription('What should Forge investigate or design?')
        .setRequired(true)
        .setMaxLength(2000)))
    .addSubcommand((sub) => sub
      .setName('build')
      .setDescription('Ask Forge to implement work on a guarded forge/* branch')
      .addStringOption((opt) => opt
        .setName('goal')
        .setDescription('What should Forge build or repair?')
        .setRequired(true)
        .setMaxLength(2000)))
    .addSubcommand((sub) => sub
      .setName('repair')
      .setDescription('Resume a Forge branch, inspect its CI, and repair failures')
      .addStringOption((opt) => opt
        .setName('branch')
        .setDescription('Existing guarded forge/* branch')
        .setRequired(true)
        .setMaxLength(240))
      .addStringOption((opt) => opt
        .setName('goal')
        .setDescription('Optional repair guidance; defaults to repairing failed CI')
        .setRequired(false)
        .setMaxLength(1600)));
}

function memberIsForgeOperator(interaction, config) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user?.id || ''))) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = interaction.member?.roles?.cache;
  return Boolean(roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id))));
}

function bridgeStatusText(forge, health = null) {
  const configured = forge.configuration();
  const lines = [
    '**🔥 Khaos Nexus Forge Bridge**',
    `Bridge: **${configured.enabled ? 'Enabled' : 'Disabled'}**`,
    `Endpoint: **${configured.baseUrlConfigured ? 'Configured' : 'Missing'}**`,
    `Service token: **${configured.tokenConfigured ? 'Configured' : 'Missing'}**`,
    `Repository: \`${configured.defaultRepo}\``,
    `Base ref: \`${configured.defaultBaseRef}\``
  ];
  if (health) {
    lines.push(
      '',
      `Forge runtime: **${health.ok ? 'Online' : 'Unavailable'}**`,
      `Version: \`${health.version}\``,
      `OpenAI: **${health.openaiConfigured ? 'Configured' : 'Missing'}**`,
      `GitHub execution: **${health.githubConfigured ? 'Configured' : 'Missing'}**`,
      `Fallback routing: **${String(health.fallbackRouting || 'unknown')}**`,
      `Write policy: \`${health.writePolicy}\``
    );
  }
  return lines.join('\n');
}

function formatForgeResult(result) {
  const lines = [
    `**🔥 Forge ${result.mode === 'execute' ? 'Build' : 'Plan'} • ${result.status}**`,
    `Repository: \`${result.repo}\``,
    `Base: \`${result.baseRef}\``
  ];
  if (result.branch) lines.push(`Branch: \`${result.branch}\``);
  if (result.modelRoute) lines.push(`Model route: \`${String(result.modelRoute).slice(0, 100)}\``);
  if (result.usage) {
    lines.push(
      `Usage: **${result.usage.totalTokens.toLocaleString()} tokens** • ${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out • ${result.usage.requests.toLocaleString()} requests`
    );
  }
  if (result.output) lines.push('', String(result.output).slice(0, 1350));
  return lines.join('\n').slice(0, 1900);
}

function formatCiStatus(result) {
  const state = String(result?.state || 'unknown').toLowerCase();
  const icon = state === 'success' ? '✅' : state === 'failure' ? '❌' : state === 'pending' ? '⏳' : '❔';
  const failed = (result?.checkRuns || []).filter((item) => {
    const conclusion = String(item?.conclusion || '').toLowerCase();
    return ['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(conclusion);
  });
  const pending = (result?.checkRuns || []).filter((item) => {
    const status = String(item?.status || '').toLowerCase();
    return ['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(status);
  });
  const lines = [
    `**${icon} Forge CI • ${state.toUpperCase()}**`,
    `Ref: \`${result?.ref || 'unknown'}\``,
    `Commit: \`${String(result?.sha || 'unknown').slice(0, 12)}\``,
    `Checks: **${(result?.checkRuns || []).length}** • Failed: **${failed.length}** • Pending: **${pending.length}**`,
    '_This check does not invoke an AI model._'
  ];
  if (failed.length) {
    lines.push('', '**Failed checks**');
    for (const item of failed.slice(0, 8)) lines.push(`• ${String(item?.name || 'unnamed check').slice(0, 120)}`);
  } else if (pending.length) {
    lines.push('', '**Pending checks**');
    for (const item of pending.slice(0, 8)) lines.push(`• ${String(item?.name || 'unnamed check').slice(0, 120)}`);
  }
  return lines.join('\n').slice(0, 1900);
}

function buildConstraints(actorId) {
  return [
    'Do not merge pull requests or deploy production from this task.',
    'Keep all repository writes inside the Forge guarded forge/* branch and finish with a draft PR.',
    'Preserve existing Nexus security, permission, provider-neutral, and secret-redaction boundaries.',
    'Run or update relevant tests when practical and report anything that could not be validated.',
    `Sentinel request actor: Discord user ${String(actorId)}`
  ];
}

function confirmationPayload(nonce, goal, branch = null) {
  const title = branch ? 'Repair existing Forge branch?' : 'Send build task to Khaos Nexus Forge?';
  const scope = branch
    ? `Existing branch: \`${branch}\`\nForge will inspect current CI evidence before changing code.`
    : 'Forge may create/update a guarded `forge/*` branch and a **draft PR**.';
  return {
    content: [
      `⚠️ **${title}**`,
      String(goal).slice(0, 1100),
      '',
      scope,
      'It still cannot merge or deploy production.'
    ].join('\n'),
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: branch ? 'Repair Branch' : 'Send to Forge', custom_id: `nexusforge:confirm:${nonce}` },
        { type: 2, style: 2, label: 'Cancel', custom_id: `nexusforge:cancel:${nonce}` }
      ]
    }],
    flags: MessageFlags.Ephemeral
  };
}

function validForgeBranch(value) {
  const branch = String(value || '').trim();
  if (!/^forge\/[A-Za-z0-9._/-]+$/.test(branch)) return false;
  const segments = branch.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  if (branch.endsWith('.') || branch.includes('..') || branch.includes('@{') || branch.endsWith('.lock')) return false;
  return true;
}

function installForgeExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const logger = options.logger || console;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const forge = options.forge || new ForgeClient();
  const pending = new Map();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusForgeLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = forgeCommand();
        const commandJson = normalizeRequiredOptions(definition.toJSON());
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, commandJson);
        else await guild.commands.create(commandJson);
        logger.log?.(`[Nexus Sentinal] registered /forge in guild ${guild.id}`);
      } catch (error) {
        logger.error?.(`[Nexus Sentinal] Forge command registration failed: ${String(error?.message || error).slice(0, 400)}`);
      }

      const state = forge.configuration();
      if (!state.enabled) {
        logger.log?.('[Nexus Sentinal] Forge bridge installed but disabled.');
        return;
      }
      try {
        const health = await forge.health();
        logger.log?.(`[Nexus Sentinal] Forge bridge health: ok=${health.ok} version=${health.version} openai=${health.openaiConfigured} github=${health.githubConfigured} fallback=${health.fallbackRouting} policy=${health.writePolicy}`);
      } catch (error) {
        logger.warn?.(`[Nexus Sentinal] Forge bridge health unavailable: ${String(error?.message || error).slice(0, 300)}`);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      const isCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'forge';
      const isButton = interaction.isButton?.() && String(interaction.customId || '').startsWith('nexusforge:');
      if (!isCommand && !isButton) return;

      try {
        if (!memberIsForgeOperator(interaction, config)) {
          await interaction.reply({ content: 'Forge engineering controls are restricted to Nexus staff.', flags: MessageFlags.Ephemeral });
          return;
        }

        if (isButton) {
          const [, action, nonce] = String(interaction.customId).split(':');
          const task = pending.get(nonce);
          if (!task || task.expiresAt < Date.now()) {
            pending.delete(nonce);
            await interaction.update({ content: 'That Forge build confirmation expired.', components: [] });
            return;
          }
          if (String(task.userId) !== String(interaction.user.id)) {
            await interaction.reply({ content: 'Only the staff member who requested this Forge task can confirm it.', flags: MessageFlags.Ephemeral });
            return;
          }
          if (action === 'cancel') {
            pending.delete(nonce);
            await interaction.update({ content: 'Forge build cancelled.', components: [] });
            return;
          }
          if (action !== 'confirm') return;

          pending.delete(nonce);
          await interaction.update({ content: task.branch ? '🛠️ Sending CI-aware branch repair to Khaos Nexus Forge…' : '🔥 Sending the guarded build task to Khaos Nexus Forge…', components: [] });
          const result = await forge.execute(task.goal, {
            branch: task.branch || undefined,
            constraints: buildConstraints(interaction.user.id)
          });
          await interaction.editReply({ content: formatForgeResult(result), components: [] });
          logger.log?.(`[Nexus Sentinal] Forge execute actor=${interaction.user.id} status=${result.status} branch=${result.branch || 'none'} repair=${Boolean(task.branch)} route=${result.modelRoute || 'unknown'} tokens=${result.usage?.totalTokens || 0}`);
          return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          const configured = forge.configuration();
          if (!configured.enabled || !configured.baseUrlConfigured) {
            await interaction.reply({ content: bridgeStatusText(forge), flags: MessageFlags.Ephemeral });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          let health = null;
          try { health = await forge.health(); } catch {}
          await interaction.editReply({ content: bridgeStatusText(forge, health) });
          return;
        }

        if (sub === 'ci') {
          const ref = String(interaction.options.getString('branch', true)).trim();
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await forge.ciStatus(ref);
          await interaction.editReply({ content: formatCiStatus(result) });
          logger.log?.(`[Nexus Sentinal] Forge CI actor=${interaction.user.id} ref=${ref} state=${result.state}`);
          return;
        }

        if (sub === 'plan') {
          const goal = String(interaction.options.getString('goal', true)).trim();
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await forge.plan(goal, {
            constraints: buildConstraints(interaction.user.id)
          });
          await interaction.editReply({ content: formatForgeResult(result) });
          logger.log?.(`[Nexus Sentinal] Forge plan actor=${interaction.user.id} status=${result.status} route=${result.modelRoute || 'unknown'} tokens=${result.usage?.totalTokens || 0}`);
          return;
        }

        if (sub === 'build') {
          const goal = String(interaction.options.getString('goal', true)).trim();
          const nonce = crypto.randomBytes(12).toString('hex');
          pending.set(nonce, {
            userId: String(interaction.user.id),
            goal,
            branch: null,
            expiresAt: Date.now() + PENDING_TTL_MS
          });
          await interaction.reply(confirmationPayload(nonce, goal));
          return;
        }

        if (sub === 'repair') {
          const branch = String(interaction.options.getString('branch', true)).trim();
          if (!validForgeBranch(branch)) {
            await interaction.reply({ content: 'Forge repair can resume only a valid existing `forge/*` branch.', flags: MessageFlags.Ephemeral });
            return;
          }
          const guidance = String(interaction.options.getString('goal', false) || '').trim();
          const goal = guidance || `Inspect the current CI/check results for ${branch}. Diagnose failed checks, make the smallest safe repair on this exact branch, review the changes, and update the existing draft PR. If checks are pending or there is no actionable failure evidence, do not invent a repair.`;
          const nonce = crypto.randomBytes(12).toString('hex');
          pending.set(nonce, {
            userId: String(interaction.user.id),
            goal,
            branch,
            expiresAt: Date.now() + PENDING_TTL_MS
          });
          await interaction.reply(confirmationPayload(nonce, goal, branch));
        }
      } catch (error) {
        const content = `⚠️ Forge request did not complete: ${String(error?.message || error).slice(0, 1500)}`;
        logger.error?.(`[Nexus Sentinal] Forge bridge request failed: ${String(error?.message || error).slice(0, 500)}`);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch {}
      }
    });

    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [nonce, task] of pending) if (task.expiresAt < now) pending.delete(nonce);
    }, 60_000);
    cleanup.unref?.();

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  forgeCommand,
  memberIsForgeOperator,
  bridgeStatusText,
  formatForgeResult,
  formatCiStatus,
  buildConstraints,
  validForgeBranch,
  installForgeExtension
};
