'use strict';

const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkBackendControl, configuredShopProvider } = require('./ark-backend-control.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'arkshop-maintenance-monitor';
const LEGACY_MAINTENANCE_ENV = 'NEXUS_ARKSHOP_LEGACY_MAINTENANCE_ENABLED';
const INITIAL_DELAY_MS = 75_000;
const REFRESH_MS = Math.max(300_000, Number(process.env.NEXUS_ARKSHOP_MAINTENANCE_SECONDS || 600) * 1000 || 600_000);

function legacyArkShopMaintenanceEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env?.[LEGACY_MAINTENANCE_ENV] || '').trim());
}

async function inspectArkShopMaintenance({ registry = new ArkClusterRegistry(), control = new ArkBackendControl({ registry }) } = {}) {
  const results = [];
  for (const server of registry.list({ includeDisabled: false })) {
    const provider = configuredShopProvider(server, control.env || process.env);
    if (!provider.sentinelCompatible) {
      results.push({ id: server.id, state: 'provider-incompatible', drift: false, error: provider.variant });
      continue;
    }
    try {
      const status = await control.shopStatus(server);
      results.push({
        id: server.id,
        state: status.state,
        drift: status.drift === true,
        profileId: status.profile?.id || '',
        revision: Number(status.profile?.revision) || 0,
        liveCounts: status.liveCounts,
        databaseReady: status.database?.ready === true,
        error: ''
      });
    } catch (error) {
      results.push({ id: server.id, state: 'unavailable', drift: false, error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240) });
    }
  }
  return {
    maps: results.length,
    ready: results.filter((item) => item.state === 'ready').length,
    drift: results.filter((item) => item.drift).length,
    attention: results.filter((item) => item.state !== 'ready').length,
    results,
    checkedAt: new Date().toISOString(),
    mutationPerformed: false,
    llmCalls: 0
  };
}

function startArkShopMaintenanceMonitor(options = {}) {
  const env = options.env || process.env;
  if (!legacyArkShopMaintenanceEnabled(env)) {
    return { disabled: true, initial: null, periodic: null, run: null };
  }

  const registry = options.registry || new ArkClusterRegistry();
  const control = options.control || new ArkBackendControl({ registry });
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const setIntervalFn = options.setIntervalFn || setInterval;
  let running = false;
  const run = async (reason) => {
    if (running) return;
    running = true;
    try {
      const result = await inspectArkShopMaintenance({ registry, control });
      console.log(`[Nexus Sentinel] legacy ArkShop maintenance (${reason}): maps=${result.maps} ready=${result.ready} drift=${result.drift} attention=${result.attention} mutations=0 llmCalls=0`);
      for (const item of result.results.filter((entry) => entry.state !== 'ready')) {
        console.warn(`[Nexus Sentinel] legacy ArkShop maintenance attention: map=${item.id} state=${item.state}${item.error ? ` reason=${item.error}` : ''}`);
      }
    } catch (error) {
      console.warn(`[Nexus Sentinel] legacy ArkShop maintenance (${reason}) unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)}`);
    } finally {
      running = false;
    }
  };

  const initial = setTimeoutFn(() => void run('startup'), INITIAL_DELAY_MS);
  initial?.unref?.();
  const periodic = setIntervalFn(() => void run('periodic'), REFRESH_MS);
  periodic?.unref?.();
  return { disabled: false, initial, periodic, run };
}

function installArkShopMaintenanceMonitor({ env = process.env } = {}) {
  if (!legacyArkShopMaintenanceEnabled(env)) {
    console.log(`[Nexus Sentinel] legacy ArkShop/MySQL maintenance disabled (${LEGACY_MAINTENANCE_ENV}=false); Discord/Nexus economy migration path is authoritative.`);
    return { installed: false, coordinated: true, disabled: true };
  }
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true, disabled: false };
  const registry = new ArkClusterRegistry();
  const control = new ArkBackendControl({ registry });
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'arkshop-legacy',
    priority: 170,
    run() {
      startArkShopMaintenanceMonitor({ registry, control, env });
    }
  });
  return { installed: true, coordinated: true, disabled: false };
}

module.exports = {
  STARTUP_TASK_ID,
  LEGACY_MAINTENANCE_ENV,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  legacyArkShopMaintenanceEnabled,
  inspectArkShopMaintenance,
  startArkShopMaintenanceMonitor,
  installArkShopMaintenanceMonitor
};
