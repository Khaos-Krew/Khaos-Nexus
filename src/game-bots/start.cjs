'use strict';

const { applyGameBotDiscordEnv } = require('./discord-env.cjs');
const { createGameBotHealthServer } = require('./health.cjs');
const { gameBotKey, installCategoryGate, resolveCategoryConfig } = require('./category-gate.cjs');
const { installOpsSpine } = require('./ops-spine.cjs');
const { installStageCommands } = require('./stage-commands.cjs');
const { startAscendedOpsLoop } = require('./ascended-presence.cjs');

async function startGameBot({ botName, botKey, gameRole, serviceName, beforeClient, bind } = {}) {
  const identity = applyGameBotDiscordEnv();
  const role = identity.gameRole || gameRole || 'missing';
  console.log(`[${botName}] starting`);
  console.log(`[${botName}] NEXUS_GAME_ROLE=${role}`);
  console.log(`[${botName}] DISCORD_GUILD_ID=${identity.guildConfigured ? 'present' : 'missing'}`);
  console.log(`[${botName}] READY=${identity.readyFlag || 'unset'} (logged only; it does not block startup or commands)`);
  console.log(`[${botName}] intents: Guilds=on GuildMembers=on Presence=off MessageContent=off`);
  if (!identity.token) {
    console.error(`[${botName}] DISCORD_BOT_TOKEN is missing`);
    process.exit(1);
  }
  if (!identity.guildConfigured) console.warn(`[${botName}] DISCORD_GUILD_ID is missing; slash commands cannot be registered`);

  const state = { discordReady: false };
  const port = Number(process.env.PORT || 8080);
  await createGameBotHealthServer({
    port,
    getState: () => ({ discordReady: state.discordReady, service: serviceName, bot: botName, gameRole: role })
  });
  console.log(`[${botName}] /health listening on ${port}`);

  if (typeof beforeClient === 'function') await beforeClient();

  const { Client, Events, GatewayIntentBits } = require('discord.js');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });
  const key = gameBotKey({ botKey, gameRole: role, serviceName });
  if (!key) throw new Error(`[${botName}] category gate requires the cephalon or ascended bot`);
  const category = resolveCategoryConfig(key);
  console.log(`[${botName}] category gate ${category.envName}=${category.failClosed ? 'invalid' : category.id} source=${category.source}`);
  installCategoryGate(client, { bot: key });
  installOpsSpine(client, { bot: key });
  installStageCommands(client, { bot: key });
  if (key === 'ascended') startAscendedOpsLoop({ client });
  if (typeof bind === 'function') bind(client);
  client.once(Events.ClientReady, (ready) => {
    state.discordReady = true;
    console.log(`[${botName}] Discord ready as ${ready.user?.tag || 'bot'}`);
  });
  client.on(Events.Error, (error) => console.error(`[${botName}] Discord error:`, error));
  await client.login(identity.token);
  return client;
}

module.exports = { startGameBot };
