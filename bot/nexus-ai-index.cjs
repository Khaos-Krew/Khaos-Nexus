'use strict';

const { randomUUID } = require('node:crypto');
const discord = require('discord.js');
const parent = process.parentPort;
const commandModule = require('./commands.cjs');

const REQUEST_TIMEOUT_MS = 18000;
const pending = new Map();
const rateBuckets = new Map();
let latestBootstrap = null;

function safeText(value, max = 1900) {
  return String(value ?? '')
    .replace(/@everyone|@here/gi, '@ disabled')
    .replace(/@/g, '@\u200b')
    .replace(/```/g, "''' ")
    .trim()
    .slice(0, max);
}

function displayTime(value) {
  if (!value) return 'Not scheduled';
  const time = Date.parse(value);
  return Number.isFinite(time) ? `<t:${Math.floor(time / 1000)}:R>` : 'Unavailable';
}

function moduleEnabled(id) {
  const state = latestBootstrap?.config?.moduleRuntime?.[id];
  return state ? Boolean(state.effectiveEnabled) : true;
}

function installCommand() {
  const original = commandModule.createCommands;
  if (original.__khaosNexusAiOperations) return;
  const wrapped = function createCommandsWithNexus(options = {}) {
    const values = original(options);
    const enabled = options.isModuleEnabled?.('discord-runtime') !== false && options.isModuleEnabled?.('nexus-ai-core') !== false;
    if (!enabled || values.some((command) => command.name === 'nexus')) return values;
    const command = new discord.SlashCommandBuilder()
      .setName('nexus')
      .setDescription('Use the supervised Nexus AI Core without granting it execution authority.')
      .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show Nexus AI runtime and monitor status.'))
      .addSubcommand((subcommand) => subcommand.setName('ask').setDescription('Ask Nexus AI for bounded advisory help.')
        .addStringOption((option) => option.setName('prompt').setDescription('Question for Nexus AI').setRequired(true).setMaxLength(1000)))
      .addSubcommand((subcommand) => subcommand.setName('updates').setDescription('Review recent update-monitor checks.')
        .addIntegerOption((option) => option.setName('limit').setDescription('Number of recent checks').setMinValue(1).setMaxValue(10)))
      .addSubcommand((subcommand) => subcommand.setName('check').setDescription('Run a review-only update check now.'))
      .addSubcommand((subcommand) => subcommand.setName('plan').setDescription('Create an advisory-only maintenance plan.')
        .addStringOption((option) => option.setName('finding').setDescription('Observed issue or maintenance need').setRequired(true).setMaxLength(1500)))
      .addSubcommand((subcommand) => subcommand.setName('subscribe').setDescription('Save a review-only update source subscription.')
        .addStringOption((option) => option.setName('provider').setDescription('Update provider').setRequired(true).addChoices(
          { name: 'GitHub Releases', value: 'github-release' },
          { name: 'Modrinth Project', value: 'modrinth-project' },
          { name: 'CurseForge Mod', value: 'curseforge-mod' },
          { name: 'Steam News', value: 'steam-news' }
        ))
        .addStringOption((option) => option.setName('target').setDescription('owner/repo, project slug, mod ID, or Steam app ID').setRequired(true).setMaxLength(200)))
      .addSubcommand((subcommand) => subcommand.setName('unsubscribe').setDescription('Remove your review-only subscription for a source.')
        .addStringOption((option) => option.setName('source').setDescription('Saved source ID').setRequired(true).setMaxLength(100)));
    return [...values, command.toJSON()];
  };
  Object.defineProperty(wrapped, '__khaosNexusAiOperations', { value: true });
  commandModule.createCommands = wrapped;
}

function configuredOwnerId() {
  return String(latestBootstrap?.config?.discord?.ownerUserId || '');
}

function isOwnerOrAdministrator(interaction) {
  if (configuredOwnerId() && interaction.user?.id === configuredOwnerId()) return true;
  return Boolean(interaction.memberPermissions?.has(discord.PermissionFlagsBits.Administrator));
}

function assertAuthorizedChannel(interaction) {
  if (!interaction.guildId || !interaction.channelId) throw new Error('Use /nexus inside an authorized Discord server channel.');
  const configuredGuild = String(latestBootstrap?.config?.discord?.guildId || '');
  if (configuredGuild && interaction.guildId !== configuredGuild) throw new Error('This Discord server is not authorized for Khaos Nexus commands.');
  if (!moduleEnabled('discord-runtime') || !moduleEnabled('nexus-ai-core')) throw new Error('Nexus AI commands are disabled by the current module policy.');
}

function assertRateLimit(interaction, action) {
  const limits = { status: 12, updates: 12, ask: 6, check: 3, plan: 3, subscribe: 5, unsubscribe: 5 };
  const key = `${interaction.user.id}:${action}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > (limits[action] || 5)) throw new Error('That Nexus AI command is rate-limited. Try again in a moment.');
}

