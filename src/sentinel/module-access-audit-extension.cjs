'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const {
  auditModuleAccess,
  accessAuditPayload,
  findRoadmapChannel,
  reconcileAuditPanel
} = require('./module-access-audit.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'module-access-audit';
const INITIAL_AUDIT_DELAY_MS = 130_000;
const PERIODIC_AUDIT_MS = 15 * 60_000;

async function runModuleAccessAudit(client, config, state, options = {}) {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const audit = await auditModuleAccess(guild, { state, config, botId: client.user?.id });
  const channels = await guild.channels.fetch();
  const roadmap = findRoadmapChannel(channels);
  let panel = { created: false, duplicatesRemoved: 0, pinned: false };
  if (roadmap?.messages?.fetch && typeof roadmap.send === 'function') {
    panel = await reconcileAuditPanel(roadmap, accessAuditPayload(audit), client.user?.id);
  }
  return {
    reason: options.reason || 'manual',
    roadmapChannelId: String(roadmap?.id || ''),
    panelCreated: Boolean(panel.created),
    duplicatesRemoved: Number(panel.duplicatesRemoved || 0),
    pinned: Boolean(panel.pinned),
    ...audit
  };
}

function createModuleAccessAuditRunner(client, config, state) {
  return async (reason) => {
    try {
      const result = await runModuleAccessAudit(client, config, state, { reason });
      if (result.skipped) return console.warn(`[Nexus Sentinal] module access preflight skipped: ${result.skipped}`);
      console.log(`[Nexus Sentinal] module access preflight (${reason}): sentinelReady=${result.counts.ready} delegated=${result.counts.delegated || 0} modules=${result.counts.modules} attention=${result.counts.attention} pending=${result.counts.pending} accessRoles=${result.counts.accessRoles} buttonBindings=${result.counts.buttonBindings} staffRoles=${result.counts.staffRoles} cachedStaff=${result.counts.cachedStaffMembers} bulkMemberFetches=${result.bulkMemberFetches} panelCreated=${result.panelCreated} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} humanTestRequired=${result.humanInteractionStillRequired}`);
      for (const item of result.modules.filter((entry) => entry.status === 'attention' || entry.status === 'pending')) {
        console.warn(`[Nexus Sentinal] module access preflight ${item.status}: ${item.moduleId}: ${item.reason || 'needs review'}`);
      }
      for (const item of result.modules.filter((entry) => entry.status === 'delegated')) {
        console.log(`[Nexus Sentinal] module access preflight delegated: ${item.moduleId}: ${item.reason}`);
      }
    } catch (error) {
      console.warn(`[Nexus Sentinal] module access preflight unavailable: ${String(error?.message || error).slice(0, 240)}`);
    }
  };
}

function startModuleAccessAuditMonitor(client, config, state, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const run = createModuleAccessAuditRunner(client, config, state);
  const initial = setTimeoutFn(() => void run('startup'), INITIAL_AUDIT_DELAY_MS);
  initial?.unref?.();
  const periodic = setIntervalFn(() => void run('periodic'), PERIODIC_AUDIT_MS);
  periodic?.unref?.();
  return { initial, periodic, run };
}

function installModuleAccessAuditExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  const state = new StateStore();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'module-access',
    priority: 180,
    run(client) {
      startModuleAccessAuditMonitor(client, config, state);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_AUDIT_DELAY_MS,
  PERIODIC_AUDIT_MS,
  runModuleAccessAudit,
  createModuleAccessAuditRunner,
  startModuleAccessAuditMonitor,
  installModuleAccessAuditExtension
};
