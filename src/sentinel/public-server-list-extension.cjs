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

// Cache only: never list guild channels over REST (user-scope 429 risk).
function gameServersChannels(client, env, config) {
  const guildId = String(config?.discord?.guildId || env.DISCORD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!/^\d{17,20}$/.test(guildId)) return [];
  const cached = client?.guilds?.cache?.get?.(guildId)?.channels?.cache;
  if (!cached) return [];
  const channel = findGameServersChannel(valuesOf(cached));
  return channel ? [channel] : [];
}

// One retire pass; true once finished (clean, or only permanent errors).
async function retireOnce(client, options = {}) {
  const log = options.log || console;
  const reason = options.reason || 'retire';
  try {
    const result = await retirePublicServerList(client, {
      env: options.env || process.env,
      state: options.state,
      channels: gameServersChannels(client, options.env || process.env, options.config || {})
    });
    if (result.warnings?.length) log.warn(`[Nexus Sentinal] public server list retire (${reason}) gave up on: ${result.warnings.join('; ').slice(0, 300)}`);
    log.log(`[Nexus Sentinal] public server list retired (${reason}): deleted=${result.deleted}${result.errors.length ? ` errors=${result.errors.join('; ').slice(0, 240)} (will retry)` : ''}`);
    return !result.errors.length;
  } catch (error) {
    log.warn(`[Nexus Sentinal] public server list retire (${reason}) failed: ${String(error?.message || error).slice(0, 240)}`);
    return false;
  }
}

// Runs pass() on an interval until it returns true, then clears the interval.
function startRetireLoop(pass, intervalMs, timers = { setInterval, clearInterval }) {
  let timer = null;
  let done = false;
  let busy = false;
  const tick = async () => {
    if (done || busy) return done;
    busy = true;
    try {
      if (await pass()) {
        done = true;
        if (timer) { timers.clearInterval(timer); timer = null; }
      }
    } catch {} finally { busy = false; }
    return done;
  };
  timer = timers.setInterval(() => { void tick(); }, intervalMs);
  timer?.unref?.();
  return { tick, isDone: () => done, hasTimer: () => Boolean(timer) };
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
        if (!listPostEnabled(process.env)) {
          // Posting retired (default): delete the old list post, stop once done.
          const loop = startRetireLoop(() => retireOnce(client, { env: process.env, state, config, reason: 'retire' }), refreshMs(process.env));
          const starter = setTimeout(() => { void loop.tick(); }, 20000);
          starter.unref?.();
          return;
        }
        const starter = setTimeout(() => run('startup'), 20000);
        starter.unref?.();
        const timer = setInterval(() => run('interval'), refreshMs(process.env));
        timer.unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = { gameServersChannels, installPublicServerListExtension, retireOnce, startRetireLoop };