function actor(interaction) {
  return {
    userId: interaction.user?.id || '',
    username: safeText(interaction.user?.globalName || interaction.user?.username || 'Discord user', 100),
    guildId: interaction.guildId || '',
    channelId: interaction.channelId || '',
    administrator: Boolean(interaction.memberPermissions?.has(discord.PermissionFlagsBits.Administrator))
  };
}

function requestMain(action, input, interaction) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The Khaos Nexus desktop did not answer the Nexus AI request in time.'));
    }, REQUEST_TIMEOUT_MS);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    parent?.postMessage({
      type: 'nexus-ai-request',
      payload: { id, action, input, actor: actor(interaction) }
    });
  });
}

function unwrap(response) {
  return response?.result ?? response;
}

function contentFromAi(value) {
  const result = unwrap(value);
  const content = result?.content ?? result?.response?.content ?? result?.message ?? result;
  if (Array.isArray(content)) return safeText(content.map((item) => typeof item === 'string' ? item : item?.text || item?.content || '').filter(Boolean).join('\n'), 1850);
  if (typeof content === 'string') return safeText(content, 1850);
  return safeText(JSON.stringify(content, null, 2), 1850);
}

function formatStatus(value) {
  const result = unwrap(value);
  const runtime = result?.service?.runtime || {};
  const settings = result?.settings || {};
  const sourceCount = Array.isArray(result?.sources) ? result.sources.length : Number(result?.coreState?.sourceCount || 0);
  return [
    '**Nexus AI Core**',
    `Runtime: **${safeText(runtime.status || (result?.service?.ready ? 'ready' : 'unavailable'), 60)}**`,
    `Service: **${result?.service?.ready ? 'ready' : 'not ready'}**${result?.service?.version ? ` · v${safeText(result.service.version, 30)}` : ''}`,
    `Update monitor: **${settings.enabled ? 'enabled' : 'disabled'}** · ${sourceCount} source${sourceCount === 1 ? '' : 's'}`,
    `Last check: ${displayTime(settings.lastRunAt)} · **${safeText(settings.lastOutcome || 'never', 30)}**`,
    `Next check: ${displayTime(settings.nextRunAt)}`,
    '',
    '_Advisory only. No Discord, game-server, updater, scheduler, permission, download, or maintenance action can execute from Nexus AI output._'
  ].join('\n');
}

function formatUpdates(value) {
  const result = unwrap(value);
  const history = Array.isArray(result?.history) ? result.history : [];
  if (!history.length) return 'No Nexus AI update checks have been recorded yet.';
  return history.map((entry) => {
    const time = entry.completedAt || entry.startedAt;
    return `• ${displayTime(time)} · **${safeText(entry.outcome, 20)}** · ${safeText(entry.summary || entry.error || 'No summary', 280)}`;
  }).join('\n').slice(0, 1850);
}

function formatCheck(value) {
  const result = unwrap(value);
  const entry = result?.entry || {};
  return [
    '**Nexus AI update check complete**',
    `Outcome: **${safeText(entry.outcome || 'unknown', 30)}**`,
    safeText(entry.summary || 'The check completed without a summary.', 500),
    entry.error ? `Error: ${safeText(entry.error, 500)}` : null,
    '',
    '_Results were retained for review and were not announced publicly or executed automatically._'
  ].filter(Boolean).join('\n');
}

