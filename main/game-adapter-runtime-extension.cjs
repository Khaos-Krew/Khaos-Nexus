'use strict';

let installed = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function patchAutonomy() {
  const target = require('./services/autonomy-service.cjs');
  const prototype = target.AutonomyService?.prototype;
  if (!prototype || prototype.__khaosGameAdapterRuntimePatched) return;
  const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
  const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
  const { filterEnabledGameServers, connectionLabel } = require('../shared/game-module-policy.cjs');
  const { assertModule } = require('./module-runtime-extension.cjs');

  prototype.testServer = async function adapterAwareTestServer(server) {
    if (!server?.password) throw new Error('The protected server credential is missing.');
    const adapter = createCurrentServerAdapter(server, { logger: this.logger, now: this.now });
    const result = await executeAdapterOperation(adapter, 'status', {}, {
      role: 'viewer',
      explicitSecrets: [server.password]
    });
    const data = result.data;
    if (data && typeof data === 'object') {
      const summary = {
        connection: connectionLabel(server),
        state: data.state || data.status || (data.info ? 'online' : undefined),
        serverName: data.serverName || data.info?.servername || server.name,
        players: data.players ?? data.metrics?.currentplayernum,
        maxPlayers: data.maxPlayers ?? data.metrics?.maxplayernum,
        apiAvailable: data.apiAvailable
      };
      return JSON.stringify(Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined)), null, 2).slice(0, 700);
    }
    return String(data || 'Connected successfully.').slice(0, 700);
  };

  prototype.checkServers = async function adapterAwareCheckServers() {
    assertModule('operator-console', 'Run game-server health checks', this);
    if (this.healthRunning) return { skipped: true, reason: 'already-running' };
    this.healthRunning = true;
    try {
      const runtime = this.configStore.getRuntimeBootstrap();
      const servers = filterEnabledGameServers(runtime);
      const health = {};
      const checkedAt = new Date(this.now()).toISOString();
      for (const server of servers) {
        try {
          const detail = await this.testServer(server);
          health[server.id] = { name: server.name, game: server.game, status: 'online', checkedAt, failures: 0, detail };
        } catch (error) {
          const previous = this.state.serverHealth?.[server.id] || {};
          health[server.id] = {
            name: server.name,
            game: server.game,
            status: 'offline',
            checkedAt,
            failures: Number(previous.failures || 0) + 1,
            detail: String(error?.message || error).slice(0, 700)
          };
        }
      }
      const offline = Object.values(health).filter((entry) => entry.status === 'offline');
      const attention = offline.map((entry) => `A configured game server is unreachable: ${entry.detail}`);
      this.updateState({
        status: attention.length ? 'attention' : 'ready',
        lastHealthCheckAt: checkedAt,
        serverHealth: health,
        attention,
        lastError: attention[0] || null
      });
      if (offline.some((entry) => entry.failures >= 3)) {
        await this.notify('Khaos Nexus server attention required', `${offline.length} configured server connection(s) are failing repeatedly.`, 'warning').catch(() => {});
      }
      return { checkedAt, health: clone(health), offline: offline.length, checked: servers.length };
    } finally {
      this.healthRunning = false;
    }
  };

  prototype.runMaintenance = async function adapterAwareMaintenance() {
    assertModule('operator-console', 'Run Maintenance Mode', this);
    if (this.maintenanceRunning) throw new Error('Maintenance Mode is already running.');
    this.maintenanceRunning = true;
    const startedAt = new Date(this.now()).toISOString();
    this.updateState({ status: 'maintenance', maintenanceActive: true, lastError: null });
    const results = [];
    try {
      this.createAutomaticBackup('pre-maintenance');
      results.push({ step: 'backup', ok: true, detail: 'Verified backup created.' });
      await this.notify('Khaos Nexus maintenance starting', this.settings.maintenanceWarning, 'warning').catch(() => {});

      const runtime = this.configStore.getRuntimeBootstrap();
      for (const server of filterEnabledGameServers(runtime)) {
        if (!server.password) {
          results.push({ step: 'server', server: server.name, ok: false, detail: 'Protected server credential missing.' });
          continue;
        }
        try {
          const adapter = createCurrentServerAdapter(server, { logger: this.logger, now: this.now });
          const context = { role: 'local-admin', explicitSecrets: [server.password] };
          let warned = false;
          if (adapter.supports('announce')) {
            await executeAdapterOperation(adapter, 'announce', { message: this.settings.maintenanceWarning }, context);
            warned = true;
          }
          if (!adapter.supports('save')) throw new Error(`${connectionLabel(server)} does not provide a safe save operation.`);
          await executeAdapterOperation(adapter, 'save', {}, context);
          results.push({
            step: 'server',
            server: server.name,
            ok: true,
            detail: warned ? 'Players warned and world save requested.' : 'World save requested; this server API does not expose a typed announcement operation.'
          });
        } catch (error) {
          results.push({ step: 'server', server: server.name, ok: false, detail: String(error?.message || error).slice(0, 700) });
        }
      }

      if (this.settings.maintenanceRestartBot) {
        await this.supervisor.restart();
        results.push({ step: 'bot', ok: true, detail: 'Supervised bot restart requested.' });
      }

      const failed = results.filter((item) => !item.ok);
      const summary = { ok: failed.length === 0, startedAt, completedAt: new Date(this.now()).toISOString(), results };
      this.updateState({
        status: summary.ok ? 'ready' : 'attention',
        maintenanceActive: false,
        lastMaintenanceAt: summary.completedAt,
        lastMaintenanceSummary: summary,
        lastError: failed[0]?.detail || null
      });
      await this.notify('Khaos Nexus maintenance completed', summary.ok ? 'All maintenance steps completed.' : `${failed.length} maintenance step(s) need attention.`, summary.ok ? 'info' : 'warning').catch(() => {});
      return summary;
    } catch (error) {
      this.updateState({ status: 'attention', maintenanceActive: false, lastError: error.message });
      await this.notify('Khaos Nexus maintenance failed', error.message, 'error').catch(() => {});
      throw error;
    } finally {
      this.maintenanceRunning = false;
    }
  };

  Object.defineProperty(prototype, '__khaosGameAdapterRuntimePatched', { value: true });
}

function patchScheduler() {
  const prototype = require('./services/server-scheduler-service.cjs').ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosGameAdapterRuntimePatched || typeof prototype.runtimeServers !== 'function') return;
  const original = prototype.runtimeServers;
  const { serverModuleEnabled } = require('../shared/game-module-policy.cjs');
  prototype.runtimeServers = function adapterAwareRuntimeServers(schedule) {
    const runtime = this.configStore?.getRuntimeBootstrap?.();
    return original.call(this, schedule).filter((server) => serverModuleEnabled(runtime, server));
  };
  Object.defineProperty(prototype, '__khaosGameAdapterRuntimePatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchAutonomy();
  patchScheduler();
}

module.exports = { install, patchAutonomy, patchScheduler };