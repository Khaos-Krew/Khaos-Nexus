'use strict';

const { Events } = require('discord.js');
const { BOT_LABELS, errorClass, reportCommandFailure } = require('../command-failure.cjs');
const { dataDir, snowflake, statePaths } = require('./config.cjs');
const { GuildStateStore } = require('./state-store.cjs');
const { Scheduler } = require('./scheduler.cjs');
const { installVanguardJtc } = require('./jtc.cjs');
const { createLfgService } = require('./lfg/lfg-service.cjs');
const { deliverPost } = require('./lfg/lfg-buttons.cjs');
const { handleLfgInteraction, lfgCommandBuilder, refreshLfgBoard, refreshStatusPanel } = require('./lfg/lfg-commands.cjs');
const { publishRuntimeChannels, resolvedChannels, runSetup, vanguardCommandBuilder } = require('./commands/setup.cjs');

const PANEL_REFRESH_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;
const BOARD_DEBOUNCE_MS = 5 * 1000;

function prepareVanguardEnv(env = process.env) {
  const token = String(env.VANGUARD_DISCORD_TOKEN || '').trim();
  if (token) env.DISCORD_BOT_TOKEN = token;
  const guild = String(env.VANGUARD_GUILD_ID || '').trim();
  if (guild) {
    env.DISCORD_GUILD_ID = guild;
    env.NEXUS_DISCORD_GUILD_ID = guild;
  }
  const appId = String(env.VANGUARD_DISCORD_APP_ID || '').trim();
  if (appId && !String(env.DISCORD_CLIENT_ID || '').trim()) env.DISCORD_CLIENT_ID = appId;
  env.VANGUARD_DATA_DIR = dataDir(env);
  env.NEXUS_DATA_DIR = env.VANGUARD_DATA_DIR;
  const staff = snowflake(env.VANGUARD_STAFF_ALERT_CHANNEL_ID);
  if (staff && !snowflake(env.NEXUS_STAFF_ALERT_CHANNEL_ID)) env.NEXUS_STAFF_ALERT_CHANNEL_ID = staff;
  if (!String(env.NEXUS_GAME_ROLE || '').trim()) env.NEXUS_GAME_ROLE = 'destiny';
  const tokenState = String(env.DISCORD_BOT_TOKEN || '').trim() ? 'present' : 'missing';
  const guildState = snowflake(env.VANGUARD_GUILD_ID || env.DISCORD_GUILD_ID) ? 'present' : 'missing';
  console.log(`[Nexus Vanguard] token=${tokenState} guild=${guildState} data=${env.VANGUARD_DATA_DIR}`);
  return env;
}

function guildIdOf(env) {
  return snowflake(env.VANGUARD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID);
}

async function registerVanguardCommands(client, env) {
  const guildId = guildIdOf(env);
  if (!guildId) {
    console.warn('[Nexus Vanguard] command registration skipped: guild id missing');
    return { registered: false, reason: 'guild-missing' };
  }
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  for (const builder of [lfgCommandBuilder(), vanguardCommandBuilder()]) {
    const definition = builder.toJSON();
    const existing = commands.find((item) => item.name === definition.name);
    if (existing) await guild.commands.edit(existing, definition);
    else await guild.commands.create(definition);
  }
  console.log('[Nexus Vanguard] registered /lfg and /vanguard');
  return { registered: true };
}

async function expireAndEdit(ctx) {
  const expired = await ctx.lfg.expireDue(Date.now());
  const guilds = new Set();
  for (const post of expired) {
    if (post.guildId) guilds.add(String(post.guildId));
    try {
      await deliverPost(ctx.client, post, { lobbyId: resolvedChannels(ctx.env, ctx.channelStore.read()?.[post.guildId] || {}).jtcLobby });
    } catch (error) {
      console.warn(`[Nexus Vanguard] lfg expire edit class=${errorClass(error)}`);
    }
  }
  for (const guildId of guilds) {
    await refreshLfgBoard(ctx, { guildId, force: true }).catch((error) => {
      console.warn(`[Nexus Vanguard] lfg board class=${errorClass(error)}`);
    });
  }
  return expired;
}

