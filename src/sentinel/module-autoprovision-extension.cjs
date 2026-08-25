'use strict';

const { ChannelType, Client, Events, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { ModuleProvisioner } = require('./module-provisioner.cjs');
const { layoutFor } = require('./module-layouts.cjs');
const { reconcileGameCategoryOrder } = require('./category-order.cjs');
const { reconcileNexusHq } = require('./nexus-hq.cjs');
const { renderModuleConsole } = require('./module-console.cjs');
const { ensurePanelMessage } = require('./persistent-panel-extension.cjs');
const { createCoalescingRunner } = require('./coalescing-runner.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moduleAutoprovision.extension');
const INITIAL_PROVISION_DELAY_MS = 160_000;
const PERIODIC_PROVISION_MS = 5 * 60_000;

function enabledSentinelModules(config = {}) {
  return MODULES.filter((module) => module.console !== false && config.modules?.[module.id]?.enabled !== false);
}

function normalizedCategoryName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryMatchesModule(moduleId, category) {
  if (!moduleId || !category) return false;
  let layout;
  try { layout = layoutFor(moduleId); } catch { return false; }
  const wanted = new Set([layout.categoryDisplay, layout.category, ...(layout.aliases || [])].map(normalizedCategoryName).filter(Boolean));
  return wanted.has(normalizedCategoryName(category.name));
}

function setupHealthy(setup, channels, moduleId = '') {
  if (!setup?.categoryId || !setup?.consoleChannelId) return false;
  const category = channels?.get?.(String(setup.categoryId));
  const consoleChannel = channels?.get?.(String(setup.consoleChannelId));
  return Boolean(
    category?.type === ChannelType.GuildCategory
    && (!moduleId || categoryMatchesModule(moduleId, category))
    && consoleChannel?.type === ChannelType.GuildText
    && String(consoleChannel.parentId || '') === String(category.id)
  );
}

function modulesNeedingProvision(config = {}, state, channels, roles) {
  const pending = [];
  const blocked = [];
  for (const module of enabledSentinelModules(config)) {
    const setup = state?.getModuleSetup?.(module.id) || null;
    if (setupHealthy(setup, channels, module.id)) continue;
    const access = state?.getAccessRole?.(module.id) || null;
    const roleId = String(access?.roleId || '');
    if (!roleId || !roles?.has?.(roleId)) {
      blocked.push({ moduleId: module.id, reason: 'access-role-not-ready' });
      continue;
    }
    pending.push(module.id);
  }
  return { pending, blocked };
}

async function bootstrapCategoryAccess(guild, provisioner, moduleId, accessRoleId) {
  const categoryResult = await provisioner.category(guild, moduleId);
  const category = categoryResult.category;
  if (!category?.permissionOverwrites?.edit) throw new Error('Module category permission overwrites are unavailable.');
  await category.permissionOverwrites.edit(String(guild.id), { ViewChannel: false }, { reason: `Nexus Sentinal ${moduleId} private bootstrap` });
  await category.permissionOverwrites.edit(String(accessRoleId), { ViewChannel: true }, { reason: `Nexus Sentinal ${moduleId} access bootstrap` });
  return categoryResult;
}

async function moduleState(backend, moduleId) {
  const result = await backend.modules().catch(() => null);
  return result?.modules?.find((item) => item.id === moduleId) || {
    id: moduleId,
    enabled: true,
    configured: false,
    connected: false,
    availableActions: []
  };
}

async function publishModuleHub(client, backend, state, setup, moduleId, logger = console) {
  const channel = await client.channels.fetch(String(setup.consoleChannelId || '')).catch(() => null);
  if (!channel?.isTextBased?.()) return { published: false, reason: 'console-channel-unavailable' };
  const payload = renderModuleConsole(moduleId, await moduleState(backend, moduleId));
  const result = await ensurePanelMessage(channel, moduleId, payload, { botId: client.user?.id, logger });
  if (!result.message) return { published: false, reason: 'hub-message-unavailable' };
  state.setConsole(moduleId, {
    guildId: String(setup.guildId || ''),
    channelId: String(channel.id),
    messageId: String(result.message.id),
    updatedAt: new Date().toISOString()
  });
  return {
    published: true,
    created: Boolean(result.created),
    messageId: String(result.message.id),
    duplicatesRemoved: Number(result.duplicatesRemoved || 0),
    pinned: Boolean(result.pinned)
  };
}

async function reconcileNewModuleLayouts(client, { config, state, backend, provisioner, logger = console } = {}) {
  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured', provisioned: [], blocked: [], hq: null, order: null };
  const inventoryStartedAt = Date.now();
  const guild = await client.guilds.fetch(guildId);
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const candidates = modulesNeedingProvision(config, state, channels, roles);
  logger.log?.(`[Nexus Sentinal] module auto-provision inventory: channels=${Number(channels?.size || 0)} roles=${Number(roles?.size || 0)} pending=${candidates.pending.length} blocked=${candidates.blocked.length} durationMs=${Date.now() - inventoryStartedAt}`);
  const provisioned = [];
  const failed = [];

  for (const moduleId of candidates.pending) {
    try {
      const access = state.getAccessRole(moduleId);
      const accessRoleId = String(access?.roleId || '');
      if (!accessRoleId || !roles.has(accessRoleId)) throw new Error('Access role became unavailable before provisioning.');

      const bootstrap = await bootstrapCategoryAccess(guild, provisioner, moduleId, accessRoleId);
      const setup = await provisioner.provision(guild, moduleId, String(bootstrap.category.id));
      setup.categoryCreated = Boolean(bootstrap.created);
      setup.categorySource = String(bootstrap.source || setup.categorySource || 'selected');
      setup.categoryMatchScore = Number(bootstrap.matchScore || setup.categoryMatchScore || 0);
      state.setModuleSetup(moduleId, setup);

      const hub = await publishModuleHub(client, backend, state, setup, moduleId, logger);
      provisioned.push({
        moduleId,
        categoryId: String(setup.categoryId || ''),
        categoryName: String(setup.categoryName || ''),
        categoryCreated: Boolean(setup.categoryCreated),
        createdChannels: [...(setup.createdChannels || [])],
        movedChannels: [...(setup.movedChannels || [])],
        accessPolicyOk: Boolean(setup.accessPolicy?.ok),
        accessRoleName: String(setup.accessPolicy?.accessRoleName || ''),
        hub
      });
    } catch (error) {
      failed.push({ moduleId, reason: String(error?.message || error).slice(0, 240) });
    }
  }

  const hqStartedAt = Date.now();
  logger.log?.('[Nexus Sentinal] module auto-provision phase: nexus-hq started');
  const hq = await reconcileNexusHq(guild, { config, botId: client.user?.id, logger })
    .catch((error) => ({ ok: false, skipped: '', reason: String(error?.message || error).slice(0, 240) }));
  logger.log?.(`[Nexus Sentinal] module auto-provision phase: nexus-hq finished ok=${Boolean(hq?.ok)} durationMs=${Date.now() - hqStartedAt}`);

  const orderStartedAt = Date.now();
  logger.log?.('[Nexus Sentinal] module auto-provision phase: category-order started');
  const order = await reconcileGameCategoryOrder(guild, { config, botId: client.user?.id })
    .catch((error) => ({ ok: false, skipped: false, moved: 0, renamed: 0, reason: String(error?.message || error) }));
  logger.log?.(`[Nexus Sentinal] module auto-provision phase: category-order finished ok=${Boolean(order?.ok)} durationMs=${Date.now() - orderStartedAt}`);
  return { provisioned, blocked: candidates.blocked, failed, hq, order };
}

function createAutoprovisionRunQueue(worker, options = {}) {
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  const logger = options.logger || console;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  return createCoalescingRunner(async (reason) => {
    const startedAt = now();
    logger.log?.(`[Nexus Sentinal] module auto-provision started: reason=${reason}`);
    await worker(reason);
    logger.log?.(`[Nexus Sentinal] module auto-provision finished: reason=${reason} durationMs=${Math.max(0, now() - startedAt)}`);
  }, {
    onError(error, reason) {
      logger.warn?.(`[Nexus Sentinal] module auto-provision (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
    }
  });
}

function installModuleAutoprovisionExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const state = new StateStore();
  const backend = new BackendClient(config);
  const provisioner = new ModuleProvisioner({
    state,
    config,
    maxLobbiesPerModule: config.discord?.maxTemporaryLobbiesPerModule || 20
  });
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusModuleAutoprovisionLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        const result = await reconcileNewModuleLayouts(client, { config, state, backend, provisioner });
        const details = result.provisioned.map((item) => `${item.moduleId}:${item.categoryCreated ? 'created' : 'adopted'}${item.movedChannels.length ? `+moved${item.movedChannels.length}` : ''}`).join(', ') || 'none';
        const hierarchy = (result.order?.hierarchy || []).join(' > ') || 'unavailable';
        const missing = (result.order?.missing || []).join(',') || 'none';
        const hqState = result.hq?.ok
          ? `ok+created${result.hq.channelsCreated?.length || 0}+moved${result.hq.channelsMoved?.length || 0}+renamed${result.hq.channelsRenamed?.length || 0}`
          : `skipped:${String(result.hq?.skipped || result.hq?.reason || 'unavailable')}`;
        console.log(`[Nexus Sentinal] module auto-provision (${reason}): provisioned=${result.provisioned.length} [${details}] blocked=${result.blocked.length} failed=${result.failed.length} hq=${hqState} categoryRenames=${Number(result.order?.renamed || 0)} categoryMoves=${Number(result.order?.moved || 0)} missingStructural=${missing} hierarchy=${hierarchy}`);
        for (const item of result.failed) console.warn(`[Nexus Sentinal] module auto-provision failed: ${item.moduleId}: ${item.reason}`);
      };
      const queue = createAutoprovisionRunQueue(run);
      const initial = setTimeout(() => void queue.request('startup'), INITIAL_PROVISION_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void queue.request('periodic'), PERIODIC_PROVISION_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_PROVISION_DELAY_MS,
  PERIODIC_PROVISION_MS,
  enabledSentinelModules,
  normalizedCategoryName,
  categoryMatchesModule,
  setupHealthy,
  modulesNeedingProvision,
  bootstrapCategoryAccess,
  publishModuleHub,
  reconcileNewModuleLayouts,
  createAutoprovisionRunQueue,
  installModuleAutoprovisionExtension
};
