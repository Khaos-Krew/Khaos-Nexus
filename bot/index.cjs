'use strict';

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require('discord.js');
const { createCommands, isAdministrator, requiresAdministrator } = require('./commands.cjs');
const { SourceRcon } = require('./rcon.cjs');
const { redactText, errorFingerprint } = require('../shared/redaction.cjs');

const parent = process.parentPort;
let client = null;
let bootstrap = null;
let heartbeatTimer = null;
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

function getServer(name) {
  const servers = bootstrap.config.servers.filter((server) => server.enabled !== false);
  if (!name && servers.length === 1) return servers[0];
  return servers.find((server) => server.name.toLowerCase() === String(name || '').toLowerCase());
}

function rconCommand(server, action, value) {
  const game = String(server.game || 'generic').toLowerCase();
  const commands = {
    ark: {
      status: 'ListPlayers',
      players: 'ListPlayers',
      saveworld: 'SaveWorld',
      broadcast: `Broadcast ${value}`,
      kick: `KickPlayer ${value}`,
      ban: `BanPlayer ${value}`
    },
    palworld: {
      status: 'Info',
      players: 'ShowPlayers',
      saveworld: 'Save',
      broadcast: `Broadcast ${value}`,
      kick: `KickPlayer ${value}`,
      ban: `BanPlayer ${value}`
    },
    generic: {
      status: server.statusCommand || 'status',
      players: server.playersCommand || 'list',
      saveworld: server.saveCommand || 'save-all',
      broadcast: `${server.broadcastCommand || 'broadcast'} ${value}`,
      kick: `${server.kickCommand || 'kick'} ${value}`,
      ban: `${server.banCommand || 'ban'} ${value}`
    }
  };
  return (commands[game] || commands.generic)[action];
}

function formatCodeBlock(value) {
  const safe = String(value || 'Command completed with no response.').replace(/```/g, "''' ");
  return `\`\`\`text\n${safe.slice(0, 1850)}\n\`\`\``;
}

async function executeServerAction(interaction, action) {
  const name = interaction.options.getString('server');
  const server = getServer(name);
  if (!server) {
    await interaction.reply({ content: 'That server is not configured or enabled.', ephemeral: true });
    return;
  }
  if (!server.password) {
    await interaction.reply({ content: 'That server is missing its stored RCON password.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  let command;
  if (action === 'rcon') command = interaction.options.getString('command');
  else if (action === 'broadcast') command = rconCommand(server, action, interaction.options.getString('message'));
  else if (action === 'kick' || action === 'ban') command = rconCommand(server, action, interaction.options.getString('player'));
  else command = rconCommand(server, action);

  const rcon = new SourceRcon(server);
  const result = await rcon.execute(command);
  await interaction.editReply({ content: `**${server.name}**\n${formatCodeBlock(result)}` });
}

async function handleInteraction(interaction) {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = bootstrap.config.servers
      .filter((server) => server.enabled !== false && server.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((server) => ({ name: `${server.name} (${server.game})`, value: server.name }));
    await interaction.respond(choices);
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;

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

  if (command === 'listservers') {
    const servers = bootstrap.config.servers.filter((server) => server.enabled !== false);
    const lines = servers.length ? servers.map((server) => `• ${server.name} — ${server.game}`).join('\n') : 'No servers are enabled.';
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

  client.once('ready', () => {
    (async () => {
      readyAt = new Date().toISOString();
      clearTimeout(startupTimer);
      const commands = createCommands();
      const rest = new REST({ version: '10' }).setToken(payload.discordToken);
      const route = payload.config.discord.guildId
        ? Routes.applicationGuildCommands(client.user.id, payload.config.discord.guildId)
        : Routes.applicationCommands(client.user.id);

      await rest.put(route, { body: commands });
      log('info', `Logged in as ${client.user.tag}; registered ${commands.length} commands.`);
      send('ready', {
        username: client.user.tag,
        userId: client.user.id,
        guildCount: client.guilds.cache.size,
        registeredCommands: commands.length,
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

  client.on('interactionCreate', (interaction) => {
    handleInteraction(interaction).catch(async (error) => {
      const id = errorFingerprint(error);
      log('error', `Interaction failed [${id}]: ${error.stack || error.message}`);
      const content = `Command failed. Error ID: **${id}**`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
      send('error', { id, message: error.message, stack: error.stack });
    });
  });

  client.on('error', (error) => {
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
  if (message?.type === 'shutdown') {
    clearInterval(heartbeatTimer);
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
