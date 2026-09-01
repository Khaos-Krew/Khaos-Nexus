'use strict';

const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} = require('discord.js');
const { createCommands, isAdministrator, requiresAdministrator, COMMAND_MODULES } = require('./commands.cjs');
const { createCurrentServerAdapter, capabilityMapForServer } = require('./game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const {
  moduleForServer,
  moduleName: gameModuleName,
  serverModuleEnabled,
  connectionLabel: gameConnectionLabel
} = require('../shared/game-module-policy.cjs');
const { redactText, errorFingerprint } = require('../shared/redaction.cjs');
const {
  handleNexusSpinCommand,
  handleNexusSpinButton,
  isNexusSpinButton
} = require('./nexus-spin/discord-handler.cjs');

const parent = process.parentPort;
let client = null;
let bootstrap = null;
let heartbeatTimer = null;
let commandRegistrationTimer = null;
let readyAt = null;

function send(type, payload = {}) {
  parent?.postMessage({ type, payload });
}

function log(level, message, meta = {}) {
  send('log', {
    time: new Date().toISOString(),
    source: 'bot',
    level,
    message: redactText(message, bootstrap?.secretValues || []),
    meta
  });
}

function mutateBootstrap(target, source) {
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return source || target;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
  target.secretValues = [target.discordToken, ...(target.config?.servers || []).map((server) => server.password).filter(Boolean)];
  return target;
}

function moduleRuntime(id) {
  return bootstrap?.config?.moduleRuntime?.[id] || null;
}

function isModuleEnabled(id) {
  const state = moduleRuntime(id);
  return state ? Boolean(state.effectiveEnabled) : true;
}

function moduleName(id) {
  const names = {
    'discord-runtime': 'Discord Runtime',
    'game-server-control': 'Game Server Control'
  };
  return names[id] || gameModuleName(id);
}

function moduleDisabledError(id) {
  const state = moduleRuntime(id) || {};
  const suffix = state.reason === 'dependency-disabled' && state.blockedBy?.length
    ? ` It is blocked by ${state.blockedBy.map(moduleName).join(', ')}.`
    : state.reason === 'not-implemented' ? ' It is not implemented in this build.' : ' It is disabled by the owner.';
  const error = new Error(`${moduleName(id)} is unavailable.${suffix}`);
  error.code = 'MODULE_DISABLED';
  return error;
}

function assertModule(id) {
  if (!isModuleEnabled(id)) throw moduleDisabledError(id);
}

function serverModuleId(server) {
  return moduleForServer(server);
}

function serverAvailable(server) {
  return serverModuleEnabled(bootstrap, server);
}

function connectionLabel(server) {
  return gameConnectionLabel(server);
}

function getServer(name) {
  const servers = (bootstrap?.config?.servers || []).filter((server) => server.enabled !== false && serverAvailable(server));
  if (!name && servers.length === 1) return servers[0];
  return servers.find((server) => server.name.toLowerCase() === String(name || '').toLowerCase());
}

