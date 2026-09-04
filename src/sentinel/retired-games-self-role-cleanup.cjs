'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { RETIRED_MODULE_IDS, retireSentinelModuleRegistry } = require('./retired-module-policy.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const FRIENDLY_POLICY_APPLIED = Symbol.for('khaos.nexus.retiredFriendlyCommandPolicy.applied');
const RETIRED_GAMES_MARKER_PREFIX = 'nexus-sentinal:self-role:games';
const RETIRED_COMMAND_CLEANUP_DELAY_MS = 5_000;
const STARTUP_TASK_ID = 'retired-module-cleanup';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function footerTexts(message) {
  return (message?.embeds || []).map((embed) => String(embed?.footer?.text || '')).filter(Boolean);
}

function isRetiredGamesSelfRoleMessage(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return footerTexts(message).some((text) => text.toLowerCase().startsWith(RETIRED_GAMES_MARKER_PREFIX));
}

function findRolesChannel(channels, configuredChannelId = '') {
  const list = valuesOf(channels);
  if (configuredChannelId) {
    const configured = list.find((channel) => String(channel?.id || '') === String(configuredChannelId));
    if (configured?.isTextBased?.()) return configured;
  }
  return list.find((channel) => channel?.isTextBased?.() && String(channel?.name || '').toLowerCase() === 'roles') || null;
}

function applyRetiredFriendlyCommandPolicy(friendlyCommands = require('./friendly-commands.cjs')) {
  if (!friendlyCommands || friendlyCommands[FRIENDLY_POLICY_APPLIED]) return false;
  const originalDefinitions = friendlyCommands.commandDefinitions;
  const originalNames = friendlyCommands.commandNames;
  const originalIsFriendlyCommand = friendlyCommands.isFriendlyCommand;
  const originalResolveFriendlyCommand = friendlyCommands.resolveFriendlyCommand;
  const originalUsageForModule = friendlyCommands.usageForModule;

  friendlyCommands.commandDefinitions = (...args) => originalDefinitions(...args)
    .filter((command) => !RETIRED_MODULE_IDS.has(String(command?.name || '').trim().toLowerCase()));
  friendlyCommands.commandNames = (...args) => originalNames(...args)
    .filter((name) => !RETIRED_MODULE_IDS.has(String(name || '').trim().toLowerCase()));
  friendlyCommands.isFriendlyCommand = (name, ...args) => {
    const normalized = String(name || '').trim().toLowerCase();
    return !RETIRED_MODULE_IDS.has(normalized) && originalIsFriendlyCommand(name, ...args);
  };
  friendlyCommands.resolveFriendlyCommand = (interaction, ...args) => {
    const normalized = String(interaction?.commandName || '').trim().toLowerCase();
    if (RETIRED_MODULE_IDS.has(normalized)) return null;
    const resolved = originalResolveFriendlyCommand(interaction, ...args);
    if (resolved && RETIRED_MODULE_IDS.has(String(resolved.moduleId || '').trim().toLowerCase())) return null;
    return resolved;
  };
  friendlyCommands.usageForModule = (moduleId, ...args) => {
    const normalized = String(moduleId || '').trim().toLowerCase();
    if (RETIRED_MODULE_IDS.has(normalized)) return [];
    return originalUsageForModule(moduleId, ...args);
  };

  Object.defineProperty(friendlyCommands, FRIENDLY_POLICY_APPLIED, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return true;
}

async function retireGamesSelfRolePanel(guild, { botId = '', configuredChannelId = '' } = {}) {
  const channels = await guild.channels.fetch();
  const channel = findRolesChannel(channels, configuredChannelId);
  if (!channel?.messages?.fetch) return { skipped: true, reason: 'roles-channel-unavailable', deleted: 0 };
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = valuesOf(recent);
  let deleted = 0;
  for (const message of messages) {
    if (!isRetiredGamesSelfRoleMessage(message, botId)) continue;
    try {
      await message.delete('Nexus Sentinal retired legacy Games self-role selector; module access roles are authoritative');
      deleted += 1;
    } catch {}
  }
  return { skipped: false, reason: '', deleted, channelId: String(channel.id) };
}

async function retireGuildCommands(guild) {
  if (!guild?.commands?.fetch || !guild?.commands?.delete) return { skipped: true, reason: 'guild-commands-unavailable', deleted: [] };
  const commands = await guild.commands.fetch();
  const deleted = [];
  for (const command of valuesOf(commands)) {
    const name = String(command?.name || '').trim().toLowerCase();
    if (!RETIRED_MODULE_IDS.has(name)) continue;
    await guild.commands.delete(command.id);
    deleted.push(name);
  }
  return { skipped: false, reason: '', deleted };
}

async function runRetiredModuleCleanup(client, config) {
  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const [panelResult, commandResult] = await Promise.all([
    retireGamesSelfRolePanel(guild, {
      botId: client.user?.id,
      configuredChannelId: config.discord?.rolesChannelId || config.discordAutomation?.rolesChannelId || ''
    }),
    retireGuildCommands(guild)
  ]);
  if (!panelResult.skipped && panelResult.deleted) {
    console.log(`[Nexus Sentinal] retired Games self-role cleanup: deleted=${panelResult.deleted} channel=${panelResult.channelId}`);
  }
  if (!commandResult.skipped && commandResult.deleted.length) {
    console.log(`[Nexus Sentinal] retired guild command cleanup: deleted=${commandResult.deleted.join(',')}`);
  }
  return { panelResult, commandResult };
}

function installRetiredGamesSelfRoleCleanupExtension() {
  const retiredModules = retireSentinelModuleRegistry(MODULES);
  const friendlyPolicyApplied = applyRetiredFriendlyCommandPolicy();
  if (retiredModules.length) console.log(`[Nexus Sentinal] retired module registry filtered: ${retiredModules.join(', ')}`);
  if (friendlyPolicyApplied) console.log('[Nexus Sentinal] retired friendly-command policy active.');
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };

  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'retired-modules',
    priority: 105,
    run(client) {
      const timer = setTimeout(() => void runRetiredModuleCleanup(client, config).catch((error) => {
        console.warn(`[Nexus Sentinal] retired Games cleanup unavailable: ${String(error?.message || error).slice(0, 240)}`);
      }), RETIRED_COMMAND_CLEANUP_DELAY_MS);
      timer.unref?.();
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  RETIRED_GAMES_MARKER_PREFIX,
  RETIRED_COMMAND_CLEANUP_DELAY_MS,
  footerTexts,
  isRetiredGamesSelfRoleMessage,
  findRolesChannel,
  applyRetiredFriendlyCommandPolicy,
  retireGamesSelfRolePanel,
  retireGuildCommands,
  runRetiredModuleCleanup,
  installRetiredGamesSelfRoleCleanupExtension
};