async function refreshGuildPanels(ctx, guildId, { force = false } = {}) {
  await refreshLfgBoard(ctx, { guildId, force });
  await refreshStatusPanel(ctx, { guildId, force });
}

function scheduleBoard(ctx, guildId) {
  const guild = String(guildId || guildIdOf(ctx.env) || '');
  clearTimeout(ctx.boardTimer);
  ctx.boardTimer = setTimeout(() => {
    ctx.boardTimer = null;
    if (!guild) return;
    void ctx.scheduler.run(() => refreshLfgBoard(ctx, { guildId: guild, force: false })).catch((error) => {
      console.warn(`[Nexus Vanguard] lfg board class=${errorClass(error)}`);
    });
  }, BOARD_DEBOUNCE_MS);
  ctx.boardTimer.unref?.();
}

async function onReady(ctx) {
  const guildId = guildIdOf(ctx.env);
  if (guildId) {
    const saved = ctx.channelStore.read()?.[guildId] || {};
    publishRuntimeChannels(ctx.env, resolvedChannels(ctx.env, saved), ctx.jtc);
    await expireAndEdit(ctx);
    await refreshGuildPanels(ctx, guildId, { force: true });
  }
  ctx.lastPanelAt = Date.now();
  await registerVanguardCommands(ctx.client, ctx.env);
}

async function onTick(ctx) {
  await expireAndEdit(ctx);
  const guildId = guildIdOf(ctx.env);
  if (!guildId) return;
  if (Date.now() - ctx.lastPanelAt < PANEL_REFRESH_MS) return;
  ctx.lastPanelAt = Date.now();
  await refreshGuildPanels(ctx, guildId, { force: true });
}

function bindShutdown(ctx) {
  if (ctx.shutdownBound) return;
  ctx.shutdownBound = true;
  const stop = (signal) => {
    clearTimeout(ctx.boardTimer);
    ctx.scheduler.stop();
    console.log(`[Nexus Vanguard] ${signal}`);
    process.exit(0);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

function installVanguard(client, { env = process.env, shutdown = false } = {}) {
  const paths = statePaths(env);
  const channelStore = new GuildStateStore(paths.channels);
  const panelStore = new GuildStateStore(paths.panels);
  const lfg = createLfgService({ store: new GuildStateStore(paths.lfg), env });
  const installed = installVanguardJtc(client, env);
  const ctx = {
    client,
    env,
    scheduler: new Scheduler(),
    lfg,
    channelStore,
    panelStore,
    jtc: installed.controller,
    lastPanelAt: 0,
    boardTimer: null,
    shutdownBound: false
  };
  ctx.scheduleBoard = (guildId) => scheduleBoard(ctx, guildId);
  client.on(Events.InteractionCreate, (interaction) => {
    const run = async () => {
      if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
        const handled = await handleLfgInteraction(interaction, ctx);
        return handled;
      }
      await ctx.scheduler.run(async () => {
        if (interaction.commandName === 'vanguard') {
          await runSetup(interaction, ctx);
          return;
        }
        await handleLfgInteraction(interaction, ctx);
      });
    };
    void run().catch((error) => reportCommandFailure(interaction, error, {
      bot: 'vanguard',
      botName: BOT_LABELS.vanguard,
      env
    }));
  });
  client.once(Events.ClientReady, () => {
    void ctx.scheduler.run(() => onReady(ctx)).catch((error) => {
      console.warn(`[Nexus Vanguard] ready class=${errorClass(error)}`);
    });
    ctx.scheduler.every(TICK_MS, () => onTick(ctx));
  });
  if (shutdown) bindShutdown(ctx);
  return ctx;
}

module.exports = {
  PANEL_REFRESH_MS,
  TICK_MS,
  BOARD_DEBOUNCE_MS,
  prepareVanguardEnv,
  installVanguard,
  registerVanguardCommands
};
