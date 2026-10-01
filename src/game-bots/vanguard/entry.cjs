'use strict';

const { Events } = require('discord.js');
const { BOT_LABELS, errorClass, reportCommandFailure } = require('../command-failure.cjs');
const { dataDir, snowflake, statePaths } = require('./config.cjs');
const { GuildStateStore } = require('./state-store.cjs');
const { Scheduler } = require('./scheduler.cjs');
const { installVanguardJtc } = require('./jtc.cjs');
const { createActivityCatalog } = require('./lfg/activities-manifest.cjs');
const { createLfgService } = require('./lfg/lfg-service.cjs');
const { deliverPost } = require('./lfg/lfg-buttons.cjs');
const { handleLfgInteraction, lfgCommandBuilder, refreshLfgBoard, refreshStatusPanel } = require('./lfg/lfg-commands.cjs');
const { d2CommandBuilder, handleD2, handleD2Autocomplete } = require('./commands/d2.cjs');
const { handlePanelsRefresh } = require('./commands/panels-refresh.cjs');
const { publishRuntimeChannels, provisionChannels, resolvedChannels, runSetup, vanguardCommandBuilder } = require('./commands/setup.cjs');
const { vanguardCategory } = require('./gate.cjs');
const { createBungieRuntime } = require('./bungie/runtime.cjs');

const PANEL_REFRESH_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;
const BOARD_DEBOUNCE_MS = 5 * 1000;

