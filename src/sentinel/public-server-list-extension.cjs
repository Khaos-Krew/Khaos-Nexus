'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { onPublicServersChanged } = require('../shared/server-list-notify.cjs');
const { StateStore } = require('./state-store.cjs');
const {
  handleServerListCommand,
  listEnabled,
  publishPublicServerList,
  refreshMs,
  serverListCommand
} = require('./public-server-list.cjs');

const INSTALLED = Symbol.for('khaos.nexus.publicServerList.extension');
const LOOP = Symbol.for('khaos.nexus.publicServerList.loop');

async function registerServerListCommand(client, env, config) {
  const guildId = String(config?.discord?.guildId || env.DISCORD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!/^\d{17,20}$/.test(guildId)) return;
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  const json = serverListCommand().toJSON();
  const existing = commands.find((command) => command.name === json.name);
  if (existing) await guild.commands.edit(existing, json);
  else await guild.commands.create(json);
}

function installPublicServerListExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusPublicServerListLogin(...args) {
    const client = this;
    if (!client[LOOP]) {
      client[LOOP] = true;
      const state = new StateStore();
      const config = loadConfig();
      let pending = null;
      const run = (reason) => {
        const env = process.env;
        if (!listEnabled(env)) return;
        void publishPublicServerList(client, { env, state, config }).then((result) => {
          if (result?.skipped) return;
          console.log(`[Nexus Sentinal] public server list (${reason}): channel=${result.channelId || ''} message=${result.messageId || ''} created=${result.created ? 'yes' : 'no'} servers=${result.servers || 0}`);
        }).catch((error) => {
          console.warn(`[Nexus Sentinal] public server list (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
        });
      };
      onPublicServersChanged(() => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          run('change');
        }, 2000);
        pending.unref?.();
      });
      client.on(Events.InteractionCreate, (interaction) => {
        void handleServerListCommand(interaction, { env: process.env, state, config, client }).catch((error) => {
          console.warn(`[Nexus Sentinal] server list command failed: ${String(error?.message || error).slice(0, 240)}`);
        });
      });
      client.once(Events.ClientReady, () => {
        void registerServerListCommand(client, process.env, config).catch((error) => {
          console.warn(`[Nexus Sentinal] server list registration failed: ${String(error?.message || error).slice(0, 240)}`);
        });
        const starter = setTimeout(() => run('startup'), 20000);
        starter.unref?.();
        const timer = setInterval(() => run('interval'), refreshMs(process.env));
        timer.unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = { installPublicServerListExtension };
