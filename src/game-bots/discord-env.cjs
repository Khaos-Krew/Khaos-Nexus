'use strict';

function applyGameBotDiscordEnv(env = process.env) {
  const guild = String(env.DISCORD_GUILD_ID || '').trim();
  if (!String(env.NEXUS_DISCORD_GUILD_ID || '').trim() && guild) env.NEXUS_DISCORD_GUILD_ID = guild;
  return {
    token: String(env.DISCORD_BOT_TOKEN || '').trim(),
    guildConfigured: Boolean(String(env.NEXUS_DISCORD_GUILD_ID || '').trim()),
    gameRole: String(env.NEXUS_GAME_ROLE || '').trim(),
    readyFlag: String(env.READY ?? '').trim()
  };
}

module.exports = { applyGameBotDiscordEnv };