function prepareVanguardEnv(env = process.env) {
  const token = String(env.VANGUARD_DISCORD_TOKEN || '').trim();
  if (!token) {
    console.error('[Nexus Vanguard] VANGUARD_DISCORD_TOKEN is missing');
    process.exit(1);
    return env;
  }
  env.DISCORD_BOT_TOKEN = token;
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
  const guildState = snowflake(env.VANGUARD_GUILD_ID || env.DISCORD_GUILD_ID) ? 'present' : 'missing';
  console.log(`[Nexus Vanguard] token=present guild=${guildState} data=${env.VANGUARD_DATA_DIR}`);
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
  for (const builder of [lfgCommandBuilder(), vanguardCommandBuilder(), d2CommandBuilder(env)]) {
    const definition = builder.toJSON();
    const existing = commands.find((item) => item.name === definition.name);
    if (existing) await guild.commands.edit(existing, definition);
    else await guild.commands.create(definition);
  }
  console.log('[Nexus Vanguard] registered /lfg, /vanguard, and /d2');
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

async function ensureVanguardChannels(ctx) {
  const env = ctx.env;
  const guildId = guildIdOf(env);
  if (!guildId) {
    console.warn('[Nexus Vanguard] channel provision skipped: guild id missing');
    return { ok: false, reason: 'guild-missing' };
  }
  const category = vanguardCategory(env);
  if (!category.id) {
    console.warn('[Nexus Vanguard] channel provision skipped: VANGUARD_DISCORD_CATEGORY_ID is missing or not a Discord category id');
    return { ok: false, reason: 'fail-closed' };
  }
  let guild = null;
  try {
    guild = await ctx.client.guilds.fetch(guildId);
  } catch (error) {
    console.warn(`[Nexus Vanguard] channel provision class=${errorClass(error)}`);
    return { ok: false, reason: 'guild' };
  }
  const saved = ctx.channelStore.read()?.[guildId] || {};
  const result = await provisionChannels({
    guild,
    env,
    categoryId: category.id,
    saved,
    reason: 'Nexus Vanguard startup',
    botId: ctx.client?.user?.id || guild?.members?.me?.id || ''
  });
  await ctx.channelStore.update((state) => {
    state[guildId] = { ...(state[guildId] || {}), ...result.resolved };
    return state;
  });
  publishRuntimeChannels(env, resolvedChannels(env, result.resolved), ctx.jtc);
  if (!result.ok) {
    console.warn(`[Nexus Vanguard] channel provision class=${result.errorClass || result.reason}`);
    return result;
  }
  console.log(`[Nexus Vanguard] channels created=${result.created.length} reused=${result.reused.length}`);
  return result;
}

async function onReady(ctx) {
  const guildId = guildIdOf(ctx.env);
  if (guildId) {
    await ensureVanguardChannels(ctx);
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
  if (Date.now() - ctx.lastPanelAt >= PANEL_REFRESH_MS) {
    ctx.lastPanelAt = Date.now();
    await refreshGuildPanels(ctx, guildId, { force: true });
  }
}

function createBungieLoop(ctx, { intervalMs = TICK_MS } = {}) {
  let inFlight = false;
  let booted = false;
  async function pass() {
    if (inFlight) return { skipped: true };
    inFlight = true;
    const guildId = guildIdOf(ctx.env);
    try {
      if (!booted) {
        await ctx.bungie.boot(guildId);
        booted = true;
      } else if (guildId) {
        await ctx.bungie.tick(guildId);
      }
      return { skipped: false };
    } catch (error) {
      console.warn(`[Nexus Vanguard] bungie tick class=${errorClass(error)}`);
      return { skipped: false, error: true };
    } finally {
      inFlight = false;
    }
  }
  const timer = setInterval(() => {
    void pass();
  }, intervalMs);
  timer.unref?.();
  void pass();
  return {
    pass,
    timer,
    stop() {
      clearInterval(timer);
    }
  };
}

function bindShutdown(ctx) {
  if (ctx.shutdownBound) return;
  ctx.shutdownBound = true;
  const stop = (signal) => {
    clearTimeout(ctx.boardTimer);
    ctx.bungieLoop?.stop();
    ctx.scheduler.stop();
    console.log(`[Nexus Vanguard] ${signal}`);
    process.exit(0);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

function installVanguard(client, { env = process.env, shutdown = false, fetch } = {}) {
  const paths = statePaths(env);
  const channelStore = new GuildStateStore(paths.channels);
  const panelStore = new GuildStateStore(paths.panels);
  const installed = installVanguardJtc(client, env);
  const scheduler = new Scheduler();
  const channelsFor = (guildId) => resolvedChannels(env, channelStore.read()?.[String(guildId)] || {});
  const bungie = createBungieRuntime({
    env,
    discord: client,
    panelStore,
    channelsFor,
    fetch,
    editLock: (task) => scheduler.run(task)
  });
  const activities = createActivityCatalog({ query: bungie.query });
  const lfg = createLfgService({
    store: new GuildStateStore(paths.lfg),
    env,
    findActivity: (key) => activities.find(key)
  });
  const ctx = {
    client,
    env,
    scheduler,
    lfg,
    activities,
    bungie,
    channelStore,
    panelStore,
    jtc: installed.controller,
    lastPanelAt: 0,
    boardTimer: null,
    bungieLoop: null,
    shutdownBound: false
  };
  ctx.scheduleBoard = (guildId) => scheduleBoard(ctx, guildId);
  client.on(Events.InteractionCreate, (interaction) => {
    const run = async () => {
      if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
        if (interaction.commandName === 'd2') return handleD2Autocomplete(interaction, ctx);
        return handleLfgInteraction(interaction, ctx);
      }
      if (interaction.commandName === 'd2') {
        await handleD2(interaction, ctx);
        return;
      }
      if (interaction.commandName === 'vanguard') {
        const group = interaction.options?.getSubcommandGroup?.(false);
        const sub = interaction.options?.getSubcommand?.(false);
        if (group === 'panels' && sub === 'refresh') {
          await handlePanelsRefresh(interaction, ctx);
          return;
        }
        await ctx.scheduler.run(() => runSetup(interaction, ctx));
        return;
      }
      await ctx.scheduler.run(() => handleLfgInteraction(interaction, ctx));
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
    ctx.bungieLoop = createBungieLoop(ctx);
  });
  if (shutdown) bindShutdown(ctx);
  return ctx;
}

module.exports = {
  PANEL_REFRESH_MS,
  TICK_MS,
  BOARD_DEBOUNCE_MS,
  prepareVanguardEnv,
  ensureVanguardChannels,
  installVanguard,
  registerVanguardCommands,
  createBungieLoop
};
