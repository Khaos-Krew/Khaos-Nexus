'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const electron = require('electron');
const { DndDiscordProvisioningService } = require('./services/dnd-discord-provisioning-service.cjs');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

const refs = {
  configStore: null,
  logger: null,
  supervisor: null,
  autonomy: null,
  discordAuth: null,
  service: null
};
const jobs = new Map();
let installed = false;
let registered = false;
let registerTimer = null;

function actorId() {
  return String(refs.discordAuth?.getState?.().user?.id || 'local-owner');
}

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(activeRole())) {
    const error = new Error(`${action} requires Khaos Nexus Owner access.`);
    error.code = 'OWNER_ACCESS_REQUIRED';
    throw error;
  }
  return true;
}

function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) {
    refs.service = new DndDiscordProvisioningService({ configStore: refs.configStore, logger: refs.logger });
  }
  return refs.service;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndProvisioningCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndProvisioningCapture', { value: true });
  target[exportName] = Captured;
}

function pushConfig() {
  refs.supervisor?.pushDndConfig?.();
  if (!refs.configStore) return;
  const value = {
    role: activeRole(),
    state: refs.configStore.getDndState(),
    registeredApps: refs.configStore.getRegisteredAppsPublic(),
    bot: refs.supervisor?.getState?.() || null,
    policy: {
      defaultSetupMode: 'none',
      categoryCreationEnabled: true,
      explicitConfirmationRequired: true,
      fullCampaignCategoryStatus: 'available',
      message: 'Use an existing Discord resource, or explicitly preview and confirm one campaign category with its selected channels.'
    }
  };
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('dnd:update', value);
  }
}

function sanitizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function createJob() {
  const id = `dnd-provision-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job = {
    id,
    status: 'running',
    progress: { phase: 'starting', status: 'running' },
    error: null,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function pruneJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id);
  }
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.logger || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd-provision:preview', async (_event, input = {}) => {
    assertOwner('Preview D&D Discord campaign provisioning');
    const result = await ensureService().preview({ ...input, createdBy: actorId() });
    refs.configStore.appendDndAudit({
      action: 'provisioning.previewed',
      outcome: result.ready ? 'success' : 'blocked',
      actorId: actorId(),
      campaignId: input.campaignId,
      appId: input.appId,
      guildId: input.guildId,
      metadata: { blockers: result.blockers, warnings: result.warnings, planCount: result.plan.length }
    });
    return result;
  });

  ipc.handle('dnd-provision:start', (_event, input = {}) => {
    assertOwner('Create D&D Discord campaign space');
    pruneJobs();
    const job = createJob();
    const service = ensureService();
    Promise.resolve()
      .then(() => service.apply({ ...input, createdBy: actorId() }, (progress) => {
        updateJob(job, { progress: { ...progress } });
      }))
      .then((result) => {
        updateJob(job, {
          status: result.failedCount ? 'partial' : 'completed',
          progress: {
            phase: 'complete',
            status: result.failedCount ? 'partial' : 'success',
            createdCount: result.createdCount,
            failedCount: result.failedCount
          },
          result
        });
        pushConfig();
      })
      .catch((error) => {
        updateJob(job, {
          status: 'failed',
          error: { code: error.code || 'DND_PROVISIONING_FAILED', message: error.message || String(error) },
          progress: { phase: 'failed', status: 'failed' }
        });
        refs.logger?.error?.('D&D Discord campaign provisioning failed.', {
          campaignId: input.campaignId,
          appId: input.appId,
          guildId: input.guildId,
          code: error.code,
          message: error.message
        });
      });
    return sanitizeJob(job);
  });

  ipc.handle('dnd-provision:status', (_event, input = {}) => {
    assertOwner('View D&D Discord provisioning progress');
    pruneJobs();
    const job = jobs.get(String(input.jobId || ''));
    if (!job) {
      const error = new Error('The D&D provisioning job was not found or has expired.');
      error.code = 'DND_PROVISIONING_JOB_NOT_FOUND';
      throw error;
    }
    return { ...sanitizeJob(job), result: job.result || null };
  });

  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => {
    if (!registerHandlers()) scheduleRegister();
  }, 100);
  registerTimer.unref?.();
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-discord-provisioning',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-discord-provisioning.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-discord-provisioning.js')],
    source: 'dnd-discord-provisioning-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  installRendererAssets();
  scheduleRegister();
}

module.exports = {
  install,
  refs,
  jobs,
  sanitizeJob,
  createJob,
  updateJob,
  registerHandlers
};
