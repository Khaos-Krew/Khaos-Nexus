'use strict';

const { ChannelType, Client, Events, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { ModuleProvisioner } = require('./module-provisioner.cjs');
const { reconcileGameCategoryOrder } = require('./category-order.cjs');
const { renderModuleConsole } = require('./module-console.cjs');
const { ensurePanelMessage } = require('./persistent-panel-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moduleAutoprovision.extension');
const INITIAL_PROVISION_DELAY_MS = 20_000;
const PERIODIC_PROVISION_MS = 5 * 60_000;

function enabledSentinelModules(config = {}) {
  return MODULES.filter((module) => module.console !== false && config.modules?.[module.id]?.enabled !== false);
}

function setupHealthy(setup, channels) {
  if (!setup?.categoryId || !setup?.consoleChannelId) return false;
  const category = channels?.get?.(String(setup.categoryId));
  const consoleChannel = channels?.get?.(String(setup.consoleChannelId));
  return Boolean(
    category?.type === ChannelType.GuildCategory
    && consoleChannel?.type === ChannelType.GuildText
    && String(consoleChannel.parentId || '') === String(category.id)
  );
}

function modulesNeedingProvision(config = {}, state, channels, roles) {
  const pending = [];
  const blocked = [];
  for (const module of enabledSentinelModules(config)) {
    const setup = state?.getModuleSetup?.(module.id) || null;
    if (setupHealthy(setup, channels)) continue;
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
  if (!guildId) return { skipped: 'guild-not-configured', provisioned: [], blocked: [], order: null };
  const guild = await client.guilds.fetch(guildId);
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const candidates = modulesNeedingProvision(config, state, channels, roles);
  const provisioned = [];
  const failed = [];

  for (const moduleId of candidates.pending) {
    try {
      const access = state.getAccessRole(moduleId);
      const accessRoleId = String(access?.roleId || '');
      if (!accessRoleId || !roles.has(accessRoleId)) throw new Error('Access role became unavailable before provisioning.');

      // Lock/adopt the category before any child channels are created. New child
      // channels therefore inherit a deny-by-default category immediately instead
      // of existing publicly while per-channel reconciliation is still running.
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
        accessPolicyOk: Boolean(setup.accessPolicy?.ok),
        accessRoleName: String(setup.accessPolicy?.accessRoleName || ''),
        hub
      });
    } catch (error) {
      failed.push({ moduleId, reason: String(error?.message || error).slice(0, 240) });
    }
  }

  const order = provisioned.length
    ? await reconcileGameCategoryOrder(guild).catch((error) => ({ ok: false, skipped: false, moved: 0, reason: String(error?.message || error) }))
    : null;
  return { provisioned, blocked: candidates.blocked, failed, order };
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
        try {
          const result = await reconcileNewModuleLayouts(client, { config, state, backend, provisioner });
          const details = result.provisioned.map((item) => `${item.moduleId}:${item.categoryCreated ? 'created' : 'adopted'}`).join(', ') || 'none';
          console.log(`[Nexus Sentinal] module auto-provision (${reason}): provisioned=${result.provisioned.length} [${details}] blocked=${result.blocked.length} failed=${result.failed.length} categoryMoves=${Number(result.order?.moved || 0)}`);
          for (const item of result.failed) console.warn(`[Nexus Sentinal] module auto-provision failed: ${item.moduleId}: ${item.reason}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] module auto-provision (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
      };
      const initial = setTimeout(() => void run('startup'), INITIAL_PROVISION_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), PERIODIC_PROVISION_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_PROVISION_DELAY_MS,
  PERIODIC_PROVISION_MS,
  enabledSentinelModules,
  setupHealthy,
  modulesNeedingProvision,
  bootstrapCategoryAccess,
  publishModuleHub,
  reconcileNewModuleLayouts,
  installModuleAutoprovisionExtension
};