function formatPlan(value) {
  const result = unwrap(value);
  const plan = result?.plan ?? result;
  const summary = plan?.summary || plan?.title || plan?.overview;
  const steps = Array.isArray(plan?.steps) ? plan.steps.slice(0, 8).map((step, index) => `${index + 1}. ${safeText(step?.description || step?.title || step, 220)}`) : [];
  return [
    '**Advisory maintenance plan**',
    summary ? safeText(summary, 700) : safeText(JSON.stringify(plan, null, 2), 1200),
    ...steps,
    '',
    '_Execution is disabled. Review and perform any approved action through the normal Khaos Nexus controls._'
  ].join('\n').slice(0, 1850);
}

function formatSubscription(value, removed = false) {
  const result = unwrap(value);
  if (removed) return `${Number(result?.removed || 0)} review-only Nexus AI subscription${Number(result?.removed || 0) === 1 ? '' : 's'} removed.`;
  return [
    `Saved **${safeText(result?.source?.id || 'source', 100)}** as a review-only subscription for this channel.`,
    '_Scheduled checks remain private in Khaos Nexus; this does not enable automatic public announcements._'
  ].join('\n');
}

async function replyError(interaction, error) {
  const payload = { content: safeText(error?.message || 'Nexus AI request failed.', 1800), ephemeral: true, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
}

async function handleNexus(interaction) {
  try {
    assertAuthorizedChannel(interaction);
    const action = interaction.options.getSubcommand();
    assertRateLimit(interaction, action);
    if (['check', 'plan', 'subscribe', 'unsubscribe'].includes(action) && !isOwnerOrAdministrator(interaction)) {
      throw new Error('This Nexus AI command requires the configured Owner or a Discord administrator.');
    }
    await interaction.deferReply({ ephemeral: true });
    let input = {};
    if (action === 'ask') input.prompt = interaction.options.getString('prompt', true);
    if (action === 'updates') input.limit = interaction.options.getInteger('limit') || 5;
    if (action === 'plan') input.finding = interaction.options.getString('finding', true);
    if (action === 'subscribe') {
      input.provider = interaction.options.getString('provider', true);
      input.target = interaction.options.getString('target', true);
    }
    if (action === 'unsubscribe') input.sourceId = interaction.options.getString('source', true);
    const response = await requestMain(action, input, interaction);
    let content;
    if (action === 'status') content = formatStatus(response);
    else if (action === 'ask') content = contentFromAi(response);
    else if (action === 'updates') content = formatUpdates(response);
    else if (action === 'check') content = formatCheck(response);
    else if (action === 'plan') content = formatPlan(response);
    else if (action === 'subscribe') content = formatSubscription(response);
    else content = formatSubscription(response, true);
    await interaction.editReply({ content: safeText(content, 1900), allowedMentions: { parse: [] } });
  } catch (error) {
    await replyError(interaction, error);
  }
}

function installClientInterceptor() {
  const prototype = discord.Client?.prototype;
  if (!prototype || prototype.__khaosNexusAiOperations) return;
  const originalEmit = prototype.emit;
  prototype.emit = function nexusAiInteractionInterceptor(eventName, ...args) {
    const interaction = args[0];
    if (eventName === discord.Events.InteractionCreate && interaction?.isChatInputCommand?.() && interaction.commandName === 'nexus') {
      void handleNexus(interaction);
      return true;
    }
    return originalEmit.call(this, eventName, ...args);
  };
  Object.defineProperty(prototype, '__khaosNexusAiOperations', { value: true });
}

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap' || message?.type === 'config-update') latestBootstrap = message.payload || {};
  if (message?.type === 'nexus-ai-response') {
    const response = message.payload || {};
    const waiting = pending.get(response.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.value);
    else waiting.reject(Object.assign(new Error(safeText(response.error || 'Nexus AI request failed.', 500)), { code: response.code || 'NEXUS_AI_REQUEST_FAILED' }));
  }
  if (message?.type === 'shutdown') {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('The Khaos Nexus bot is shutting down.'));
    }
    pending.clear();
  }
});

installCommand();
installClientInterceptor();
require('./dual-ai-index.cjs');

module.exports = { handleNexus, requestMain, safeText };
