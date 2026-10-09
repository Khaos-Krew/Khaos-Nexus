'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { onPublicServersChanged } = require('../shared/server-list-notify.cjs');
const { StateStore } = require('./state-store.cjs');
const { findGameServersChannel } = require('./game-servers-panel.cjs');
const { valuesOf } = require('./nexus-status.cjs');
const {
  handleRetiredServerListCommand,
  handleServerListCommand,
  listEnabled,
  listPostEnabled,
  publishPublicServerList,
  refreshMs,
  retirePublicServerList,
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

async function gameServersChannels(client, env, config) {
  const guildId = String(config?.discord?.guildId || env.DISCORD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!/^\d{17,20}$/.test(guildId)) return [];
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = findGameServersChannel(valuesOf(await guild.channels.fetch()));
    return channel ? [channel] : [];
  } catch { return []; }
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
      let retired = false;
      let retiring = false;
      // Posting retired (default): delete the old list post until one clean pass.
      const retire = async (reason) => {
        if (retired || retiring) return;
        retiring = true;
        try {
          const result = await retirePublicServerList(client, { env: process.env, state, channels: await gameServersChannels(client, process.env, config) });
          if (!result.errors.length) retired = true;
          console.log(`[Nexus Sentinal] public server list retired (${reason}): deleted=${result.deleted}${result.errors.length ? ` errors=${result.errors.join('; ').slice(0, 240)}` : ''}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] public server list retire (${reason}) failed: ${String(error?.message || error).slice(0, 240)}`);
        } finally { retiring = false; }
      };
      const run = (reason) => {
        const env = process.env;
        if (!listPostEnabled(env)) { void retire(reason); return; }
        if (!listEnabled(env)) return;
        void publishPublicServerList(client, { env, state, config }).then((result) => {
          if (result?.skipped) return;
          console.log(`[Nexus Sentinal] public server list (${reason}): channel=${result.channelId || ''} message=${result.messageId || ''} created=${result.created ? 'yes' : 'no'} servers=${result.servers || 0}`);
        }).catch((error) => {
          console.warn(`[Nexus Sentinal] public server list (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
        });
      };
      onPublicServersChanged(() => {
        if (!listPostEnabled(process.env)) return;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          run('change');
        }, 2000);
        pending.unref?.();
      });
      client.on(Events.InteractionCreate, (interaction) => {
        const handler = listPostEnabled(process.env)
          ? handleServerListCommand(interaction, { env: process.env, state, config, client })
          : handleRetiredServerListCommand(interaction);
        void handler.catch((error) => {
          console.warn(`[Nexus Sentinal] server list command failed: ${String(error?.message || error).slice(0, 240)}`);
        });
      });
      client.once(Events.ClientReady, () => {
        if (listPostEnabled(process.env)) void registerServerListCommand(client, process.env, config).catch((error) => {
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
