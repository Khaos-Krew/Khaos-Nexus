'use strict';

const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const { dndCommands } = require('./commands.cjs');
const {
  isDndInteraction,
  handleDndInteraction,
  installEncounterPanelRuntime
} = require('./dnd-encounter-panel-policy.cjs');
const { redactText, errorFingerprint } = require('../shared/redaction.cjs');

const parent = process.parentPort;
let bootstrap = null;
let client = null;
let runtime = null;
let encounterPanelController = null;
let heartbeatTimer = null;
let commandRegistrationTimer = null;
let readyAt = null;

function send(type, payload = {}) {
  parent?.postMessage({ type, payload });
}

function secretValues() {
  return [bootstrap?.discordToken].filter(Boolean);
}

function log(level, message, meta = {}) {
  send('log', {
    time: new Date().toISOString(),
    source: 'dnd-bot',
    level,
    message: redactText(message, secretValues()),
    meta
  });
}

function mutateBootstrap(target, source) {
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return source || target;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
  return target;
}

function registrationGuildId() {
  const appGuilds = bootstrap?.config?.discordApp?.guildIds;
  return String(
    (Array.isArray(appGuilds) && appGuilds.find(Boolean)) ||
    bootstrap?.config?.discord?.guildId ||
    ''
  );
}

function coreCommands() {
  return [
    new SlashCommandBuilder().setName('ping').setDescription('Check whether the Nexus D&D bot is responding.'),
    new SlashCommandBuilder().setName('health').setDescription('Show the Nexus D&D bot runtime health.')
  ];
}

function commandPayload() {
  return [...coreCommands(), ...dndCommands()].map((command) => command.toJSON());
}

async function registerCommands() {
  if (!client?.isReady?.() || !bootstrap?.discordToken) return 0;
  const commands = commandPayload();
  const rest = new REST({ version: '10' }).setToken(bootstrap.discordToken);
  const guildId = registrationGuildId();
  const route = guildId
    ? Routes.applicationGuildCommands(client.user.id, guildId)
    : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: commands });
  log('info', `Registered ${commands.length} Nexus D&D commands${guildId ? ` in guild ${guildId}` : ' globally'}.`);
  return commands.length;
}

function scheduleCommandRegistration() {
  clearTimeout(commandRegistrationTimer);
  commandRegistrationTimer = setTimeout(() => {
    registerCommands().catch((error) => {
      const id = errorFingerprint(error);
      log('error', `D&D command refresh failed [${id}]: ${error.stack || error.message}`);
      send('error', { id, message: error.message, stack: error.stack });
    });
  }, 1200);
  commandRegistrationTimer.unref?.();
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand?.() && interaction.commandName === 'ping') {
    await interaction.reply({ content: `Pong — ${Math.max(0, client.ws.ping)} ms`, ephemeral: true });
    return;
  }

  if (interaction.isChatInputCommand?.() && interaction.commandName === 'health') {
    const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    await interaction.reply({
      content: `Nexus D&D: **online**\nUptime: **${Math.floor(process.uptime())}s**\nDiscord latency: **${Math.max(0, client.ws.ping)} ms**\nMemory: **${memoryMb} MB**`,
      ephemeral: true
    });
    return;
  }

  if (!isDndInteraction(interaction)) return;
  await handleDndInteraction(interaction, runtime);
}

async function start(payload) {
  if (client) throw new Error('Nexus D&D Discord worker is already running.');
  bootstrap = payload || {};
  if (!bootstrap.discordToken) throw new Error('Dedicated D&D Discord bot token is not configured.');

  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  runtime = {
    client,
    getBootstrap: () => bootstrap,
    send,
    log
  };
  encounterPanelController = installEncounterPanelRuntime(runtime);

  const startupTimer = setTimeout(() => {
    if (!readyAt) {
      const error = new Error('Nexus D&D Discord bot did not become ready within 45 seconds.');
      const id = errorFingerprint(error);
      log('fatal', `D&D bot startup timed out [${id}].`);
      send('fatal', { id, message: error.message, stack: error.stack });
      process.exit(1);
    }
  }, 45000);
  startupTimer.unref?.();

  client.once(Events.ClientReady, () => {
    (async () => {
      readyAt = new Date().toISOString();
      clearTimeout(startupTimer);
      const registeredCommands = await registerCommands();
      log('info', `Nexus D&D logged in as ${client.user.tag}; registered ${registeredCommands} commands.`);
      send('ready', {
        username: client.user.tag,
        userId: client.user.id,
        guildCount: client.guilds.cache.size,
        registeredCommands,
        readyAt,
        product: 'Nexus D&D'
      });

      heartbeatTimer = setInterval(() => {
        send('heartbeat', {
          ready: client.isReady(),
          ping: Math.max(0, client.ws.ping),
          guildCount: client.guilds.cache.size,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          uptimeSeconds: Math.floor(process.uptime()),
          readyAt,
          product: 'Nexus D&D'
        });
      }, 10000);
      heartbeatTimer.unref?.();
    })().catch((error) => {
      const id = errorFingerprint(error);
      log('fatal', `D&D command registration failed [${id}]: ${error.stack || error.message}`);
      send('fatal', { id, message: error.message, stack: error.stack });
      setTimeout(() => process.exit(1), 50);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch(async (error) => {
      const id = errorFingerprint(error);
      log('error', `D&D interaction failed [${id}]: ${error.stack || error.message}`);
      const content = `D&D command failed. Error ID: **${id}** — ${String(error.message || 'Unknown error').slice(0, 500)}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
      send('error', { id, message: error.message, stack: error.stack });
    });
  });

  client.on(Events.Error, (error) => {
    const id = errorFingerprint(error);
    log('error', `Discord client error [${id}]: ${error.stack || error.message}`);
    send('error', { id, message: error.message, stack: error.stack });
  });

  await client.login(bootstrap.discordToken);
}

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap') {
    start(message.payload).catch((error) => {
      const id = errorFingerprint(error);
      log('fatal', `D&D bot startup failed [${id}]: ${error.stack || error.message}`);
      send('fatal', { id, message: error.message, stack: error.stack });
      setTimeout(() => process.exit(1), 50);
    });
  }
  if (message?.type === 'config-update') {
    if (bootstrap) mutateBootstrap(bootstrap, message.payload || {});
    else bootstrap = message.payload || {};
    encounterPanelController?.onConfigUpdate?.();
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
    send('fatal', { id: 'bootstrap-timeout', message: 'Nexus D&D desktop did not send startup configuration.' });
    process.exit(1);
  }
}, 30000).unref?.();

module.exports = {
  mutateBootstrap,
  registrationGuildId,
  commandPayload,
  coreCommands
};