function formatCodeBlock(value) {
  const safe = String(value || 'Command completed successfully.').replace(/```/g, "''' ");
  return `\`\`\`text\n${safe.slice(0, 1850)}\n\`\`\``;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function publicPlayers(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  if (!players.length) {
    const count = Number(payload?.count);
    return Number.isFinite(count) && count > 0
      ? `${count} player(s) are connected, but this server API does not expose player names.`
      : 'No players are currently connected.';
  }
  return players.map((player) => {
    const parts = [
      player.name || player.accountName || player.DisplayName || 'Unknown',
      player.userId || player.playerId || player.identifier || player.steamId || player.SteamID || 'no user ID'
    ];
    if (player.level !== undefined && player.level !== null) parts.push(`Lv ${player.level}`);
    if (player.ping !== undefined && player.ping !== null) parts.push(`${Math.round(Number(player.ping) || 0)} ms`);
    return parts.join(' | ');
  }).join('\n');
}

function formatResult(action, result) {
  if (action === 'players') return publicPlayers(result);
  if (action === 'status' && result?.info) {
    const metrics = result.metrics || {};
    return [
      `Name: ${result.info.servername || 'Unknown'}`,
      `Version: ${result.info.version || 'Unknown'}`,
      `Players: ${metrics.currentplayernum ?? '?'} / ${metrics.maxplayernum ?? '?'}`,
      `Server FPS: ${metrics.serverfps ?? '?'}`,
      `Frame time: ${metrics.serverframetime ?? '?'} ms`,
      `Uptime: ${formatDuration(metrics.uptime)}`,
      `World day: ${metrics.days ?? '?'}`
    ].join('\n');
  }
  if (action === 'status' && result?.state) {
    return [
      `Name: ${result.serverName || result.sessionName || 'Satisfactory server'}`,
      `State: ${result.state}`,
      result.sessionName ? `Session: ${result.sessionName}` : null,
      `Players: ${result.players ?? '?'} / ${result.maxPlayers ?? '?'}`,
      `HTTPS API: ${result.apiAvailable === false ? 'temporarily unavailable while loading' : 'available'}`,
      result.serverNetCl ? `Server CL: ${result.serverNetCl}` : null,
      result.gamePhase ? `Game phase: ${result.gamePhase}` : null,
      result.modded ? 'Modded: yes' : null
    ].filter(Boolean).join('\n');
  }
  if (action === 'status' && result?.serverName) {
    return [
      `Name: ${result.serverName}`,
      `Version: ${result.version || 'Unknown'}`,
      `Players: ${result.players ?? '?'} / ${result.maxPlayers ?? '?'}`,
      `Queued: ${result.queued ?? 0}`,
      `Joining: ${result.joining ?? 0}`,
      `Server FPS: ${result.fps ?? '?'}`,
      `Uptime: ${formatDuration(result.uptimeSeconds)}`,
      result.map ? `Map: ${result.map}` : null,
      result.entityCount ? `Entities: ${result.entityCount}` : null
    ].filter(Boolean).join('\n');
  }
  if (action === 'metrics') {
    return [
      `Players: ${result.currentplayernum ?? '?'} / ${result.maxplayernum ?? '?'}`,
      `Server FPS: ${result.serverfps ?? '?'}`,
      `Frame time: ${result.serverframetime ?? '?'} ms`,
      `Uptime: ${formatDuration(result.uptime)}`,
      `Base camps: ${result.basecampnum ?? '?'}`,
      `World day: ${result.days ?? '?'}`
    ].join('\n');
  }
  if (action === 'game-data-summary') {
    return [
      `Snapshot time: ${result.time || 'Unknown'}`,
      `FPS: ${result.fps ?? '?'} (average ${result.averageFps ?? '?'})`,
      `Actors: ${result.actorCount ?? 0}`,
      ...Object.entries(result.actorTypes || {}).map(([type, count]) => `${type}: ${count}`)
    ].join('\n');
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

function actionForCommand(command) {
  return ({ saveworld: 'save', broadcast: 'announce', snapshot: 'game-data-summary', forcestop: 'stop', rcon: 'raw' })[command] || command;
}

function isConfiguredOwner(interaction) {
  const ownerUserId = String(bootstrap?.config?.discord?.ownerUserId || '');
  return Boolean(ownerUserId && interaction?.user?.id === ownerUserId);
}

function adapterRoleForInteraction(interaction, command) {
  if (isConfiguredOwner(interaction)) return 'owner';
  if (requiresAdministrator(command) && isAdministrator(interaction, bootstrap?.config?.discord?.ownerUserId)) return 'owner';
  return 'viewer';
}

async function registerCommands() {
  if (!client?.isReady?.() || !bootstrap?.discordToken) return 0;
  const commands = createCommands({ isModuleEnabled });
  const rest = new REST({ version: '10' }).setToken(bootstrap.discordToken);
  const route = bootstrap.config.discord.guildId
    ? Routes.applicationGuildCommands(client.user.id, bootstrap.config.discord.guildId)
    : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: commands });
  log('info', `Registered ${commands.length} module-aware Discord commands.`);
  return commands.length;
}

function scheduleCommandRegistration() {
  clearTimeout(commandRegistrationTimer);
  commandRegistrationTimer = setTimeout(() => {
    registerCommands().catch((error) => {
      const id = errorFingerprint(error);
      log('error', `Discord command refresh failed [${id}]: ${error.stack || error.message}`);
      send('error', { id, message: error.message, stack: error.stack });
    });
  }, 1200);
  commandRegistrationTimer.unref?.();
}

async function executeServerAction(interaction, command) {
  assertModule('game-server-control');
  const server = getServer(interaction.options.getString('server'));
  if (!server) {
    await interaction.reply({ content: 'That server is not configured, enabled, or its game module is disabled.', ephemeral: true });
    return;
  }
  assertModule(serverModuleId(server));
  if (!server.password) {
    await interaction.reply({ content: 'That server is missing its protected AdminPassword, application token, or RCON password.', ephemeral: true });
    return;
  }
  if (command === 'forcestop' && !interaction.options.getBoolean('confirm')) {
    await interaction.reply({ content: 'Emergency force-stop was not confirmed.', ephemeral: true });
    return;
  }
  if (command === 'rcon' && !isConfiguredOwner(interaction)) {
    await interaction.reply({ content: 'Raw server console commands are restricted to the configured Khaos Nexus Owner account.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const action = actionForCommand(command);
  const payload = {};
  if (command === 'broadcast') payload.message = interaction.options.getString('message');
  if (['kick', 'ban', 'unban'].includes(command)) {
    payload.player = interaction.options.getString('player');
    payload.message = interaction.options.getString('message') || '';
  }
  if (command === 'shutdown') {
    payload.waittime = interaction.options.getInteger('seconds');
    payload.message = interaction.options.getString('message') || 'Server maintenance is starting.';
  }
  if (command === 'rcon') payload.command = interaction.options.getString('command');

  const adapter = createCurrentServerAdapter(server);
  const envelope = await executeAdapterOperation(adapter, action, payload, {
    role: adapterRoleForInteraction(interaction, command),
    explicitSecrets: [server.password]
  });
  await interaction.editReply({ content: `**${server.name}** — ${connectionLabel(server)}\n${formatCodeBlock(formatResult(action, envelope.data))}` });
}

function commandSupportsServer(commandName, server) {
  const action = actionForCommand(commandName);
  return Boolean(capabilityMapForServer(server)[action]);
}

function nexusSpinContext() {
  return {
    bootstrap,
    logger: {
      warn: (message, meta) => log('warn', message, meta),
      error: (message, meta) => log('error', message, meta)
    }
  };
}

async function handleInteraction(interaction) {
  if (interaction.isAutocomplete()) {
    if (!isModuleEnabled('game-server-control')) {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused().toLowerCase();
    const commandName = interaction.commandName;
    const choices = (bootstrap?.config?.servers || [])
      .filter((server) => server.enabled !== false && serverAvailable(server) && commandSupportsServer(commandName, server) && server.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((server) => ({ name: `${server.name} (${server.game} ${connectionLabel(server)})`, value: server.name }));
    await interaction.respond(choices);
    return;
  }

  if (interaction.isButton() && isNexusSpinButton(interaction.customId)) {
    if (!isModuleEnabled('discord-runtime')) {
      await interaction.reply({ content: moduleDisabledError('discord-runtime').message, ephemeral: true });
      return;
    }
    await handleNexusSpinButton(interaction, nexusSpinContext());
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;
  const commandModule = COMMAND_MODULES[command] || 'discord-runtime';
  if (!isModuleEnabled(commandModule)) {
    await interaction.reply({ content: moduleDisabledError(commandModule).message, ephemeral: true });
    return;
  }

  if (requiresAdministrator(command) && !isAdministrator(interaction, bootstrap.config.discord.ownerUserId)) {
    await interaction.reply({ content: 'This command requires the configured bot owner or a Discord administrator.', ephemeral: true });
    return;
  }

  if (command === 'ping') {
    await interaction.reply({ content: `Pong — ${Math.max(0, client.ws.ping)} ms`, ephemeral: true });
    return;
  }

  if (command === 'health') {
    const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    await interaction.reply({
      content: `Runtime: **online**\nUptime: **${Math.floor(process.uptime())}s**\nDiscord latency: **${Math.max(0, client.ws.ping)} ms**\nMemory: **${memoryMb} MB**`,
      ephemeral: true
    });
    return;
  }

  if (command === 'nexusspin') {
    await handleNexusSpinCommand(interaction, nexusSpinContext());
    return;
  }

  if (command === 'listservers') {
    const servers = (bootstrap?.config?.servers || []).filter((server) => server.enabled !== false && serverAvailable(server));
    const lines = servers.length
      ? servers.map((server) => `• ${server.name} — ${server.game} (${connectionLabel(server)})`).join('\n')
      : 'No servers are enabled for the currently active modules.';
    await interaction.reply({ content: lines, ephemeral: true });
    return;
  }

  if (command === 'managerrestart') {
    await interaction.reply({ content: 'Restart request sent to the desktop manager.', ephemeral: true });
    send('restart-requested', { userId: interaction.user.id });
    return;
  }

  await executeServerAction(interaction, command);
}

async function start(payload) {
  bootstrap = payload;
  bootstrap.secretValues = [payload.discordToken, ...payload.config.servers.map((server) => server.password).filter(Boolean)];

  if (!payload.discordToken) throw new Error('Discord bot token is not configured.');
  assertModule('discord-runtime');

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const startupTimer = setTimeout(() => {
    if (!readyAt) {
      const error = new Error('Discord did not become ready within 45 seconds.');
      const id = errorFingerprint(error);
      log('fatal', `Bot startup timed out [${id}].`);
      send('fatal', { id, message: error.message, stack: error.stack });
      process.exit(1);
    }
  }, 45000);
  startupTimer.unref();

  client.once(Events.ClientReady, () => {
    (async () => {
      readyAt = new Date().toISOString();
      clearTimeout(startupTimer);
      const registeredCommands = await registerCommands();
      log('info', `Logged in as ${client.user.tag}; registered ${registeredCommands} commands.`);
      send('ready', {
        username: client.user.tag,
        userId: client.user.id,
        guildCount: client.guilds.cache.size,
        registeredCommands,
        readyAt
      });

      heartbeatTimer = setInterval(() => {
        send('heartbeat', {
          ready: client.isReady(),
          ping: Math.max(0, client.ws.ping),
          guildCount: client.guilds.cache.size,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          uptimeSeconds: Math.floor(process.uptime()),
          readyAt
        });
      }, 10000);
      heartbeatTimer.unref();
    })().catch((error) => {
      const id = errorFingerprint(error);
      log('fatal', `Discord command registration failed [${id}]: ${error.stack || error.message}`);
      send('fatal', { id, message: error.message, stack: error.stack });
      setTimeout(() => process.exit(1), 50);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch(async (error) => {
      const id = errorFingerprint(error);
      const expectedModuleBlock = error?.code === 'MODULE_DISABLED';
      log(expectedModuleBlock ? 'warn' : 'error', `Interaction failed [${id}]: ${error.stack || error.message}`);
      const content = expectedModuleBlock
        ? String(error.message || 'That module is disabled.').slice(0, 500)
        : `Command failed. Error ID: **${id}** — ${String(error.message || 'Unknown error').slice(0, 500)}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
      if (!expectedModuleBlock) send('error', { id, message: error.message, stack: error.stack });
    });
  });

  client.on(Events.Error, (error) => {
    const id = errorFingerprint(error);
    log('error', `Discord client error [${id}]: ${error.stack || error.message}`);
    send('error', { id, message: error.message, stack: error.stack });
  });

  await client.login(payload.discordToken);
}

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap') {
    start(message.payload).catch((error) => {
      const id = errorFingerprint(error);
      log('fatal', `Bot startup failed [${id}]: ${error.stack || error.message}`);
      send('fatal', { id, message: error.message, stack: error.stack });
      setTimeout(() => process.exit(1), 50);
    });
  }
  if (message?.type === 'config-update') {
    if (bootstrap) mutateBootstrap(bootstrap, message.payload || {});
    else bootstrap = message.payload || {};
    if (client?.isReady?.()) scheduleCommandRegistration();
  }
  if (message?.type === 'shutdown') {
    clearInterval(heartbeatTimer);
    clearTimeout(commandRegistrationTimer);
    Promise.resolve(client?.destroy()).finally(() => process.exit(0));
  }
});

process.on('uncaughtException', (error) => {
  const id = errorFingerprint(error);
  log('fatal', `Uncaught exception [${id}]: ${error.stack || error.message}`);
  send('fatal', { id, message: error.message, stack: error.stack });
  setTimeout(() => process.exit(1), 50);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const id = errorFingerprint(error);
  log('error', `Unhandled rejection [${id}]: ${error.stack || error.message}`);
  send('error', { id, message: error.message, stack: error.stack });
});

setTimeout(() => {
  if (!bootstrap) {
    send('fatal', { id: 'bootstrap-timeout', message: 'Manager did not send startup configuration.' });
    process.exit(1);
  }
}, 30000).unref();

module.exports = {
  mutateBootstrap,
  isModuleEnabled,
  serverModuleId,
  serverAvailable,
  connectionLabel,
  actionForCommand,
  commandSupportsServer,
  isConfiguredOwner,
  adapterRoleForInteraction,
  publicPlayers,
  formatResult
};
